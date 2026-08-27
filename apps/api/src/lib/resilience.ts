import { prisma } from "../db.js";
import { encryptSecret } from "./crypto.js";
import type {
  ConnectionContext,
  PlatformConnector,
  RefreshedCredentials,
} from "../connectors/types.js";

// Phase C5: resilience for live connectors. The registry wraps every live
// connector with this decorator (demo connectors are deterministic and
// local, so they stay raw). Concerns, deliberately outside the connectors
// themselves so a new platform gets all of them for free:
//
//  1. Retries with exponential backoff + jitter — but only for errors that
//     are *provably* transient (5xx, 408/429, or a network-level error
//     code anywhere in the cause chain). A plain 4xx (bad credential,
//     validation) is the platform's final answer; retrying it just hammers
//     the API and delays the user's error message. NOTE: @atproto/xrpc
//     wraps network failures in XRPCError with status=1 ("Unknown") — any
//     status outside 100–599 is treated as "no HTTP status" here so those
//     fall through to cause-chain inspection, otherwise the retry layer
//     would be inert for exactly the errors it exists for.
//  2. A per-attempt timeout: a black-holed host must not hang a caller for
//     undici's default (minutes-long) header timeout — the wrapper stops
//     waiting after attemptTimeoutMs and treats it as a transient failure.
//  3. A per-connection circuit breaker: after N consecutive failures the
//     connection's outbound calls fail fast for a cooldown window instead
//     of stacking timeouts inside the sync tick (one dead platform must
//     never stall the others — NF-availability). The cooldown (10 min)
//     deliberately exceeds the 5-minute sync cadence so an open breaker
//     actually skips at least one tick. After the cooldown exactly ONE
//     caller becomes the half-open probe (a single attempt, no retries);
//     everyone else keeps failing fast until the probe resolves.
//     User-initiated verification (reconnect, OAuth callback) RESETS the
//     breaker first — a human retrying with a corrected credential is the
//     probe, and those routes are rate-limited.
//  4. A credential-refresh hook: when a call fails with 401 and the
//     connector implements refreshCredentials, the wrapper refreshes once
//     (single-flight per connection — rotating refresh tokens like X's are
//     single-use, so two concurrent refreshes would revoke the session),
//     persists the rotated tokens encrypted, and retries with the new
//     token. No connector implements the hook yet; the seam is for C3.
//
// Publishing is special-cased: a network-level publish failure is NEVER
// retried, because the post may have actually landed and the response was
// lost — an automatic retry would double-post. Only a 429 (the platform
// definitively rejected the post) is retried, exactly once, and only when
// the platform's own Retry-After (if any) fits inside the backoff cap —
// a platform saying "come back in 5 minutes" is a fail-now, not a
// sleep-then-doomed-retry. The publish result's latencyMs is re-measured
// wall-clock around the whole operation so analytics (NF03 <3s target)
// reflect what the user actually experienced, retries and sleeps included.
// Recovery beyond that is E7's per-target retry, a user action.
//
// Breaker and single-flight state are in-process Maps. That is correct
// for the current single-instance API; a multi-instance deployment (G1+)
// would move this to a shared store, which is exactly why the state lives
// behind these small functions instead of being sprinkled through callers.
// Breaker entries are deleted on success and on connection deletion
// (routes call resetBreaker), so the Map is bounded by live, failing
// connections.

export interface ResilienceOptions {
  /** Total fetchTimeline attempts, first try included. Default 3. */
  maxFetchAttempts?: number;
  /** Base backoff delay; attempt n waits ~base·2ⁿ with jitter. Default 400ms. */
  backoffBaseMs?: number;
  /**
   * Upper bound on any single backoff wait — and on how long a
   * server-supplied Retry-After is worth waiting for (longer → fail now).
   * Default 3000ms.
   */
  backoffCapMs?: number;
  /** How long to wait on a single connector call before giving up on it. Default 10s. */
  attemptTimeoutMs?: number;
  /** Consecutive failures that open the breaker. Default 3. */
  breakerFailureThreshold?: number;
  /**
   * How long an open breaker fails fast before half-opening. Default 10
   * minutes — deliberately longer than the 5-minute sync cadence, so an
   * open breaker skips at least one whole tick for a dead platform.
   */
  breakerOpenMs?: number;
}

