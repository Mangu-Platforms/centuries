import { afterEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";

// Phase C5: retries with backoff + jitter, 429 handling, per-connection
// circuit breaker, and the credential-refresh hook — all implemented as a
// wrapper around PlatformConnector (lib/resilience.ts) applied by the
// registry to live connectors only.

const { wrapConnector, __resetBreakersForTests } = await import("../lib/resilience.js");
const { registerLiveConnector, getConnector, __resetRegistryForTests } = await import(
  "../connectors/registry.js"
);
const { prisma } = await import("../db.js");
const { encryptSecret, decryptSecret } = await import("../lib/crypto.js");

type AnyConnector = Parameters<typeof wrapConnector>[0];

const POST = {
  externalId: "x1",
  authorHandle: "@a",
  authorName: "A",
  authorAvatar: "",
  content: "hi",
  mediaUrls: [] as string[],
  likeCount: 0,
  repostCount: 0,
  replyCount: 0,
  postedAt: new Date(),
};

function statusError(status: number, message = `HTTP ${status}`): Error {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

function networkError(code: string): Error {
  const err = new Error("socket hang up") as Error & { code: string };
  err.code = code;
  return err;
}

function fakeConnector(overrides: Partial<AnyConnector> = {}): AnyConnector {
  return {
    platform: "bluesky" as const,
    fetchTimeline: vi.fn().mockResolvedValue([POST]),
    publish: vi.fn().mockResolvedValue({ externalId: "p1", latencyMs: 5 }),
    ...overrides,
  };
}

const FAST = { backoffBaseMs: 5, backoffCapMs: 20 };

function ctxFor(id: string) {
  return { handle: "@resilient", connectionId: id };
}

describe("resilience wrapper (C5)", () => {
  afterEach(() => {
    __resetBreakersForTests();
    vi.restoreAllMocks();
  });

  describe("fetchTimeline retries", () => {
    it("retries a 5xx and succeeds on the next attempt", async () => {
      const inner = fakeConnector();
      (inner.fetchTimeline as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(statusError(502))
        .mockResolvedValueOnce([POST]);

      const wrapped = wrapConnector(inner, FAST);
      const posts = await wrapped.fetchTimeline(ctxFor(crypto.randomUUID()), 10);
      expect(posts).toHaveLength(1);
      expect(inner.fetchTimeline).toHaveBeenCalledTimes(2);
    });

    it("retries a network-level error (ECONNRESET)", async () => {
      const inner = fakeConnector();
      (inner.fetchTimeline as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(networkError("ECONNRESET"))
        .mockResolvedValueOnce([POST]);

      const wrapped = wrapConnector(inner, FAST);
      await wrapped.fetchTimeline(ctxFor(crypto.randomUUID()), 10);
      expect(inner.fetchTimeline).toHaveBeenCalledTimes(2);
    });

    it("retries a 429, honoring a numeric retry-after when present", async () => {
      const err = statusError(429, "Rate limited") as Error & { status: number; headers?: Record<string, string> };
      err.headers = { "retry-after": "0" };
      const inner = fakeConnector();
      (inner.fetchTimeline as ReturnType<typeof vi.fn>).mockRejectedValueOnce(err).mockResolvedValueOnce([POST]);

      const wrapped = wrapConnector(inner, FAST);
      await wrapped.fetchTimeline(ctxFor(crypto.randomUUID()), 10);
      expect(inner.fetchTimeline).toHaveBeenCalledTimes(2);
    });

    it("does NOT retry a plain 4xx (e.g. rejected credential) — it isn't transient", async () => {
      const inner = fakeConnector();
      (inner.fetchTimeline as ReturnType<typeof vi.fn>).mockRejectedValue(
        statusError(400, "Invalid identifier or password"),
      );

      const wrapped = wrapConnector(inner, FAST);
      await expect(wrapped.fetchTimeline(ctxFor(crypto.randomUUID()), 10)).rejects.toThrow(
        /Invalid identifier or password/,
      );
      expect(inner.fetchTimeline).toHaveBeenCalledTimes(1);
    });

    it("does NOT retry a status-less, code-less error (indistinguishable from a real rejection)", async () => {
      const inner = fakeConnector();
      (inner.fetchTimeline as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Invalid identifier or password"));

      const wrapped = wrapConnector(inner, FAST);
      await expect(wrapped.fetchTimeline(ctxFor(crypto.randomUUID()), 10)).rejects.toThrow();
      expect(inner.fetchTimeline).toHaveBeenCalledTimes(1);
    });

    it("gives up after the configured number of attempts", async () => {
      const inner = fakeConnector();
      (inner.fetchTimeline as ReturnType<typeof vi.fn>).mockRejectedValue(statusError(503));

      const wrapped = wrapConnector(inner, { ...FAST, maxFetchAttempts: 3 });
      await expect(wrapped.fetchTimeline(ctxFor(crypto.randomUUID()), 10)).rejects.toThrow(/HTTP 503/);
      expect(inner.fetchTimeline).toHaveBeenCalledTimes(3);
    });
  });

  describe("publish retries", () => {
    it("never retries a network-level publish failure (the post may have landed — double-post risk)", async () => {
      const inner = fakeConnector();
      (inner.publish as ReturnType<typeof vi.fn>).mockRejectedValue(networkError("ETIMEDOUT"));

      const wrapped = wrapConnector(inner, FAST);
      await expect(wrapped.publish(ctxFor(crypto.randomUUID()), "hi", [])).rejects.toThrow();
      expect(inner.publish).toHaveBeenCalledTimes(1);
    });

    it("retries a publish exactly once on 429 (a rate-limited post was definitively rejected)", async () => {
      const inner = fakeConnector();
      (inner.publish as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(statusError(429))
        .mockResolvedValueOnce({ externalId: "p2", latencyMs: 5 });

      const wrapped = wrapConnector(inner, FAST);
      const res = await wrapped.publish(ctxFor(crypto.randomUUID()), "hi", []);
      expect(res.externalId).toBe("p2");
      expect(inner.publish).toHaveBeenCalledTimes(2);
    });

    it("gives up after one 429 retry", async () => {
      const inner = fakeConnector();
      (inner.publish as ReturnType<typeof vi.fn>).mockRejectedValue(statusError(429));

      const wrapped = wrapConnector(inner, FAST);
      await expect(wrapped.publish(ctxFor(crypto.randomUUID()), "hi", [])).rejects.toThrow(/HTTP 429/);
      expect(inner.publish).toHaveBeenCalledTimes(2);
    });
  });

  describe("per-connection circuit breaker", () => {
    it("opens after the failure threshold and fails fast without calling the connector", async () => {
      const inner = fakeConnector();
      (inner.fetchTimeline as ReturnType<typeof vi.fn>).mockRejectedValue(statusError(400, "down"));

      const wrapped = wrapConnector(inner, { ...FAST, breakerFailureThreshold: 2, breakerOpenMs: 60_000 });
      const ctx = ctxFor(crypto.randomUUID());

      await expect(wrapped.fetchTimeline(ctx, 10)).rejects.toThrow(/down/);
      await expect(wrapped.fetchTimeline(ctx, 10)).rejects.toThrow(/down/);
      expect(inner.fetchTimeline).toHaveBeenCalledTimes(2);

      // Third call: breaker is open — fail fast, connector NOT invoked.
      await expect(wrapped.fetchTimeline(ctx, 10)).rejects.toThrow(/paused after repeated failures/i);
      expect(inner.fetchTimeline).toHaveBeenCalledTimes(2);
    });

    it("is keyed per connection: one connection's failures don't open another's breaker", async () => {
      const inner = fakeConnector();
      (inner.fetchTimeline as ReturnType<typeof vi.fn>).mockRejectedValue(statusError(400, "down"));

      const wrapped = wrapConnector(inner, { ...FAST, breakerFailureThreshold: 1, breakerOpenMs: 60_000 });
      await expect(wrapped.fetchTimeline(ctxFor("conn-a"), 10)).rejects.toThrow(/down/);
      await expect(wrapped.fetchTimeline(ctxFor("conn-a"), 10)).rejects.toThrow(/paused/i);

      (inner.fetchTimeline as ReturnType<typeof vi.fn>).mockResolvedValueOnce([POST]);
      await expect(wrapped.fetchTimeline(ctxFor("conn-b"), 10)).resolves.toHaveLength(1);
    });

    it("half-opens after the cooldown: one probe goes through, success closes the breaker", async () => {
      const inner = fakeConnector();
      (inner.fetchTimeline as ReturnType<typeof vi.fn>).mockRejectedValue(statusError(400, "down"));

      const wrapped = wrapConnector(inner, { ...FAST, breakerFailureThreshold: 1, breakerOpenMs: 30 });
      const ctx = ctxFor(crypto.randomUUID());

      await expect(wrapped.fetchTimeline(ctx, 10)).rejects.toThrow(/down/);
      await expect(wrapped.fetchTimeline(ctx, 10)).rejects.toThrow(/paused/i);

      await new Promise((r) => setTimeout(r, 40)); // past the cooldown
      (inner.fetchTimeline as ReturnType<typeof vi.fn>).mockResolvedValue([POST]);
      await expect(wrapped.fetchTimeline(ctx, 10)).resolves.toHaveLength(1); // half-open probe succeeds

      // Breaker closed again: further calls flow normally.
      await expect(wrapped.fetchTimeline(ctx, 10)).resolves.toHaveLength(1);
    });

    it("a failed half-open probe re-opens the breaker", async () => {
      const inner = fakeConnector();
      (inner.fetchTimeline as ReturnType<typeof vi.fn>).mockRejectedValue(statusError(400, "down"));

      const wrapped = wrapConnector(inner, { ...FAST, breakerFailureThreshold: 1, breakerOpenMs: 30 });
      const ctx = ctxFor(crypto.randomUUID());

      await expect(wrapped.fetchTimeline(ctx, 10)).rejects.toThrow(/down/);
      await new Promise((r) => setTimeout(r, 40));
      await expect(wrapped.fetchTimeline(ctx, 10)).rejects.toThrow(/down/); // probe fails
      await expect(wrapped.fetchTimeline(ctx, 10)).rejects.toThrow(/paused/i); // immediately open again
    });

    it("a successful call resets an accumulating failure count", async () => {
      const inner = fakeConnector();
      (inner.fetchTimeline as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(statusError(400, "down"))
        .mockResolvedValueOnce([POST])
        .mockRejectedValueOnce(statusError(400, "down"));

      const wrapped = wrapConnector(inner, { ...FAST, breakerFailureThreshold: 2, breakerOpenMs: 60_000 });
      const ctx = ctxFor(crypto.randomUUID());

      await expect(wrapped.fetchTimeline(ctx, 10)).rejects.toThrow(/down/); // 1 failure
      await expect(wrapped.fetchTimeline(ctx, 10)).resolves.toHaveLength(1); // reset
      await expect(wrapped.fetchTimeline(ctx, 10)).rejects.toThrow(/down/); // 1 failure again — NOT open
      expect(inner.fetchTimeline).toHaveBeenCalledTimes(3);
    });
  });

  describe("credential-refresh hook", () => {
    it("on a 401, refreshes once, persists the rotated tokens encrypted, and retries with the new token", async () => {
      const user = await prisma.user.create({
        data: {
          email: `resilience-${crypto.randomUUID()}@nexus.app`,
          passwordHash: "x",
          displayName: "R",
        },
      });
      const connection = await prisma.connection.create({
        data: {
          userId: user.id,
          platform: "mastodon",
          handle: "@refresh@masto.example",
          instance: "masto.example",
          accessTokenEnc: encryptSecret("stale-token"),
          refreshTokenEnc: encryptSecret("refresh-token"),
        },
      });

      const inner = fakeConnector({
        refreshCredentials: vi.fn().mockResolvedValue({
          accessToken: "fresh-token",
          refreshToken: "next-refresh-token",
        }),
      });
      (inner.fetchTimeline as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(statusError(401, "Unauthorized"))
        .mockResolvedValueOnce([POST]);

      const wrapped = wrapConnector(inner, FAST);
      const posts = await wrapped.fetchTimeline(
        { handle: connection.handle, instance: "masto.example", accessToken: "stale-token", connectionId: connection.id },
        10,
      );

      expect(posts).toHaveLength(1);
      expect(inner.refreshCredentials).toHaveBeenCalledTimes(1);
      // The retry used the refreshed token…
      const retryCtx = (inner.fetchTimeline as ReturnType<typeof vi.fn>).mock.calls[1][0];
      expect(retryCtx.accessToken).toBe("fresh-token");
      // …and the rotated tokens were persisted encrypted.
      const stored = await prisma.connection.findUniqueOrThrow({ where: { id: connection.id } });
      expect(decryptSecret(stored.accessTokenEnc)).toBe("fresh-token");
      expect(decryptSecret(stored.refreshTokenEnc)).toBe("next-refresh-token");
      expect(stored.accessTokenEnc).not.toContain("fresh-token");

      await prisma.user.delete({ where: { id: user.id } });
    });

    it("propagates the original auth error when the connector has no refresh hook or it returns null", async () => {
      const noHook = fakeConnector();
      (noHook.fetchTimeline as ReturnType<typeof vi.fn>).mockRejectedValue(statusError(401, "Unauthorized"));
      await expect(wrapConnector(noHook, FAST).fetchTimeline(ctxFor(crypto.randomUUID()), 10)).rejects.toThrow(
        /Unauthorized/,
      );
      expect(noHook.fetchTimeline).toHaveBeenCalledTimes(1);

      const nullHook = fakeConnector({ refreshCredentials: vi.fn().mockResolvedValue(null) });
      (nullHook.fetchTimeline as ReturnType<typeof vi.fn>).mockRejectedValue(statusError(401, "Unauthorized"));
      await expect(
        wrapConnector(nullHook, FAST).fetchTimeline(ctxFor(crypto.randomUUID()), 10),
      ).rejects.toThrow(/Unauthorized/);
      expect(nullHook.refreshCredentials).toHaveBeenCalledTimes(1);
      expect(nullHook.fetchTimeline).toHaveBeenCalledTimes(1);
    });
  });

  describe("real-world error shapes and budgets", () => {
    it("retries an @atproto-style network error (status=1 wrapper, coded cause two levels down)", async () => {
      // XRPCError.from() wraps undici's TypeError("fetch failed") — whose
      // own cause carries the coded network error — and stamps status=1
      // ("Unknown"). status 1 is not an HTTP verdict and must not make the
      // error look non-transient.
      const coded = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
      const fetchFailed = new TypeError("fetch failed");
      (fetchFailed as TypeError & { cause: unknown }).cause = coded;
      const xrpcStyle = Object.assign(new Error("Unable to connect"), { status: 1, cause: fetchFailed });

      const inner = fakeConnector();
      (inner.fetchTimeline as ReturnType<typeof vi.fn>).mockRejectedValueOnce(xrpcStyle).mockResolvedValueOnce([POST]);

      const wrapped = wrapConnector(inner, FAST);
      await expect(wrapped.fetchTimeline(ctxFor(crypto.randomUUID()), 10)).resolves.toHaveLength(1);
      expect(inner.fetchTimeline).toHaveBeenCalledTimes(2);
    });

    it("fails immediately (no doomed retry) when Retry-After exceeds the backoff cap", async () => {
      const err = statusError(429, "Rate limited") as Error & { headers?: Record<string, string> };
      err.headers = { "retry-after": "300" }; // 5 minutes — far beyond any budget
      const inner = fakeConnector();
      (inner.fetchTimeline as ReturnType<typeof vi.fn>).mockRejectedValue(err);
      (inner.publish as ReturnType<typeof vi.fn>).mockRejectedValue(err);

      const wrapped = wrapConnector(inner, FAST);
      await expect(wrapped.fetchTimeline(ctxFor(crypto.randomUUID()), 10)).rejects.toThrow(/Rate limited/);
      expect(inner.fetchTimeline).toHaveBeenCalledTimes(1);
      await expect(wrapped.publish(ctxFor(crypto.randomUUID()), "hi", [])).rejects.toThrow(/Rate limited/);
      expect(inner.publish).toHaveBeenCalledTimes(1);
    });

    it("finds a Retry-After buried in the error's cause chain", async () => {
      const responseErr = Object.assign(new Error("Too Many Requests"), {
        statusCode: 429,
        headers: { "retry-after": "0" },
      });
      const sdkWrapper = Object.assign(new Error("Request failed"), { status: 429, cause: responseErr });
      const inner = fakeConnector();
      (inner.fetchTimeline as ReturnType<typeof vi.fn>).mockRejectedValueOnce(sdkWrapper).mockResolvedValueOnce([POST]);

      const wrapped = wrapConnector(inner, FAST);
      await expect(wrapped.fetchTimeline(ctxFor(crypto.randomUUID()), 10)).resolves.toHaveLength(1);
      expect(inner.fetchTimeline).toHaveBeenCalledTimes(2);
    });

    it("bounds a hung connector call with the attempt timeout and retries it as transient", async () => {
      const inner = fakeConnector();
      (inner.fetchTimeline as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(() => new Promise(() => {})) // never settles
        .mockResolvedValueOnce([POST]);

      const wrapped = wrapConnector(inner, { ...FAST, attemptTimeoutMs: 40 });
      await expect(wrapped.fetchTimeline(ctxFor(crypto.randomUUID()), 10)).resolves.toHaveLength(1);
      expect(inner.fetchTimeline).toHaveBeenCalledTimes(2);
    });

    it("reports a 429-retried publish's latency wall-clock across both attempts and the sleep", async () => {
      const err = statusError(429) as Error & { headers?: Record<string, string> };
      const inner = fakeConnector();
      (inner.publish as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce({ externalId: "p3", latencyMs: 1 });

      const wrapped = wrapConnector(inner, { backoffBaseMs: 60, backoffCapMs: 80 });
      const res = await wrapped.publish(ctxFor(crypto.randomUUID()), "hi", []);
      expect(res.externalId).toBe("p3");
      // The inner connector claimed 1ms; the user actually waited through
      // attempt 1 + a ≥30ms backoff sleep + attempt 2. NF03 analytics must
      // see the real number.
      expect(res.latencyMs).toBeGreaterThanOrEqual(25);
    });
  });

  describe("hardened breaker semantics", () => {
    it("keeps failing fast for concurrent callers while a half-open probe is in flight", async () => {
      let releaseProbe!: (v: unknown) => void;
      const probeGate = new Promise((r) => (releaseProbe = r));
      const inner = fakeConnector();
      (inner.fetchTimeline as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(statusError(400, "down"))
        .mockImplementationOnce(async () => {
          await probeGate;
          return [POST];
        });

      const wrapped = wrapConnector(inner, { ...FAST, breakerFailureThreshold: 1, breakerOpenMs: 20 });
      const ctx = ctxFor(crypto.randomUUID());

      await expect(wrapped.fetchTimeline(ctx, 10)).rejects.toThrow(/down/); // opens
      await new Promise((r) => setTimeout(r, 30)); // past cooldown

      const probe = wrapped.fetchTimeline(ctx, 10); // elected probe, blocks on the gate
      await new Promise((r) => setTimeout(r, 5));
      // A second caller during the probe must NOT reach the platform.
      await expect(wrapped.fetchTimeline(ctx, 10)).rejects.toThrow(/paused/i);
      expect(inner.fetchTimeline).toHaveBeenCalledTimes(2); // 1 failure + 1 in-flight probe

      releaseProbe(null);
      await expect(probe).resolves.toHaveLength(1);
      // Probe success closed the breaker.
      (inner.fetchTimeline as ReturnType<typeof vi.fn>).mockResolvedValueOnce([POST]);
      await expect(wrapped.fetchTimeline(ctx, 10)).resolves.toHaveLength(1);
    });

    it("a half-open probe is a single attempt — no retry budget against a host believed down", async () => {
      const inner = fakeConnector();
      (inner.fetchTimeline as ReturnType<typeof vi.fn>).mockRejectedValue(statusError(503, "still down"));

      const wrapped = wrapConnector(inner, {
        ...FAST,
        maxFetchAttempts: 3,
        breakerFailureThreshold: 1,
        breakerOpenMs: 20,
      });
      const ctx = ctxFor(crypto.randomUUID());

      await expect(wrapped.fetchTimeline(ctx, 10)).rejects.toThrow(/still down/);
      const callsAfterOpen = (inner.fetchTimeline as ReturnType<typeof vi.fn>).mock.calls.length;
      await new Promise((r) => setTimeout(r, 30));
      await expect(wrapped.fetchTimeline(ctx, 10)).rejects.toThrow(/still down/); // the probe
      // Exactly ONE more connector call — the probe didn't run the 3-attempt loop.
      expect((inner.fetchTimeline as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterOpen + 1);
    });

    it("breaker state survives across independently wrapped instances (module-scoped, keyed by connectionId)", async () => {
      const failing = () => {
        const c = fakeConnector();
        (c.fetchTimeline as ReturnType<typeof vi.fn>).mockRejectedValue(statusError(400, "down"));
        return c;
      };
      const id = crypto.randomUUID();
      const optsShared = { ...FAST, breakerFailureThreshold: 2, breakerOpenMs: 60_000 };

      await expect(wrapConnector(failing(), optsShared).fetchTimeline(ctxFor(id), 10)).rejects.toThrow(/down/);
      await expect(wrapConnector(failing(), optsShared).fetchTimeline(ctxFor(id), 10)).rejects.toThrow(/down/);

      const third = failing();
      await expect(wrapConnector(third, optsShared).fetchTimeline(ctxFor(id), 10)).rejects.toThrow(/paused/i);
      expect(third.fetchTimeline).not.toHaveBeenCalled();
    });

    it("resetBreaker clears an open breaker so a user-initiated verification goes through", async () => {
      const { resetBreaker } = await import("../lib/resilience.js");
      const inner = fakeConnector();
      (inner.fetchTimeline as ReturnType<typeof vi.fn>).mockRejectedValue(statusError(400, "down"));

      const wrapped = wrapConnector(inner, { ...FAST, breakerFailureThreshold: 1, breakerOpenMs: 60_000 });
      const id = crypto.randomUUID();
      await expect(wrapped.fetchTimeline(ctxFor(id), 10)).rejects.toThrow(/down/);
      await expect(wrapped.fetchTimeline(ctxFor(id), 10)).rejects.toThrow(/paused/i);

      resetBreaker(id);
      (inner.fetchTimeline as ReturnType<typeof vi.fn>).mockResolvedValueOnce([POST]);
      await expect(wrapped.fetchTimeline(ctxFor(id), 10)).resolves.toHaveLength(1);
    });
  });

  describe("refresh accounting and concurrency", () => {
    it("the post-refresh replay does not consume a retry attempt (401→refresh→502→502→success fits in 3 attempts)", async () => {
      const inner = fakeConnector({
        refreshCredentials: vi.fn().mockResolvedValue({ accessToken: "fresh" }),
      });
      (inner.fetchTimeline as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(statusError(401, "Unauthorized"))
        .mockRejectedValueOnce(statusError(502))
        .mockRejectedValueOnce(statusError(502))
        .mockResolvedValueOnce([POST]);

      const wrapped = wrapConnector(inner, { ...FAST, maxFetchAttempts: 3 });
      await expect(wrapped.fetchTimeline(ctxFor(crypto.randomUUID()), 10)).resolves.toHaveLength(1);
      expect(inner.fetchTimeline).toHaveBeenCalledTimes(4);
    });

    it("concurrent 401s on one connection share a single refresh (rotating tokens are single-use)", async () => {
      let releaseRefresh!: (v: unknown) => void;
      const refreshGate = new Promise((r) => (releaseRefresh = r));
      const refreshMock = vi.fn().mockImplementation(async () => {
        await refreshGate;
        return { accessToken: "fresh" };
      });
      const inner = fakeConnector({ refreshCredentials: refreshMock });
      (inner.fetchTimeline as ReturnType<typeof vi.fn>).mockImplementation(async (ctx: { accessToken?: string }) => {
        if (ctx.accessToken !== "fresh") throw statusError(401, "Unauthorized");
        return [POST];
      });

      const wrapped = wrapConnector(inner, FAST);
      const id = crypto.randomUUID();
      const ctx = { handle: "@x", accessToken: "stale", connectionId: id };

      const a = wrapped.fetchTimeline(ctx, 10);
      const b = wrapped.fetchTimeline(ctx, 10);
      await new Promise((r) => setTimeout(r, 10));
      releaseRefresh(null);

      await expect(a).resolves.toHaveLength(1);
      await expect(b).resolves.toHaveLength(1);
      expect(refreshMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("registry integration", () => {
    it("wraps live connectors with resilience (retries happen through getConnector)", async () => {
      const spy = vi.fn().mockRejectedValueOnce(statusError(502)).mockResolvedValueOnce([POST]);
      registerLiveConnector("threads", () => ({
        platform: "threads" as const,
        fetchTimeline: spy,
        publish: vi.fn(),
      }));
      try {
        const connector = getConnector("threads", true);
        const posts = await connector.fetchTimeline(ctxFor(crypto.randomUUID()), 10);
        expect(posts).toHaveLength(1);
        expect(spy).toHaveBeenCalledTimes(2);
      } finally {
        __resetRegistryForTests();
      }
    });

    it("does not wrap demo connectors (no live registration → raw demo, deterministic)", async () => {
      const demo = getConnector("twitter", false);
      const posts = await demo.fetchTimeline({ handle: "@demo" }, 3);
      expect(posts.length).toBeGreaterThan(0);
    });
  });
});
