import crypto from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { prisma } from "../db.js";
import { registerLiveConnector, __resetRegistryForTests } from "../connectors/registry.js";
import type { PlatformConnector } from "../connectors/types.js";
import { encryptSecret } from "../lib/crypto.js";

function uniqueEmail(): string {
  return `mirror-test-${crypto.randomUUID()}@nexus.app`;
}

async function registerAndGetToken(app: Awaited<ReturnType<typeof buildApp>>) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: uniqueEmail(), password: "password123", displayName: "Mirror Test" },
  });
  const body = res.json();
  return { token: body.token as string, userId: body.user.id as string };
}

async function createMirrorablePost(
  userId: string,
  connectionId: string | null,
  overrides: Partial<{ platform: string; mirrorRef: string; likeMirrorRef: string; liked: boolean; bookmarked: boolean }> = {},
) {
  return prisma.feedPost.create({
    data: {
      userId,
      connectionId,
      platform: overrides.platform ?? "bluesky",
      externalId: crypto.randomUUID(),
      authorHandle: "@someone",
      authorName: "Someone",
      authorAvatar: "",
      content: "hello world",
      liked: overrides.liked ?? false,
      bookmarked: overrides.bookmarked ?? false,
      mirrorRef: overrides.mirrorRef ?? "",
      likeMirrorRef: overrides.likeMirrorRef ?? "",
    },
  });
}

