import { afterEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";

// Phase F2: like/bookmark toggles mirror to the platform best-effort —
// the local toggle is the source of truth and never rolls back on a
// mirror failure.

const { buildApp } = await import("../app.js");
const { prisma } = await import("../db.js");
const { registerLiveConnector, __resetRegistryForTests } = await import("../connectors/registry.js");
const { encryptSecret } = await import("../lib/crypto.js");

async function registerUser(app: Awaited<ReturnType<typeof buildApp>>) {
  const email = `mirror-${crypto.randomUUID()}@nexus.app`;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, password: "password123", displayName: "Mirror Test" },
  });
  const body = res.json();
  return { token: body.token as string, userId: body.user.id as string };
}

async function makeLivePost(userId: string, platform: string) {
  const connection = await prisma.connection.create({
    data: {
      userId,
      platform,
      handle: `@mirror-${crypto.randomUUID().slice(0, 8)}`,
      instance: "mirror.example",
      accessTokenEnc: encryptSecret("mirror-token"),
    },
  });
  const post = await prisma.feedPost.create({
    data: {
      userId,
      connectionId: connection.id,
      platform,
      externalId: `mirror-ext-${crypto.randomUUID().slice(0, 8)}`,
      authorHandle: "@someone",
      authorName: "Someone",
      authorAvatar: "",
      content: "mirror me",
      mediaUrls: "[]",
      postedAt: new Date(),
    },
  });
  return { connection, post };
}

async function restoreRealConnectors() {
  __resetRegistryForTests();
  const { MastodonConnector } = await import("../connectors/mastodon.js");
  const { BlueskyConnector } = await import("../connectors/bluesky.js");
  registerLiveConnector("mastodon", () => new MastodonConnector());
  registerLiveConnector("bluesky", () => new BlueskyConnector());
}

describe("engagement mirroring (F2)", () => {
  afterEach(async () => {
    await restoreRealConnectors();
    vi.restoreAllMocks();
  });

  it("mirrors a like toggle (and its undo) through a capable connector", async () => {
    const setLike = vi.fn().mockResolvedValue(undefined);
    registerLiveConnector("threads", () => ({
      platform: "threads" as const,
      fetchTimeline: async () => [],
      publish: vi.fn(),
      setLike,
    }));

    const app = await buildApp();
    const { token, userId } = await registerUser(app);
    const { connection, post } = await makeLivePost(userId, "threads");

    const likeRes = await app.inject({
      method: "POST",
      url: `/api/feed/${post.id}/like`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(likeRes.statusCode).toBe(200);
    expect(likeRes.json().post.liked).toBe(true);
    expect(setLike).toHaveBeenCalledTimes(1);
    expect(setLike.mock.calls[0][0].accessToken).toBe("mirror-token");
    expect(setLike.mock.calls[0][0].connectionId).toBe(connection.id);
    expect(setLike.mock.calls[0][1]).toBe(post.externalId);
    expect(setLike.mock.calls[0][2]).toBe(true);

    const unlikeRes = await app.inject({
      method: "POST",
      url: `/api/feed/${post.id}/like`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(unlikeRes.json().post.liked).toBe(false);
    expect(setLike).toHaveBeenCalledTimes(2);
    expect(setLike.mock.calls[1][2]).toBe(false);

    await prisma.user.delete({ where: { id: userId } });
    await app.close();
  });

  it("a mirror failure never fails the request or rolls back the local toggle", async () => {
    const setBookmark = vi.fn().mockRejectedValue(new Error("platform down"));
    registerLiveConnector("threads", () => ({
      platform: "threads" as const,
      fetchTimeline: async () => [],
      publish: vi.fn(),
      setBookmark,
    }));

    const app = await buildApp();
    const { token, userId } = await registerUser(app);
    const { post } = await makeLivePost(userId, "threads");

    const res = await app.inject({
      method: "POST",
      url: `/api/feed/${post.id}/bookmark`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().post.bookmarked).toBe(true);
    expect(setBookmark).toHaveBeenCalledTimes(1);
    expect((await prisma.feedPost.findUniqueOrThrow({ where: { id: post.id } })).bookmarked).toBe(true);

    await prisma.user.delete({ where: { id: userId } });
    await app.close();
  });

  it("an incapable connector (no setLike) is simply skipped", async () => {
    registerLiveConnector("threads", () => ({
      platform: "threads" as const,
      fetchTimeline: async () => [],
      publish: vi.fn(),
    }));

    const app = await buildApp();
    const { token, userId } = await registerUser(app);
    const { post } = await makeLivePost(userId, "threads");

    const res = await app.inject({
      method: "POST",
      url: `/api/feed/${post.id}/like`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().post.liked).toBe(true);

    await prisma.user.delete({ where: { id: userId } });
    await app.close();
  });

  it("demo connectors mirror as a no-op success (zero-credential path exercises the same code)", async () => {
    const app = await buildApp();
    const { token, userId } = await registerUser(app);

    await app.inject({
      method: "POST",
      url: "/api/connections",
      headers: { authorization: `Bearer ${token}` },
      payload: { platform: "twitter", handle: "mirrordemo" },
    });
    const feed = await app.inject({
      method: "GET",
      url: "/api/feed",
      headers: { authorization: `Bearer ${token}` },
    });
    const postId = feed.json().posts[0].id as string;

    const res = await app.inject({
      method: "POST",
      url: `/api/feed/${postId}/like`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().post.liked).toBe(true);

    await prisma.user.delete({ where: { id: userId } });
    await app.close();
  });
});
