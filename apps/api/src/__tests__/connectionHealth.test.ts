import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";

// Phase C6 + C1b: connection health. Covers the lastSyncedAt/lastError
// columns (written by the initial import and the periodic sync), their
// exposure through publicConnection, and the reconnect route.

const { loginMock, getTimelineMock, AtpAgentMock } = vi.hoisted(() => {
  const loginMock = vi.fn();
  const getTimelineMock = vi.fn();
  const AtpAgentMock = vi.fn().mockImplementation(() => ({
    login: loginMock,
    getTimeline: getTimelineMock,
    post: vi.fn(),
  }));
  return { loginMock, getTimelineMock, AtpAgentMock };
});

vi.mock("@atproto/api", () => ({ AtpAgent: AtpAgentMock }));

const { buildApp } = await import("../app.js");
const { prisma } = await import("../db.js");
const { syncConnection } = await import("../lib/sync.js");
const { decryptSecret } = await import("../lib/crypto.js");

const LIVE_TIMELINE = {
  data: {
    feed: [
      {
        post: {
          uri: "at://did:plc:health/app.bsky.feed.post/1",
          cid: "c1",
          author: { did: "did:plc:health", handle: "healthy.bsky.social", displayName: "Healthy" },
          record: { text: "a live post" },
          likeCount: 1,
          repostCount: 0,
          replyCount: 0,
          indexedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    ],
  },
};

async function registerUser(app: Awaited<ReturnType<typeof buildApp>>) {
  const email = `conn-health-${crypto.randomUUID()}@nexus.app`;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, password: "password123", displayName: "Health Test" },
  });
  const body = res.json();
  return { token: body.token as string, userId: body.user.id as string };
}