describe("Phase F2: mirrored likes/bookmarks", () => {
  afterEach(async () => {
    __resetRegistryForTests();
    await prisma.user.deleteMany({ where: { email: { contains: "mirror-test-" } } });
  });

  it("likes/bookmarks locally without attempting a mirror when the post has no mirrorRef (e.g. demo-imported)", async () => {
    const app = await buildApp();
    const { token, userId } = await registerAndGetToken(app);
    const post = await createMirrorablePost(userId, null, { platform: "twitter" }); // no mirrorRef, no connectionId

    const res = await app.inject({
      method: "POST",
      url: `/api/feed/${post.id}/like`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.post.liked).toBe(true);
    expect(body.mirrorError).toBeUndefined();

    await app.close();
  });

  it("mirrors a like to a live connector that supports setLiked, and persists the returned likeMirrorRef", async () => {
    let calledWith: unknown = null;
    const fake: PlatformConnector = {
      platform: "bluesky",
      async fetchTimeline() {
        return [];
      },
      async publish() {
        throw new Error("not used");
      },
      async setLiked(_ctx, ref, liked) {
        calledWith = { ref, liked };
        return { likeMirrorRef: "at://did:example/app.bsky.feed.like/abc123" };
      },
    };
    registerLiveConnector("bluesky", () => fake);

    const app = await buildApp();
    const { token, userId } = await registerAndGetToken(app);
    const connection = await prisma.connection.create({
      data: { userId, platform: "bluesky", handle: "@x.bsky.social", appPasswordEnc: encryptSecret("pw") },
    });
    const post = await createMirrorablePost(userId, connection.id, {
      platform: "bluesky",
      mirrorRef: JSON.stringify({ uri: "at://did:example/app.bsky.feed.post/xyz", cid: "bafyabc" }),
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/feed/${post.id}/like`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.post.liked).toBe(true);
    expect(body.mirrorError).toBeUndefined();
    expect(calledWith).toMatchObject({ liked: true });

    const stored = await prisma.feedPost.findUniqueOrThrow({ where: { id: post.id } });
    expect(stored.likeMirrorRef).toBe("at://did:example/app.bsky.feed.like/abc123");

    await app.close();
  });

  it("clears the stored likeMirrorRef on unlike", async () => {
    const fake: PlatformConnector = {
      platform: "bluesky",
      async fetchTimeline() {
        return [];
      },
      async publish() {
        throw new Error("not used");
      },
      async setLiked(_ctx, ref, liked) {
        expect(liked).toBe(false);
        expect(ref.likeMirrorRef).toBe("at://did:example/app.bsky.feed.like/abc123");
        // Real connector returns void on unlike (nothing to hand back).
      },
    };
    registerLiveConnector("bluesky", () => fake);

    const app = await buildApp();
    const { token, userId } = await registerAndGetToken(app);
    const connection = await prisma.connection.create({
      data: { userId, platform: "bluesky", handle: "@x.bsky.social", appPasswordEnc: encryptSecret("pw") },
    });
    const post = await createMirrorablePost(userId, connection.id, {
      platform: "bluesky",
      mirrorRef: JSON.stringify({ uri: "at://did:example/app.bsky.feed.post/xyz", cid: "bafyabc" }),
      likeMirrorRef: "at://did:example/app.bsky.feed.like/abc123",
      liked: true,
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/feed/${post.id}/like`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().post.liked).toBe(false);

    const stored = await prisma.feedPost.findUniqueOrThrow({ where: { id: post.id } });
    expect(stored.likeMirrorRef).toBe("");

    await app.close();
  });

  it("still applies the local like and reports mirrorError when the live connector's mirror call fails", async () => {
    const fake: PlatformConnector = {
      platform: "mastodon",
      async fetchTimeline() {
        return [];
      },
      async publish() {
        throw new Error("not used");
      },
      async setLiked() {
        throw new Error("instance rejected the favourite");
      },
    };
    registerLiveConnector("mastodon", () => fake);

    const app = await buildApp();
    const { token, userId } = await registerAndGetToken(app);
    const connection = await prisma.connection.create({
      data: {
        userId,
        platform: "mastodon",
        handle: "@x@mastodon.social",
        instance: "mastodon.social",
        accessTokenEnc: encryptSecret("token"),
      },
    });
    const post = await createMirrorablePost(userId, connection.id, { platform: "mastodon", mirrorRef: "status-123" });

    const res = await app.inject({
      method: "POST",
      url: `/api/feed/${post.id}/like`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // The local like must still succeed -- a flaky third-party API is not a
    // reason to lose the user's local like entirely.
    expect(body.post.liked).toBe(true);
    expect(body.mirrorError).toMatch(/instance rejected the favourite/);

    await app.close();
  });

  it("mirrors a bookmark to a connector that supports setBookmarked", async () => {
    const bookmarkCalls: boolean[] = [];
    const fake: PlatformConnector = {
      platform: "mastodon",
      async fetchTimeline() {
        return [];
      },
      async publish() {
        throw new Error("not used");
      },
      async setBookmarked(_ctx, _ref, bookmarked) {
        bookmarkCalls.push(bookmarked);
      },
    };
    registerLiveConnector("mastodon", () => fake);

    const app = await buildApp();
    const { token, userId } = await registerAndGetToken(app);
    const connection = await prisma.connection.create({
      data: {
        userId,
        platform: "mastodon",
        handle: "@x@mastodon.social",
        instance: "mastodon.social",
        accessTokenEnc: encryptSecret("token"),
      },
    });
    const post = await createMirrorablePost(userId, connection.id, { platform: "mastodon", mirrorRef: "status-123" });

    const res = await app.inject({
      method: "POST",
      url: `/api/feed/${post.id}/bookmark`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().post.bookmarked).toBe(true);
    expect(bookmarkCalls).toEqual([true]);

    await app.close();
  });

  it("bookmarking stays local-only for a live connector with no setBookmarked (e.g. Bluesky)", async () => {
    const fake: PlatformConnector = {
      platform: "bluesky",
      async fetchTimeline() {
        return [];
      },
      async publish() {
        throw new Error("not used");
      },
      // Deliberately no setBookmarked.
    };
    registerLiveConnector("bluesky", () => fake);

    const app = await buildApp();
    const { token, userId } = await registerAndGetToken(app);
    const connection = await prisma.connection.create({
      data: { userId, platform: "bluesky", handle: "@x.bsky.social", appPasswordEnc: encryptSecret("pw") },
    });
    const post = await createMirrorablePost(userId, connection.id, {
      platform: "bluesky",
      mirrorRef: JSON.stringify({ uri: "at://did:example/app.bsky.feed.post/xyz", cid: "bafyabc" }),
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/feed/${post.id}/bookmark`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().post.bookmarked).toBe(true);
    expect(res.json().mirrorError).toBeUndefined();

    await app.close();
  });

  it("never leaks mirrorRef/likeMirrorRef in the serialized response", async () => {
    const app = await buildApp();
    const { token, userId } = await registerAndGetToken(app);
    const post = await createMirrorablePost(userId, null, { mirrorRef: "should-not-leak", likeMirrorRef: "should-not-leak-either" });

    const res = await app.inject({
      method: "GET",
      url: "/api/feed",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const found = res.json().posts.find((p: { id: string }) => p.id === post.id);
    expect(found).toBeDefined();
    expect(found.mirrorRef).toBeUndefined();
    expect(found.likeMirrorRef).toBeUndefined();

    await app.close();
  });
});
