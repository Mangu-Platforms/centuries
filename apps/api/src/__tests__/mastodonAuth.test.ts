import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";

const { appsCreateMock, verifyCredentialsMock, tokenCreateMock, getTimelineMock, createRestAPIClientMock, createOAuthAPIClientMock } =
  vi.hoisted(() => {
    const appsCreateMock = vi.fn();
    const verifyCredentialsMock = vi.fn();
    const tokenCreateMock = vi.fn();
    const getTimelineMock = vi.fn().mockResolvedValue([]);
    const createRestAPIClientMock = vi.fn().mockImplementation(() => ({
      v1: {
        apps: { create: appsCreateMock },
        accounts: { verifyCredentials: verifyCredentialsMock },
        timelines: { home: { list: getTimelineMock } },
        statuses: { create: vi.fn() },
      },
    }));
    const createOAuthAPIClientMock = vi.fn().mockImplementation(() => ({
      token: { create: tokenCreateMock },
    }));
    return {
      appsCreateMock,
      verifyCredentialsMock,
      tokenCreateMock,
      getTimelineMock,
      createRestAPIClientMock,
      createOAuthAPIClientMock,
    };
  });

vi.mock("masto", () => ({
  createRestAPIClient: createRestAPIClientMock,
  createOAuthAPIClient: createOAuthAPIClientMock,
}));

const { buildApp } = await import("../app.js");
const { prisma } = await import("../db.js");
const { config } = await import("../config.js");
const { encryptSecret, decryptSecret } = await import("../lib/crypto.js");

async function registerUser(app: Awaited<ReturnType<typeof buildApp>>) {
  const email = `mastodon-oauth-test-${crypto.randomUUID()}@nexus.app`;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, password: "password123", displayName: "Test User" },
  });
  const body = res.json();
  return { token: body.token as string, userId: body.user.id as string };
}

