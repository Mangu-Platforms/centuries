import { prisma } from "../db.js";
import { encryptSecret } from "./crypto.js";
import type {
  ConnectionContext,
  PlatformConnector,
  RefreshedCredentials,
} from "../connectors/types.js";

// Phase C5: resilience for live connectors. The registry wraps every live
// connector with this decorator (demo connectors are deterministic and
// local, so they stay raw). Three concerns live here, deliberately outside
// the connectors themselves so a new platform gets all of them for free:
//
//  1. Retries with exponential backoff + jitter — but only for errors that
//     are *provably* transient (5xx, 408/429, or a network-level error
//     code). A plain 4xx (bad credential, validation) is the platform's
//     final answer; retrying it just hammers the API and delays the user's
//     error message.
//  2. A per-connection circuit breaker: after N consecutive failures the
//     connection's outbound calls fail fast for a cooldown window instead
//     of stacking timeouts inside the sync tick (one dead platform must
//     never stall the others — NF-availability). After the cooldown a
//     single half-open probe decides whether to close or re-open.
//  3. A credential-refresh hook: when a call fails with 401 and the
//     connector implements refreshCredentials, the wrapper refreshes once,
//     persists the rotated tokens encrypted, and retries with the new
//     token. No connector implements the hook yet — Bluesky re-logs-in per
//     call and Mastodon tokens don't expire — but X's PKCE tokens (C3)
//     expire hourly, and this is the seam that will absorb that.
//
// Publishing is special-cased: a network-level publish failure is NEVER
// retried, because the post may have actually landed and the response was
// lost — an automatic retry would double-post. Only a 429 (the platform
// definitively rejected the post) is retried, exactly once. Idempotent
// recovery beyond that is E7's per-target retry, a user action.
//
// Breaker state is in-process (a Map). That is correct for the current
// single-instance API; a multi-instance deployment (G1+) would move this
// to a shared store, which is exactly why the state lives behind these two
// small functions instead of being sprinkled through callers.

export interface ResilienceOptions {
  /** Total fetchTimeline attempts, first try included. Default 3. */
  maxFetchAttempts?: number;
  /** Base backoff delay; attempt n waits ~base·2ⁿ with jitter. Default 400ms. */
  backoffBaseMs?: number;
  /** Upper bound on any single backoff wait. Default 3000ms. */
  backoffCapMs?: number;
  /** Consecutive failures that open the breaker. Default 3. */
  breakerFailureThreshold?: number;
  /** How long an open breaker fails fast before half-opening. Default 60s. */
  breakerOpenMs?: number;
}

const DEFAULTS: Required<ResilienceOptions> = {
  maxFetchAttempts: 3,
  backoffBaseMs: 400,
  backoffCapMs: 3000,
  breakerFailureThreshold: 3,
  breakerOpenMs: 60_000,
};

interface BreakerState {
  consecutiveFailures: number;
  /** Set when the breaker opens; cleared on close. */
  openedAt: number | null;
}

const breakers = new Map<string, BreakerState>();

/** Test-only: clears all breaker state between test cases. */
export function __resetBreakersForTests(): void {
  breakers.clear();
}

function breakerKey(platform: string, ctx: ConnectionContext): string {
  return ctx.connectionId ?? `${platform}:${ctx.handle}:${ctx.instance ?? ""}`;
}

function errorStatus(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
  for (const candidate of [e.status, e.statusCode, e.response?.status]) {
    if (typeof candidate === "number") return candidate;
  }
  return undefined;
}

const NETWORK_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

function isNetworkError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; cause?: unknown };
  if (typeof e.code === "string" && NETWORK_ERROR_CODES.has(e.code)) return true;
  // undici wraps the coded error one level down (fetch failed → cause).
  return isNetworkError(e.cause);
}

function isTransient(err: unknown): boolean {
  const status = errorStatus(err);
  if (status !== undefined) return status === 408 || status === 429 || status >= 500;
  return isNetworkError(err);
}

function isAuthError(err: unknown): boolean {
  return errorStatus(err) === 401;
}

function retryAfterMs(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as { headers?: Record<string, unknown>; response?: { headers?: unknown } };
  let raw: unknown = e.headers?.["retry-after"];
  if (raw === undefined && e.response && typeof e.response === "object") {
    const headers = (e.response as { headers?: unknown }).headers;
    if (headers && typeof (headers as Headers).get === "function") {
      raw = (headers as Headers).get("retry-after");
    } else if (headers && typeof headers === "object") {
      raw = (headers as Record<string, unknown>)["retry-after"];
    }
  }
  if (typeof raw === "string" && /^\d+$/.test(raw)) return Number(raw) * 1000;
  if (typeof raw === "number") return raw * 1000;
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt: number, err: unknown, opts: Required<ResilienceOptions>): number {
  const suggested = retryAfterMs(err);
  const exponential = opts.backoffBaseMs * 2 ** attempt;
  // Full jitter on the exponential half; a server-suggested retry-after is
  // taken as-is (it already spreads load server-side). Cap either way.
  const delay = suggested ?? exponential * (0.5 + Math.random() * 0.5);
  return Math.min(delay, opts.backoffCapMs);
}