const DEFAULTS: Required<ResilienceOptions> = {
  maxFetchAttempts: 3,
  backoffBaseMs: 400,
  backoffCapMs: 3000,
  attemptTimeoutMs: 10_000,
  breakerFailureThreshold: 3,
  breakerOpenMs: 10 * 60 * 1000,
};

/**
 * Snappier profile for interactive requests a browser is blocked on
 * (connect, reconnect, OAuth callback): fewer attempts, short backoff.
 * Background work (sync tick, scheduled sends) uses the defaults.
 */
export const INTERACTIVE_RESILIENCE: ResilienceOptions = {
  maxFetchAttempts: 2,
  backoffCapMs: 500,
  attemptTimeoutMs: 8_000,
};

interface BreakerState {
  consecutiveFailures: number;
  /** Set while open; null when closed. */
  openedAt: number | null;
  /** True while a half-open probe is in flight — everyone else fails fast. */
  probing: boolean;
}

const breakers = new Map<string, BreakerState>();
const refreshesInFlight = new Map<string, Promise<RefreshedCredentials | null>>();

/** Test-only: clears all breaker + single-flight state between test cases. */
export function __resetBreakersForTests(): void {
  breakers.clear();
  refreshesInFlight.clear();
}

/**
 * Drops breaker state for one connection. Called when a connection is
 * deleted (the id never comes back — without this the Map would leak an
 * entry per ever-failed deleted connection) and at the top of
 * user-initiated verification (reconnect, OAuth callback): the human
 * retrying with a corrected credential IS the half-open probe, and an
 * open breaker must never eat their fix.
 */
export function resetBreaker(connectionId: string): void {
  breakers.delete(connectionId);
}

function breakerKey(platform: string, ctx: ConnectionContext): string {
  return ctx.connectionId ?? `${platform}:${ctx.handle}:${ctx.instance ?? ""}`;
}

function errorStatus(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
  for (const candidate of [e.status, e.statusCode, e.response?.status]) {
    // Only a plausible HTTP status counts. @atproto/xrpc reports network
    // failures as XRPCError{status: 1} — that is not an HTTP verdict, and
    // treating it as one would misclassify every Bluesky network error as
    // non-transient.
    if (typeof candidate === "number" && candidate >= 100 && candidate <= 599) return candidate;
  }
  return undefined;
}

const ATTEMPT_TIMEOUT_CODE = "NEXUS_ATTEMPT_TIMEOUT";

const NETWORK_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
  ATTEMPT_TIMEOUT_CODE,
]);

function isNetworkError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; cause?: unknown };
  if (typeof e.code === "string" && NETWORK_ERROR_CODES.has(e.code)) return true;
  // undici and SDK wrappers nest the coded error in the cause chain
  // (e.g. XRPCError → TypeError("fetch failed") → Error{code}).
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

function headerRetryAfter(headers: unknown): unknown {
  if (!headers) return undefined;
  if (typeof (headers as Headers).get === "function") return (headers as Headers).get("retry-after");
  if (typeof headers === "object") return (headers as Record<string, unknown>)["retry-after"];
  return undefined;
}