describe("Mastodon OAuth flow", () => {
  beforeEach(() => {
    appsCreateMock.mockReset();
    verifyCredentialsMock.mockReset();
    tokenCreateMock.mockReset();
    getTimelineMock.mockReset().mockResolvedValue([]);
    createRestAPIClientMock.mockClear();
    createOAuthAPIClientMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/connections/mastodon/register", () => {
    it("dynamically registers an app and returns an opaque authorizeUrl", async () => {
      appsCreateMock.mockResolvedValue({ clientId: "cid-123", clientSecret: "very-secret-value" });

      const app = await buildApp();
      const { token, userId } = await registerUser(app);

      const res = await app.inject({
        method: "POST",
        url: "/api/connections/mastodon/register",
        headers: { authorization: `Bearer ${token}` },
        payload: { instance: "mastodon.social" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(appsCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          clientName: "NEXUS",
          redirectUris: `${config.apiPublicUrl}/api/connections/mastodon/callback`,
          scopes: "read write",
        }),
      );

      const authorizeUrl = new URL(body.authorizeUrl);
      expect(authorizeUrl.origin).toBe("https://mastodon.social");
      expect(authorizeUrl.pathname).toBe("/oauth/authorize");
      expect(authorizeUrl.searchParams.get("client_id")).toBe("cid-123");
      expect(authorizeUrl.searchParams.get("response_type")).toBe("code");
      expect(authorizeUrl.searchParams.get("redirect_uri")).toBe(`${config.apiPublicUrl}/api/connections/mastodon/callback`);

      // The raw client secret must never appear in the response outside the encrypted state blob.
      expect(JSON.stringify(body)).not.toContain("very-secret-value");

      const state = authorizeUrl.searchParams.get("state")!;
      const decoded = JSON.parse(await import("../lib/crypto.js").then((m) => m.decryptSecret(state)));
      expect(decoded).toMatchObject({ userId, instanceUrl: "https://mastodon.social", clientId: "cid-123", clientSecret: "very-secret-value" });

      await prisma.user.delete({ where: { id: userId } });
      await app.close();
    });

    it("returns 400 with a helpful message when the instance is unreachable", async () => {
      appsCreateMock.mockRejectedValue(new Error("getaddrinfo ENOTFOUND nope.invalid"));

      const app = await buildApp();
      const { token, userId } = await registerUser(app);

      const res = await app.inject({
        method: "POST",
        url: "/api/connections/mastodon/register",
        headers: { authorization: `Bearer ${token}` },
        payload: { instance: "nope.invalid" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/nope\.invalid/);

      await prisma.user.delete({ where: { id: userId } });
      await app.close();
    });

    it("requires authentication", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/api/connections/mastodon/register",
        payload: { instance: "mastodon.social" },
      });
      expect(res.statusCode).toBe(401);
      await app.close();
    });

    it("rate-limits repeated calls (CodeQL: missing rate limiting)", async () => {
      appsCreateMock.mockResolvedValue({ clientId: "cid", clientSecret: "secret" });

      const app = await buildApp();
      const { token, userId } = await registerUser(app);

      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        const res = await app.inject({
          method: "POST",
          url: "/api/connections/mastodon/register",
          headers: { authorization: `Bearer ${token}` },
          payload: { instance: "mastodon.social" },
        });
        statuses.push(res.statusCode);
      }

      // 5/minute is the configured limit — the 6th call in the same window must be rejected.
      expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
      expect(statuses[5]).toBe(429);

      await prisma.user.delete({ where: { id: userId } });
      await app.close();
    });
  });

  describe("GET /api/connections/mastodon/callback", () => {
    it("completes the flow: exchanges the code, creates the connection, imports the timeline, redirects", async () => {
      tokenCreateMock.mockResolvedValue({ accessToken: "live-access-token", tokenType: "Bearer", scope: "read write", createdAt: 1 });
      verifyCredentialsMock.mockResolvedValue({ username: "alice", acct: "alice", displayName: "Alice" });
      getTimelineMock.mockResolvedValue([
        {
          id: "1",
          uri: "https://mastodon.social/@alice/1",
          createdAt: "2026-01-01T00:00:00.000Z",
          account: { username: "alice", acct: "alice", displayName: "Alice", avatar: "" },
          content: "hi",
          mediaAttachments: [],
          favouritesCount: 0,
          reblogsCount: 0,
          repliesCount: 0,
        },
      ]);

      const app = await buildApp();
      const { userId } = await registerUser(app);
      const state = encryptSecret(
        JSON.stringify({
          userId,
          instanceUrl: "https://mastodon.social",
          clientId: "cid",
          clientSecret: "csecret",
          issuedAt: Date.now(),
        }),
      );

      const res = await app.inject({
        method: "GET",
        url: `/api/connections/mastodon/callback?code=authcode123&state=${encodeURIComponent(state)}`,
      });

      expect(res.statusCode).toBe(302);
      const location = new URL(res.headers.location as string);
      expect(location.origin + location.pathname).toBe(`${config.webAppUrl}/dashboard/connections`);
      expect(location.searchParams.get("mastodonConnected")).toBe("1");
      expect(location.searchParams.get("imported")).toBe("1");

      expect(tokenCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({ grantType: "authorization_code", clientId: "cid", clientSecret: "csecret", code: "authcode123" }),
      );

      const connection = await prisma.connection.findUnique({
        where: { userId_platform_handle: { userId, platform: "mastodon", handle: "@alice@mastodon.social" } },
      });
      expect(connection).not.toBeNull();
      expect(connection?.status).toBe("active");
      expect(connection?.accessTokenEnc).not.toBe("");
      expect(connection?.accessTokenEnc).not.toContain("live-access-token");

      const posts = await prisma.feedPost.count({ where: { connectionId: connection!.id } });
      expect(posts).toBe(1);

      await prisma.user.delete({ where: { id: userId } });
      await app.close();
    });

    it("treats an already-connected handle as a reconnect: refreshes the token and heals the connection", async () => {
      tokenCreateMock.mockResolvedValue({ accessToken: "fresh-token", tokenType: "Bearer", scope: "read write", createdAt: 2 });
      verifyCredentialsMock.mockResolvedValue({ username: "alice", acct: "alice", displayName: "Alice Renamed" });
      getTimelineMock.mockResolvedValue([]);

      const app = await buildApp();
      const { userId } = await registerUser(app);

      // An existing connection whose stored token has gone stale.
      const existing = await prisma.connection.create({
        data: {
          userId,
          platform: "mastodon",
          handle: "@alice@mastodon.social",
          displayName: "Alice",
          instance: "mastodon.social",
          status: "error",
          lastError: "The access token was revoked",
          accessTokenEnc: encryptSecret("stale-revoked-token"),
        },
      });

      const state = encryptSecret(
        JSON.stringify({
          userId,
          instanceUrl: "https://mastodon.social",
          clientId: "cid",
          clientSecret: "csecret",
          issuedAt: Date.now(),
        }),
      );

      const res = await app.inject({
        method: "GET",
        url: `/api/connections/mastodon/callback?code=authcode456&state=${encodeURIComponent(state)}`,
      });

      // Re-authorizing an already-connected account must NOT be an error —
      // it is the reconnect path (Phase C6). The fresh token replaces the
      // stale one and the connection heals.
      expect(res.statusCode).toBe(302);
      const location = new URL(res.headers.location as string);
      expect(location.searchParams.get("mastodonError")).toBeNull();
      expect(location.searchParams.get("mastodonConnected")).toBe("1");
      expect(location.searchParams.get("reconnected")).toBe("1");

      const healed = await prisma.connection.findUniqueOrThrow({ where: { id: existing.id } });
      expect(healed.status).toBe("active");
      expect(healed.lastError).toBe("");
      expect(healed.lastSyncedAt).not.toBeNull();
      expect(healed.displayName).toBe("Alice Renamed");
      expect(decryptSecret(healed.accessTokenEnc)).toBe("fresh-token");

      // Still exactly one connection for this handle — no duplicate row.
      const count = await prisma.connection.count({
        where: { userId, platform: "mastodon", handle: "@alice@mastodon.social" },
      });
      expect(count).toBe(1);

      await prisma.user.delete({ where: { id: userId } });
      await app.close();
    });

    it("redirects with an error and creates nothing when the state is tampered", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/connections/mastodon/callback?code=abc&state=not-a-valid-encrypted-blob",
      });
      expect(res.statusCode).toBe(302);
      const location = new URL(res.headers.location as string);
      expect(location.searchParams.get("mastodonError")).toMatch(/invalid|tampered/i);
      expect(tokenCreateMock).not.toHaveBeenCalled();
      await app.close();
    });

    it("redirects with an error when the state has expired", async () => {
      const app = await buildApp();
      const { userId } = await registerUser(app);
      const staleState = encryptSecret(
        JSON.stringify({
          userId,
          instanceUrl: "https://mastodon.social",
          clientId: "cid",
          clientSecret: "csecret",
          issuedAt: Date.now() - 11 * 60 * 1000, // 11 minutes ago, past the 10-minute TTL
        }),
      );

      const res = await app.inject({
        method: "GET",
        url: `/api/connections/mastodon/callback?code=abc&state=${encodeURIComponent(staleState)}`,
      });
      expect(res.statusCode).toBe(302);
      const location = new URL(res.headers.location as string);
      expect(location.searchParams.get("mastodonError")).toMatch(/expired/i);
      expect(tokenCreateMock).not.toHaveBeenCalled();

      await prisma.user.delete({ where: { id: userId } });
      await app.close();
    });

    it("redirects with an error when the instance rejects the code", async () => {
      tokenCreateMock.mockRejectedValue(new Error("invalid_grant"));

      const app = await buildApp();
      const { userId } = await registerUser(app);
      const state = encryptSecret(
        JSON.stringify({ userId, instanceUrl: "https://mastodon.social", clientId: "cid", clientSecret: "csecret", issuedAt: Date.now() }),
      );

      const res = await app.inject({
        method: "GET",
        url: `/api/connections/mastodon/callback?code=bad&state=${encodeURIComponent(state)}`,
      });
      expect(res.statusCode).toBe(302);
      const location = new URL(res.headers.location as string);
      expect(location.searchParams.get("mastodonError")).toMatch(/invalid_grant/);

      await prisma.user.delete({ where: { id: userId } });
      await app.close();
    });

    it("does not require an Authorization header (the instance redirects the browser, not an authenticated fetch)", async () => {
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/api/connections/mastodon/callback?code=x&state=y" });
      expect(res.statusCode).not.toBe(401);
      await app.close();
    });

    it("rate-limits repeated calls (CodeQL: missing rate limiting) — this is the only guard since it's unauthenticated by design", async () => {
      const app = await buildApp();

      const statuses: number[] = [];
      for (let i = 0; i < 11; i++) {
        const res = await app.inject({ method: "GET", url: `/api/connections/mastodon/callback?code=x&state=y${i}` });
        statuses.push(res.statusCode);
      }

      // 10/minute is the configured limit — the 11th call in the same window must be rejected.
      expect(statuses.slice(0, 10).every((s) => s === 302)).toBe(true);
      expect(statuses[10]).toBe(429);

      await app.close();
    });
  });
});