/** Fails fast when the breaker for this connection is open; marks a half-open probe otherwise. */
function checkBreaker(key: string, platform: string, opts: Required<ResilienceOptions>): void {
  const state = breakers.get(key);
  if (!state || state.openedAt === null) return;
  const elapsed = Date.now() - state.openedAt;
  if (elapsed < opts.breakerOpenMs) {
    throw new Error(
      `${platform} calls for this connection are paused after repeated failures — will retry automatically in ${Math.ceil(
        (opts.breakerOpenMs - elapsed) / 1000,
      )}s`,
    );
  }
  // Cooldown elapsed → half-open: let this call through as the probe. Reset
  // openedAt so concurrent callers don't all probe at once; recordFailure
  // re-opens immediately if the probe fails (threshold already met).
  state.openedAt = null;
  state.consecutiveFailures = Math.max(state.consecutiveFailures, opts.breakerFailureThreshold);
}

function recordSuccess(key: string): void {
  breakers.delete(key);
}

function recordFailure(key: string, opts: Required<ResilienceOptions>): void {
  const state = breakers.get(key) ?? { consecutiveFailures: 0, openedAt: null };
  state.consecutiveFailures += 1;
  if (state.consecutiveFailures >= opts.breakerFailureThreshold) {
    state.openedAt = Date.now();
  }
  breakers.set(key, state);
}

async function persistRefreshedCredentials(
  connectionId: string,
  creds: RefreshedCredentials,
): Promise<void> {
  await prisma.connection.updateMany({
    // updateMany: the connection may have been deleted while the refresh
    // was in flight — that must not throw mid-retry.
    where: { id: connectionId },
    data: {
      accessTokenEnc: encryptSecret(creds.accessToken),
      ...(creds.refreshToken ? { refreshTokenEnc: encryptSecret(creds.refreshToken) } : {}),
      ...(creds.tokenExpiresAt ? { tokenExpiresAt: creds.tokenExpiresAt } : {}),
    },
  });
}

/**
 * On a 401, asks the connector for fresh credentials (if it can provide
 * them), persists the rotation, and returns the ctx to retry with — or
 * null when no refresh is possible, in which case the original error
 * stands.
 */
async function tryRefresh(
  connector: PlatformConnector,
  ctx: ConnectionContext,
): Promise<ConnectionContext | null> {
  if (!connector.refreshCredentials) return null;
  const creds = await connector.refreshCredentials(ctx);
  if (!creds) return null;
  if (ctx.connectionId) await persistRefreshedCredentials(ctx.connectionId, creds);
  return {
    ...ctx,
    accessToken: creds.accessToken,
    ...(creds.refreshToken ? { refreshToken: creds.refreshToken } : {}),
  };
}

/** Wraps a live connector with retry/backoff, 429 handling, the circuit breaker, and the refresh hook. */
export function wrapConnector(
  connector: PlatformConnector,
  options: ResilienceOptions = {},
): PlatformConnector {
  const opts: Required<ResilienceOptions> = { ...DEFAULTS, ...options };

  async function guarded<T>(ctx: ConnectionContext, run: (ctx: ConnectionContext) => Promise<T>): Promise<T> {
    const key = breakerKey(connector.platform, ctx);
    checkBreaker(key, connector.platform, opts);
    try {
      const result = await run(ctx);
      recordSuccess(key);
      return result;
    } catch (err) {
      recordFailure(key, opts);
      throw err;
    }
  }

  return {
    platform: connector.platform,

    refreshCredentials: connector.refreshCredentials
      ? (ctx) => connector.refreshCredentials!(ctx)
      : undefined,

    fetchTimeline: (ctx, limit) =>
      guarded(ctx, async (initialCtx) => {
        let currentCtx = initialCtx;
        let refreshed = false;
        for (let attempt = 0; ; attempt++) {
          try {
            return await connector.fetchTimeline(currentCtx, limit);
          } catch (err) {
            if (isAuthError(err) && !refreshed) {
              refreshed = true;
              const refreshedCtx = await tryRefresh(connector, currentCtx);
              if (refreshedCtx) {
                currentCtx = refreshedCtx;
                continue; // retry immediately with the new token; doesn't consume a backoff attempt
              }
            }
            const attemptsLeft = attempt < opts.maxFetchAttempts - 1;
            if (!attemptsLeft || !isTransient(err)) throw err;
            await sleep(backoffDelay(attempt, err, opts));
          }
        }
      }),

    publish: (ctx, content, mediaUrls) =>
      guarded(ctx, async (initialCtx) => {
        let currentCtx = initialCtx;
        let refreshed = false;
        let retriedRateLimit = false;
        for (;;) {
          try {
            return await connector.publish(currentCtx, content, mediaUrls);
          } catch (err) {
            if (isAuthError(err) && !refreshed) {
              refreshed = true;
              const refreshedCtx = await tryRefresh(connector, currentCtx);
              if (refreshedCtx) {
                currentCtx = refreshedCtx;
                continue;
              }
            }
            // Only a 429 is safely retryable for a publish: the platform
            // definitively rejected it. Anything else may have landed.
            if (errorStatus(err) === 429 && !retriedRateLimit) {
              retriedRateLimit = true;
              await sleep(backoffDelay(0, err, opts));
              continue;
            }
            throw err;
          }
        }
      }),
  };
}
