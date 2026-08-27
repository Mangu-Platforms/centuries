import crypto from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../db.js";
import { registerLiveConnector, __resetRegistryForTests } from "../connectors/registry.js";
import type { PlatformConnector, RemotePost } from "../connectors/types.js";
import { encryptSecret } from "../lib/crypto.js";
import { syncAllConnections, syncConnection } from "../lib/sync.js";

function uniqueEmail(): string {
  return `sync-test-${crypto.randomUUID()}@nexus.app`;
}

function post(externalId: string, likeCount = 1): RemotePost {
  return {
    externalId,
    authorHandle: "@someone",
    authorName: "Someone",
    authorAvatar: "",
    content: "hello",
    mediaUrls: [],
    likeCount,
    repostCount: 0,
    replyCount: 0,
    postedAt: new Date(),
  };
}

async function createUser() {
  return prisma.user.create({
    data: { email: uniqueEmail(), passwordHash: "x", displayName: "Sync Test" },
  });
}

describe("Phase D1/D3: periodic sync + dedup", () => {
  afterEach(async () => {
    __resetRegistryForTests();
    await prisma.user.deleteMany({ where: { email: { contains: "sync-test-" } } });
  });

  it("imports new posts and, on a later sync, only counts genuinely new ones without duplicating rows", async () => {
    let nextPosts: RemotePost[] = [post("p1"), post("p2")];
    const fake: PlatformConnector = {
      platform: "bluesky",
      async fetchTimeline() {
        return nextPosts;
      },
      async publish() {
        return { externalId: "x", latencyMs: 1 };
      },
    };
    registerLiveConnector("bluesky", () => fake);

    const user = await createUser();
    const connection = await prisma.connection.create({
      data: {
        userId: user.id,
        platform: "bluesky",
        handle: "@x.bsky.social",
        status: "active",
        appPasswordEnc: encryptSecret("app-password"),
      },
    });

    const first = await syncConnection(connection);
    expect(first.imported).toBe(2);
    expect(await prisma.feedPost.count({ where: { userId: user.id } })).toBe(2);

    // Second tick: same two posts again, plus one genuinely new one.
    nextPosts = [post("p1"), post("p2"), post("p3")];
    const second = await syncConnection(connection);
    expect(second.imported).toBe(1);
    expect(await prisma.feedPost.count({ where: { userId: user.id } })).toBe(3);
  });

  it("refreshes engagement counts on re-sync without touching liked/bookmarked", async () => {
    let likeCount = 5;
    const fake: PlatformConnector = {
      platform: "bluesky",
      async fetchTimeline() {
        return [post("p1", likeCount)];
      },
      async publish() {
        return { externalId: "x", latencyMs: 1 };
      },
    };
    registerLiveConnector("bluesky", () => fake);

    const user = await createUser();
    const connection = await prisma.connection.create({
      data: {
        userId: user.id,
        platform: "bluesky",
        handle: "@x.bsky.social",
        status: "active",
        appPasswordEnc: encryptSecret("app-password"),
      },
    });

    await syncConnection(connection);
    const feedPost = await prisma.feedPost.findFirstOrThrow({ where: { userId: user.id, externalId: "p1" } });
    await prisma.feedPost.update({ where: { id: feedPost.id }, data: { liked: true, bookmarked: true } });

    likeCount = 42;
    await syncConnection(connection);

    const updated = await prisma.feedPost.findUniqueOrThrow({ where: { id: feedPost.id } });
    expect(updated.likeCount).toBe(42);
    expect(updated.liked).toBe(true);
    expect(updated.bookmarked).toBe(true);
  });

  it("flips a connection to error on a failed sync, then self-heals once a sync succeeds again", async () => {
    let shouldFail = true;
    const fake: PlatformConnector = {
      platform: "bluesky",
      async fetchTimeline() {
        if (shouldFail) throw new Error("platform unreachable");
        return [post("p1")];
      },
      async publish() {
        return { externalId: "x", latencyMs: 1 };
      },
    };
    registerLiveConnector("bluesky", () => fake);

    const user = await createUser();
    const connection = await prisma.connection.create({
      data: {
        userId: user.id,
        platform: "bluesky",
        handle: "@x.bsky.social",
        status: "active",
        appPasswordEnc: encryptSecret("app-password"),
      },
    });

    const failed = await syncConnection(connection);
    expect(failed.error).toBe("platform unreachable");
    const afterFailure = await prisma.connection.findUniqueOrThrow({ where: { id: connection.id } });
    expect(afterFailure.status).toBe("error");

    shouldFail = false;
    const healed = await syncConnection(afterFailure);
    expect(healed.error).toBeUndefined();
    const afterHeal = await prisma.connection.findUniqueOrThrow({ where: { id: connection.id } });
    expect(afterHeal.status).toBe("active");
  });

  it("syncAllConnections aggregates across multiple connections, including one that fails", async () => {
    const fakeOk: PlatformConnector = {
      platform: "bluesky",
      async fetchTimeline() {
        return [post("ok-1"), post("ok-2")];
      },
      async publish() {
        return { externalId: "x", latencyMs: 1 };
      },
    };
    const fakeBroken: PlatformConnector = {
      platform: "mastodon",
      async fetchTimeline() {
        throw new Error("nope");
      },
      async publish() {
        return { externalId: "x", latencyMs: 1 };
      },
    };
    registerLiveConnector("bluesky", () => fakeOk);
    registerLiveConnector("mastodon", () => fakeBroken);

    const user = await createUser();
    await prisma.connection.create({
      data: {
        userId: user.id,
        platform: "bluesky",
        handle: "@x.bsky.social",
        status: "active",
        appPasswordEnc: encryptSecret("app-password"),
      },
    });
    await prisma.connection.create({
      data: {
        userId: user.id,
        platform: "mastodon",
        handle: "@x@example.social",
        status: "active",
        accessTokenEnc: encryptSecret("token"),
      },
    });

    const result = await syncAllConnections();
    expect(result.connectionsSynced).toBeGreaterThanOrEqual(2);
    expect(result.postsImported).toBeGreaterThanOrEqual(2);
    expect(result.connectionsFailed).toBeGreaterThanOrEqual(1);
  });

  it("syncs a demo (no-credential) connection too, and dedupes it exactly like a live one", async () => {
    const user = await createUser();
    const connection = await prisma.connection.create({
      data: { userId: user.id, platform: "bluesky", handle: "@demo.bsky.social", status: "active" },
    });

    const first = await syncConnection(connection);
    expect(first.imported).toBeGreaterThan(0);
    const countAfterFirst = await prisma.feedPost.count({ where: { userId: user.id } });

    // The demo connector is deterministic per (platform, handle), so a
    // second sync must report nothing new and must not duplicate rows.
    const second = await syncConnection(connection);
    expect(second.imported).toBe(0);
    expect(await prisma.feedPost.count({ where: { userId: user.id } })).toBe(countAfterFirst);
  });
});

describe("sync scheduler jitter (D7)", async () => {
  const { nextSyncDelayMs } = await import("../lib/syncScheduler.js");

  it("spreads delays uniformly within ±20% of the base interval", () => {
    const base = 300_000;
    expect(nextSyncDelayMs(base, 0.2, () => 0)).toBe(240_000); // min: -20%
    expect(nextSyncDelayMs(base, 0.2, () => 1)).toBe(360_000); // max: +20%
    expect(nextSyncDelayMs(base, 0.2, () => 0.5)).toBe(300_000); // midpoint: the base
    for (let i = 0; i < 100; i++) {
      const d = nextSyncDelayMs(base);
      expect(d).toBeGreaterThanOrEqual(240_000);
      expect(d).toBeLessThanOrEqual(360_000);
    }
  });
});