function retryAfterMs(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as { headers?: unknown; response?: { headers?: unknown }; cause?: unknown };
  const raw = headerRetryAfter(e.headers) ?? headerRetryAfter(e.response?.headers);
  if (typeof raw === "string" && /^\d+$/.test(raw)) return Number(raw) * 1000;
  if (typeof raw === "number") return raw * 1000;
  // SDK wrappers can bury the HTTP response one level down.
  return retryAfterMs(e.cause);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Bounds one connector call. On timeout the underlying promise is
 * abandoned (with its eventual rejection swallowed, so it can't surface
 * as an unhandled rejection) and a coded, transient-classified error is
 * thrown instead.
 */
async function withAttemptTimeout<T>(run: () => Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const pending = run();
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          pending.catch(() => {});
          const err = new Error(`${what} timed out after ${ms}ms`) as Error & { code: string };
          err.code = ATTEMPT_TIMEOUT_CODE;
          reject(err);
        }, ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Backoff for attempt n. A server-supplied Retry-After that fits under
 * the cap is honored as-is; one that exceeds the cap returns null —
 * meaning "not worth waiting, fail now" — because sleeping less than the
 * platform demanded just burns the latency budget on a doomed retry.
 */
function backoffDelay(
  attempt: number,
  err: unknown,
  opts: Required<ResilienceOptions>,
): number | null {
  const suggested = retryAfterMs(err);
  if (suggested !== undefined) return suggested <= opts.backoffCapMs ? suggested : null;
  const exponential = opts.backoffBaseMs * 2 ** attempt * (0.5 + Math.random() * 0.5);
  return Math.min(exponential, opts.backoffCapMs);
}

/**
 * Gate for one operation. Throws fast when the breaker is open (or a
 * half-open probe is already in flight); returns { probe: true } when
 * this caller has been elected the single half-open probe.
 */
function checkBreaker(
  key: string,
  platform: string,
  opts: Required<ResilienceOptions>,
): { probe: boolean } {
  const state = breakers.get(key);
  if (!state || state.openedAt === null) return { probe: false };
  const elapsed = Date.now() - state.openedAt;
  if (elapsed < opts.breakerOpenMs || state.probing) {
    const waitS = Math.max(1, Math.ceil((opts.breakerOpenMs - elapsed) / 1000));
    throw new Error(
      `${platform} calls for this connection are paused after repeated failures — will retry automatically${
        state.probing ? " shortly" : ` in ~${waitS}s`
      }`,
    );
  }
  // Cooldown elapsed and nobody is probing yet: this caller is the probe.
  state.probing = true;
  return { probe: true };
}

function recordSuccess(key: string): void {
  breakers.delete(key);
}

function recordFailure(key: string, opts: Required<ResilienceOptions>): void {
  const state = breakers.get(key) ?? { consecutiveFailures: 0, openedAt: null, probing: false };
  state.consecutiveFailures += 1;
  if (state.consecutiveFailures >= opts.breakerFailureThreshold) {
    // Stamp a fresh window when opening (or when the probe just failed);
    // a straggler failing while already open keeps the original window
    // instead of silently extending it.
    if (state.openedAt === null || state.probing) state.openedAt = Date.now();
  }
  state.probing = false;
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
 * On a 401, asks the connector for fresh credentials, persists the
 * rotation, and returns the ctx to retry with — or null when no refresh
 * is possible (no hook, hook returned null, or the refresh itself threw),
 * in which case the original error stands. Single-flight per connection:
 * concurrent 401s (a sync fetch overlapping a publish at token expiry)
 * share ONE refresh — rotating refresh tokens are single-use, so a second
 * concurrent exchange with the same stale token would be treated as
 * replay/theft by the platform.
 */
async function tryRefresh(
  connector: PlatformConnector,
  ctx: ConnectionContext,
): Promise<ConnectionContext | null> {
  if (!connector.refreshCredentials) return null;

  const key = ctx.connectionId;
  let promise = key ? refreshesInFlight.get(key) : undefined;
  if (!promise) {
    promise = (async () => {
      const creds = await connector.refreshCredentials!(ctx);
      if (creds && key) await persistRefreshedCredentials(key, creds);
      return creds;
    })().catch(() => null); // a failed refresh means "couldn't refresh", never a new throw path
    if (key) {
      refreshesInFlight.set(key, promise);
      promise.finally(() => refreshesInFlight.delete(key));
    }
  }

  const creds = await promise;
  if (!creds) return null;
  return {
    ...ctx,
    accessToken: creds.accessToken,
    ...(creds.refreshToken ? { refreshToken: creds.refreshToken } : {}),
  };
}

/** Wraps a live connector with the full Phase C5 policy (see file header). */
export function wrapConnector(
  connector: PlatformConnector,
  options: ResilienceOptions = {},
): PlatformConnector {
  const opts: Required<ResilienceOptions> = { ...DEFAULTS, ...options };

  async function guarded<T>(
    ctx: ConnectionContext,
    run: (ctx: ConnectionContext, probe: boolean) => Promise<T>,
  ): Promise<T> {
    const key = breakerKey(connector.platform, ctx);
    const { probe } = checkBreaker(key, connector.platform, opts);
    try {
      const result = await run(ctx, probe);
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

    // Optional capability methods (C7) pass through only when implemented,
    // so capabilitiesOf() reports the same answer for the wrapped and raw
    // connector. Thread reads get the same guard/retry policy as timeline
    // reads; replies are a publish (double-post risk) and get publish's
    // no-retry-on-network policy via a single guarded attempt.
    fetchThread: connector.fetchThread
      ? (ctx, externalId) =>
          guarded(ctx, async (c, probe) => {
            const maxAttempts = probe ? 1 : opts.maxFetchAttempts;
            for (let attempt = 0; ; attempt++) {
              try {
                return await withAttemptTimeout(
                  () => connector.fetchThread!(c, externalId),
                  opts.attemptTimeoutMs,
                  `${connector.platform} thread fetch`,
                );
              } catch (err) {
                if (attempt >= maxAttempts - 1 || !isTransient(err)) throw err;
                const delay = backoffDelay(attempt, err, opts);
                if (delay === null) throw err;
                await sleep(delay);
              }
            }
          })
      : undefined,
    publishReply: connector.publishReply
      ? (ctx, content, inReplyTo) =>
          guarded(ctx, (c) =>
            withAttemptTimeout(
              () => connector.publishReply!(c, content, inReplyTo),
              opts.attemptTimeoutMs,
              `${connector.platform} reply`,
            ),
          )
      : undefined,
    // Engagement mirrors (F2) are best-effort and idempotent (they set a
    // state, not toggle it): one guarded, time-bounded attempt each — the
    // caller treats failure as "mirror didn't land", never as an error.
    setLike: connector.setLike
      ? (ctx, externalId, liked) =>
          guarded(ctx, (c) =>
            withAttemptTimeout(
              () => connector.setLike!(c, externalId, liked),
              opts.attemptTimeoutMs,
              `${connector.platform} like mirror`,
            ),
          )
      : undefined,
    setBookmark: connector.setBookmark
      ? (ctx, externalId, bookmarked) =>
          guarded(ctx, (c) =>
            withAttemptTimeout(
              () => connector.setBookmark!(c, externalId, bookmarked),
              opts.attemptTimeoutMs,
              `${connector.platform} bookmark mirror`,
            ),
          )
      : undefined,

    fetchTimeline: (ctx, limit) =>
      guarded(ctx, async (initialCtx, probe) => {
        // A half-open probe is a single attempt: its job is to answer "is
        // the platform back?", not to spend the full retry budget on a
        // host we already believe is down.
        const maxAttempts = probe ? 1 : opts.maxFetchAttempts;
        let currentCtx = initialCtx;
        let refreshed = false;
        for (let attempt = 0; ; attempt++) {
          try {
            return await withAttemptTimeout(
              () => connector.fetchTimeline(currentCtx, limit),
              opts.attemptTimeoutMs,
              `${connector.platform} timeline fetch`,
            );
          } catch (err) {
            if (isAuthError(err) && !refreshed) {
              refreshed = true;
              const refreshedCtx = await tryRefresh(connector, currentCtx);
              if (refreshedCtx) {
                currentCtx = refreshedCtx;
                attempt--; // the refresh retry replays this attempt, it doesn't consume one
                continue;
              }
            }
            if (attempt >= maxAttempts - 1 || !isTransient(err)) throw err;
            const delay = backoffDelay(attempt, err, opts);
            if (delay === null) throw err; // platform demanded a longer wait than we can afford
            await sleep(delay);
          }
        }
      }),

    publish: (ctx, content, mediaUrls) =>
      guarded(ctx, async (initialCtx, probe) => {
        const start = Date.now();
        let currentCtx = initialCtx;
        let refreshed = false;
        let retriedRateLimit = false;
        for (;;) {
          try {
            const result = await withAttemptTimeout(
              () => connector.publish(currentCtx, content, mediaUrls),
              opts.attemptTimeoutMs,
              `${connector.platform} publish`,
            );
            // Re-measure latency wall-clock around the WHOLE operation:
            // a 429 sleep or a refresh round-trip is time the user
            // experienced, and NF03 analytics must not hide it.
            return { ...result, latencyMs: Date.now() - start };
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
            // definitively rejected it. Anything else may have landed —
            // an automatic retry could double-post. And only when the
            // platform's own Retry-After (if any) fits our budget.
            if (errorStatus(err) === 429 && !retriedRateLimit && !probe) {
              retriedRateLimit = true;
              const delay = backoffDelay(0, err, opts);
              if (delay !== null) {
                await sleep(delay);
                continue;
              }
            }
            throw err;
          }
        }
      }),
  };
}
