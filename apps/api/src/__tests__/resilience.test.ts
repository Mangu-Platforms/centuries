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
