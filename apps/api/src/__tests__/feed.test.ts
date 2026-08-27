import crypto from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { prisma } from "../db.js";

function uniqueEmail(): string {
  return `feed-test-${crypto.randomUUID()}@nexus.app`;
}

async function registerAndGetToken(app: Awaited<ReturnType<typeof buildApp>>) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: uniqueEmail(), password: "password123", displayName: "Feed Test" },
  });
  const body = res.json();
  return { token: body.token as string, userId: body.user.id as string };
}

async function createPost(
  userId: string,
  overrides: Partial<{ externalId: string; platform: string; postedAt: Date; content: string; bookmarked: boolean }> = {},
) {
  return prisma.feedPost.create({
    data: {
      userId,
      platform: overrides.platform ?? "bluesky",
      externalId: overrides.externalId ?? crypto.randomUUID(),
      authorHandle: "@someone",
      authorName: "Someone",
      authorAvatar: "",
      content: overrides.content ?? "hello world",
      postedAt: overrides.postedAt ?? new Date(),
      bookmarked: overrides.bookmarked ?? false,
    },
  });
}

describe("Phase D2: feed pagination + filters", () => {
  afterEach(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: "feed-test-" } } });
  });

  // Note: this test passes even without routes/feed.ts's orderBy tiebreaker
  // fix, because SQLite (this test's datasource) happens to preserve
  // insertion order for ties on an unindexed-for-that-purpose column across
  // repeated queries within one unmutated table — that's implementation
  // behavior, not a guarantee. The fix targets production's Postgres
  // datasource, which makes no such promise (a different query plan, an
  // index, or a concurrent write between two paginated requests can break
  // ties differently). This test still earns its keep as positive coverage
  // that pagination is correct in this exact scenario, and as a guard that
  // would catch a *worse* regression (e.g. an accidentally non-deterministic
  // orderBy expression) even if it can't reproduce this specific class of
  // bug under SQLite.
  it("paginates forward through a cursor without skipping or repeating posts, even when many posts share the same postedAt", async () => {
    const app = await buildApp();
    const { token, userId } = await registerAndGetToken(app);

    // All ten posts share the exact same postedAt — the case that would
    // break naive cursor pagination without a deterministic tiebreaker.
    const sharedPostedAt = new Date("2026-01-01T00:00:00.000Z");
    const created = [];
    for (let i = 0; i < 10; i++) {
      created.push(await createPost(userId, { postedAt: sharedPostedAt }));
    }

    const seenIds: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const res = await app.inject({
        method: "GET",
        url: `/api/feed?limit=3${cursor ? `&cursor=${cursor}` : ""}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      seenIds.push(...body.posts.map((p: { id: string }) => p.id));
      if (!body.nextCursor) break;
      cursor = body.nextCursor;
    }

    expect(seenIds).toHaveLength(created.length);
    expect(new Set(seenIds).size).toBe(created.length); // no duplicates across pages
    expect(new Set(seenIds)).toEqual(new Set(created.map((p) => p.id))); // nothing skipped

    await app.close();
  });

  it("filters by platform", async () => {
    const app = await buildApp();
    const { token, userId } = await registerAndGetToken(app);
    await createPost(userId, { platform: "bluesky" });
    await createPost(userId, { platform: "mastodon" });

    const res = await app.inject({
      method: "GET",
      url: "/api/feed?platform=mastodon",
      headers: { authorization: `Bearer ${token}` },
    });
    const body = res.json();
    expect(body.posts).toHaveLength(1);
    expect(body.posts[0].platform).toBe("mastodon");

    await app.close();
  });

  it("filters by search text", async () => {
    const app = await buildApp();
    const { token, userId } = await registerAndGetToken(app);
    await createPost(userId, { content: "shipping a new feature today" });
    await createPost(userId, { content: "completely unrelated content" });

    const res = await app.inject({
      method: "GET",
      url: "/api/feed?search=feature",
      headers: { authorization: `Bearer ${token}` },
    });
    const body = res.json();
    expect(body.posts).toHaveLength(1);
    expect(body.posts[0].content).toContain("feature");

    await app.close();
  });

  it("filters to bookmarked posts only", async () => {
    const app = await buildApp();
    const { token, userId } = await registerAndGetToken(app);
    await createPost(userId, { bookmarked: true });
    await createPost(userId, { bookmarked: false });

    const res = await app.inject({
      method: "GET",
      url: "/api/feed?bookmarked=true",
      headers: { authorization: `Bearer ${token}` },
    });
    const body = res.json();
    expect(body.posts).toHaveLength(1);
    expect(body.posts[0].bookmarked).toBe(true);

    await app.close();
  });

  it("never returns another user's posts", async () => {
    const app = await buildApp();
    const { userId: otherUserId } = await registerAndGetToken(app);
    await createPost(otherUserId);

    const { token } = await registerAndGetToken(app);
    const res = await app.inject({ method: "GET", url: "/api/feed", headers: { authorization: `Bearer ${token}` } });
    expect(res.json().posts).toHaveLength(0);

    await app.close();
  });
});

describe("multi-term search (D6)", () => {
  it("ANDs terms across content, author handle, and author name", async () => {
    const app = await buildApp();
    const email = `feed-search-${crypto.randomUUID()}@nexus.app`;
    const reg = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email, password: "password123", displayName: "Search Test" },
    });
    const token = reg.json().token as string;
    const userId = reg.json().user.id as string;

    const connection = await prisma.connection.create({
      data: { userId, platform: "twitter", handle: "@searcher" },
    });
    const base = {
      userId,
      connectionId: connection.id,
      platform: "twitter",
      authorAvatar: "",
      mediaUrls: "[]",
      postedAt: new Date(),
    };
    await prisma.feedPost.createMany({
      data: [
        { ...base, externalId: "s1", authorHandle: "@alicedev", authorName: "Alice", content: "shipping the beta today" },
        { ...base, externalId: "s2", authorHandle: "@bob", authorName: "Bob", content: "beta feedback thread" },
        { ...base, externalId: "s3", authorHandle: "@alicedev", authorName: "Alice", content: "weekend hike photos" },
      ],
    });

    const search = async (query: string) => {
      const res = await app.inject({
        method: "GET",
        url: `/api/feed?search=${encodeURIComponent(query)}`,
        headers: { authorization: `Bearer ${token}` },
      });
      return (res.json().posts as Array<{ externalId: string }>).map((p) => p.externalId).sort();
    };

    // One term matches content OR author fields.
    expect(await search("beta")).toEqual(["s1", "s2"]);
    expect(await search("alicedev")).toEqual(["s1", "s3"]);
    // Terms AND together — one may match the author, another the content.
    expect(await search("alicedev beta")).toEqual(["s1"]);
    expect(await search("beta feedback")).toEqual(["s2"]);
    // A term matching nothing eliminates everything.
    expect(await search("beta nonexistentterm")).toEqual([]);

    await prisma.user.delete({ where: { id: userId } });
    await app.close();
  });
});