describe("connection health (C6 + C1b)", () => {
  beforeEach(() => {
    loginMock.mockReset();
    getTimelineMock.mockReset();
    AtpAgentMock.mockClear();
  });

  afterEach(async () => {
    vi.clearAllMocks();
  });

  it("stamps lastSyncedAt and exposes health fields on a successful demo connect", async () => {
    const app = await buildApp();
    const { token, userId } = await registerUser(app);

    const res = await app.inject({
      method: "POST",
      url: "/api/connections",
      headers: { authorization: `Bearer ${token}` },
      payload: { platform: "twitter", handle: "healthcheck" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.connection.lastError).toBe("");
    expect(body.connection.lastSyncedAt).toBeTruthy();
    expect(new Date(body.connection.lastSyncedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
    // Encrypted material still never leaves the API.
    expect(body.connection.appPasswordEnc).toBeUndefined();
    expect(body.connection.accessTokenEnc).toBeUndefined();

    await prisma.user.delete({ where: { id: userId } });
    await app.close();
  });

  it("records lastError (and no lastSyncedAt) when a live credential is rejected at connect time", async () => {
    loginMock.mockRejectedValue(new Error("Invalid identifier or password"));

    const app = await buildApp();
    const { token, userId } = await registerUser(app);

    const res = await app.inject({
      method: "POST",
      url: "/api/connections",
      headers: { authorization: `Bearer ${token}` },
      payload: { platform: "bluesky", handle: "bad.bsky.social", credential: "wrong-password" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.warning).toMatch(/Invalid identifier or password/);
    expect(body.connection.status).toBe("error");
    expect(body.connection.lastError).toMatch(/Invalid identifier or password/);
    expect(body.connection.lastSyncedAt).toBeNull();

    const stored = await prisma.connection.findUnique({ where: { id: body.connection.id } });
    expect(stored?.lastError).toMatch(/Invalid identifier or password/);
    expect(stored?.lastSyncedAt).toBeNull();

    await prisma.user.delete({ where: { id: userId } });
    await app.close();
  });

  it("syncConnection stamps lastSyncedAt, clears lastError, and self-heals an errored connection", async () => {
    const app = await buildApp();
    const { token, userId } = await registerUser(app);

    const connectRes = await app.inject({
      method: "POST",
      url: "/api/connections",
      headers: { authorization: `Bearer ${token}` },
      payload: { platform: "threads", handle: "healme" },
    });
    const connectionId = connectRes.json().connection.id as string;

    // Simulate a previously failed sync.
    await prisma.connection.update({
      where: { id: connectionId },
      data: { status: "error", lastError: "boom", lastSyncedAt: null },
    });

    const result = await syncConnection((await prisma.connection.findUniqueOrThrow({ where: { id: connectionId } })));
    expect(result.error).toBeUndefined();

    const healed = await prisma.connection.findUniqueOrThrow({ where: { id: connectionId } });
    expect(healed.status).toBe("active");
    expect(healed.lastError).toBe("");
    expect(healed.lastSyncedAt).not.toBeNull();

    await prisma.user.delete({ where: { id: userId } });
    await app.close();
  });

  it("syncConnection records lastError and flips status to error when the fetch fails", async () => {
    loginMock.mockResolvedValueOnce({});
    getTimelineMock.mockResolvedValueOnce(LIVE_TIMELINE);

    const app = await buildApp();
    const { token, userId } = await registerUser(app);

    const connectRes = await app.inject({
      method: "POST",
      url: "/api/connections",
      headers: { authorization: `Bearer ${token}` },
      payload: { platform: "bluesky", handle: "flaky.bsky.social", credential: "initially-fine" },
    });
    const connectionId = connectRes.json().connection.id as string;
    expect(connectRes.json().connection.status).toBe("active");

    // The next login attempt (during sync) fails.
    loginMock.mockRejectedValue(new Error("Rate limited"));

    const result = await syncConnection((await prisma.connection.findUniqueOrThrow({ where: { id: connectionId } })));
    expect(result.error).toMatch(/Rate limited/);

    const broken = await prisma.connection.findUniqueOrThrow({ where: { id: connectionId } });
    expect(broken.status).toBe("error");
    expect(broken.lastError).toMatch(/Rate limited/);

    await prisma.user.delete({ where: { id: userId } });
    await app.close();
  });

  describe("POST /api/connections/:id/reconnect", () => {
    it("404s for a connection the caller does not own", async () => {
      const app = await buildApp();
      const { token: tokenA, userId: userA } = await registerUser(app);
      const { token: tokenB, userId: userB } = await registerUser(app);

      const connectRes = await app.inject({
        method: "POST",
        url: "/api/connections",
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { platform: "twitter", handle: "mine" },
      });
      const connectionId = connectRes.json().connection.id as string;

      const res = await app.inject({
        method: "POST",
        url: `/api/connections/${connectionId}/reconnect`,
        headers: { authorization: `Bearer ${tokenB}` },
        payload: {},
      });
      expect(res.statusCode).toBe(404);

      await prisma.user.delete({ where: { id: userA } });
      await prisma.user.delete({ where: { id: userB } });
      await app.close();
    });

    it("re-encrypts a newly supplied app password, re-imports, and heals the connection", async () => {
      // Initial connect fails (bad password) …
      loginMock.mockRejectedValueOnce(new Error("Invalid identifier or password"));

      const app = await buildApp();
      const { token, userId } = await registerUser(app);

      const connectRes = await app.inject({
        method: "POST",
        url: "/api/connections",
        headers: { authorization: `Bearer ${token}` },
        payload: { platform: "bluesky", handle: "recover.bsky.social", credential: "wrong-password" },
      });
      const connectionId = connectRes.json().connection.id as string;
      expect(connectRes.json().connection.status).toBe("error");

      // … the reconnect with a good password succeeds.
      loginMock.mockResolvedValue({});
      getTimelineMock.mockResolvedValue(LIVE_TIMELINE);

      const res = await app.inject({
        method: "POST",
        url: `/api/connections/${connectionId}/reconnect`,
        headers: { authorization: `Bearer ${token}` },
        payload: { credential: "correct-password" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.warning).toBeUndefined();
      expect(body.importedPosts).toBe(1);
      expect(body.connection.status).toBe("active");
      expect(body.connection.lastError).toBe("");
      expect(body.connection.lastSyncedAt).toBeTruthy();
      expect(body.connection.appPasswordEnc).toBeUndefined();

      const stored = await prisma.connection.findUniqueOrThrow({ where: { id: connectionId } });
      expect(decryptSecret(stored.appPasswordEnc)).toBe("correct-password");
      expect(loginMock).toHaveBeenLastCalledWith({ identifier: "recover.bsky.social", password: "correct-password" });

      await prisma.user.delete({ where: { id: userId } });
      await app.close();
    });

    it("keeps the connection in error (with a warning) when the reconnect credential is also bad", async () => {
      loginMock.mockRejectedValue(new Error("Invalid identifier or password"));

      const app = await buildApp();
      const { token, userId } = await registerUser(app);

      const connectRes = await app.inject({
        method: "POST",
        url: "/api/connections",
        headers: { authorization: `Bearer ${token}` },
        payload: { platform: "bluesky", handle: "stillbad.bsky.social", credential: "wrong-password" },
      });
      const connectionId = connectRes.json().connection.id as string;

      const res = await app.inject({
        method: "POST",
        url: `/api/connections/${connectionId}/reconnect`,
        headers: { authorization: `Bearer ${token}` },
        payload: { credential: "also-wrong" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.warning).toMatch(/Invalid identifier or password/);
      expect(body.connection.status).toBe("error");
      expect(body.connection.lastError).toMatch(/Invalid identifier or password/);

      await prisma.user.delete({ where: { id: userId } });
      await app.close();
    });

    it("re-fetches a credential-less (demo) connection without requiring a credential", async () => {
      const app = await buildApp();
      const { token, userId } = await registerUser(app);

      const connectRes = await app.inject({
        method: "POST",
        url: "/api/connections",
        headers: { authorization: `Bearer ${token}` },
        payload: { platform: "twitter", handle: "demoreconnect" },
      });
      const connectionId = connectRes.json().connection.id as string;

      await prisma.connection.update({
        where: { id: connectionId },
        data: { status: "error", lastError: "old failure" },
      });

      const res = await app.inject({
        method: "POST",
        url: `/api/connections/${connectionId}/reconnect`,
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.connection.status).toBe("active");
      expect(body.connection.lastError).toBe("");
      expect(body.connection.lastSyncedAt).toBeTruthy();

      await prisma.user.delete({ where: { id: userId } });
      await app.close();
    });
  });
});
