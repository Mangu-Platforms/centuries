import { afterEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";

// Phase D5 (read-only): GET /api/feed/:id/thread — the locally cached post
// as root, connector-supplied replies, capability-gated per connection.

const { buildApp } = await import("../app.js");
const { prisma } = await import("../db.js");
const { registerLiveConnector, __resetRegistryForTests } = await import("../connectors/registry.js");
const { encryptSecret } = await import("../lib/crypto.js");

async function registerUser(app: Awaited<ReturnType<typeof buildApp>>) {
  const email = `feed-thread-${crypto.randomUUID()}@nexus.app`;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, password: "password123", displayName: "Thread Test" },
  });
  const body = res.json();
  return { token: body.token as string, userId: body.user.id as string };
}

describe("GET /api/feed/:id/thread (D5)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the locally cached post as root plus deterministic demo replies", async () => {
    const app = await buildApp();
    const { token, userId } = await registerUser(app);

    await app.inject({
      method: "POST",
      url: "/api/connections",
      headers: { authorization: `Bearer ${token}` },
      payload: { platform: "twitter", handle: "threaddemo" },
    });

    const feed = await app.inject({
      method: "GET",
      url: "/api/feed",
      headers: { authorization: `Bearer ${token}` },
    });
    const post = feed.json().posts[0];
    expect(post.threadAvailable).toBe(true);

    const res = await app.inject({
      method: "GET",
      url: `/api/feed/${post.id}/thread`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Root is the LOCAL row — same id, same liked/bookmarked state.
    expect(body.root.id).toBe(post.id);
    expect(body.root.content).toBe(post.content);
    expect(body.replies.length).toBeGreaterThanOrEqual(2);
    for (const reply of body.replies) {
      expect(reply.externalId).not.toBe(post.externalId);
      expect(reply.authorHandle).toMatch(/^@/);
      expect(reply.content.length).toBeGreaterThan(0);
    }

    // Deterministic: a second fetch renders the same thread.
    const again = await app.inject({
      method: "GET",
      url: `/api/feed/${post.id}/thread`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(again.json().replies.map((r: { externalId: string }) => r.externalId)).toEqual(
      body.replies.map((r: { externalId: string }) => r.externalId),
    );

    await prisma.user.delete({ where: { id: userId } });
    await app.close();
  });

  it("404s (capability-gated) for a live connection whose connector has no fetchThread", async () => {
    // A live connector registered WITHOUT thread support, resolved because
    // the connection holds credentials.
    registerLiveConnector("mastodon", () => ({
      platform: "mastodon" as const,
      fetchTimeline: vi.fn().mockResolvedValue([]),
      publish: vi.fn(),
    }));

    try {
      const app = await buildApp();
      const { token, userId } = await registerUser(app);

      const connection = await prisma.connection.create({
        data: {
          userId,
          platform: "mastodon",
          handle: "@nothread@masto.example",
          instance: "masto.example",
          accessTokenEnc: encryptSecret("live-token"),
        },
      });
      const post = await prisma.feedPost.create({
        data: {
          userId,
          connectionId: connection.id,
          platform: "mastodon",
          externalId: "https://masto.example/@nothread/1",
          authorHandle: "@nothread@masto.example",
          authorName: "No Thread",
          authorAvatar: "",
          content: "a live post",
          mediaUrls: "[]",
          postedAt: new Date(),
        },
      });

      // The feed marks it thread-unavailable…
      const feed = await app.inject({
        method: "GET",
        url: "/api/feed",
        headers: { authorization: `Bearer ${token}` },
      });
      const feedPost = feed.json().posts.find((p: { id: string }) => p.id === post.id);
      expect(feedPost.threadAvailable).toBe(false);

      // …and the thread route capability-gates.
      const res = await app.inject({
        method: "GET",
        url: `/api/feed/${post.id}/thread`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toMatch(/aren't available/);

      await prisma.user.delete({ where: { id: userId } });
      await app.close();
    } finally {
      __resetRegistryForTests();
      // Re-register the real live connectors cleared by the reset — other
      // suites in this worker may rely on module-load registration.
      const { MastodonConnector } = await import("../connectors/mastodon.js");
      const { BlueskyConnector } = await import("../connectors/bluesky.js");
      registerLiveConnector("mastodon", () => new MastodonConnector());
      registerLiveConnector("bluesky", () => new BlueskyConnector());
    }
  });

  it("404s for an unknown post and for another user's post", async () => {
    const app = await buildApp();
    const { token: tokenA, userId: userA } = await registerUser(app);
    const { token: tokenB, userId: userB } = await registerUser(app);

    await app.inject({
      method: "POST",
      url: "/api/connections",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { platform: "threads", handle: "threadowner" },
    });
    const feed = await app.inject({
      method: "GET",
      url: "/api/feed",
      headers: { authorization: `Bearer ${tokenA}` },
    });
    const postId = feed.json().posts[0].id as string;

    const unknown = await app.inject({
      method: "GET",
      url: "/api/feed/nonexistent/thread",
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(unknown.statusCode).toBe(404);

    const foreign = await app.inject({
      method: "GET",
      url: `/api/feed/${postId}/thread`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(foreign.statusCode).toBe(404);

    await prisma.user.delete({ where: { id: userA } });
    await prisma.user.delete({ where: { id: userB } });
    await app.close();
  });
});
