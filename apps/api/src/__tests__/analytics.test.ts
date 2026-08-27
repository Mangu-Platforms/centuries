import crypto from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { prisma } from "../db.js";

function uniqueEmail(): string {
  return `analytics-test-${crypto.randomUUID()}@nexus.app`;
}

async function registerAndGetToken(app: Awaited<ReturnType<typeof buildApp>>) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: uniqueEmail(), password: "password123", displayName: "Analytics Test" },
  });
  const body = res.json();
  return { token: body.token as string, userId: body.user.id as string };
}

async function createTarget(userId: string, platform: string, status: string, latencyMs = 0) {
  const job = await prisma.publishJob.create({ data: { userId, content: "x", mediaUrls: "[]" } });
  return prisma.publishTarget.create({ data: { jobId: job.id, platform, status, latencyMs } });
}

async function createFeedPost(userId: string, postedAt: Date) {
  return prisma.feedPost.create({
    data: {
      userId,
      platform: "bluesky",
      externalId: crypto.randomUUID(),
      authorHandle: "@someone",
      authorName: "Someone",
      authorAvatar: "",
      content: "hi",
      postedAt,
    },
  });
}

describe("Phase F1: GET /api/analytics", () => {
  afterEach(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: "analytics-test-" } } });
  });

  it("rejects an unauthenticated request", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/analytics" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("computes per-platform success rate and averages latency over successes only", async () => {
    const app = await buildApp();
    const { token, userId } = await registerAndGetToken(app);

    await createTarget(userId, "bluesky", "success", 100);
    await createTarget(userId, "bluesky", "success", 300);
    await createTarget(userId, "bluesky", "failed", 0);
    await createTarget(userId, "mastodon", "failed", 0);

    const res = await app.inject({ method: "GET", url: "/api/analytics", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    const bluesky = body.perPlatform.find((p: { platform: string }) => p.platform === "bluesky");
    expect(bluesky.attempts).toBe(3);
    expect(bluesky.successCount).toBe(2);
    expect(bluesky.failedCount).toBe(1);
    expect(bluesky.successRate).toBe(67); // round(2/3 * 100)
    // Average of the two successes only (100, 300) -- the failure's 0 must
    // not drag this down, or a flaky platform would look artificially fast.
    expect(bluesky.avgLatencyMs).toBe(200);

    const mastodon = body.perPlatform.find((p: { platform: string }) => p.platform === "mastodon");
    expect(mastodon.attempts).toBe(1);
    expect(mastodon.successRate).toBe(0);
    expect(mastodon.avgLatencyMs).toBe(0);

    const twitter = body.perPlatform.find((p: { platform: string }) => p.platform === "twitter");
    expect(twitter.attempts).toBe(0);
    expect(twitter.successRate).toBe(0);

    await app.close();
  });

  it("buckets feed volume by day over the last 14 days, including empty days", async () => {
    const app = await buildApp();
    const { token, userId } = await registerAndGetToken(app);

    const today = new Date();
    await createFeedPost(userId, today);
    await createFeedPost(userId, today);
    const threeDaysAgo = new Date(today);
    threeDaysAgo.setUTCDate(threeDaysAgo.getUTCDate() - 3);
    await createFeedPost(userId, threeDaysAgo);
    // Outside the 14-day window entirely -- must not appear or affect totals.
    const wayBack = new Date(today);
    wayBack.setUTCDate(wayBack.getUTCDate() - 30);
    await createFeedPost(userId, wayBack);

    const res = await app.inject({ method: "GET", url: "/api/analytics", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.feedVolume).toHaveLength(14);
    const total = body.feedVolume.reduce((sum: number, d: { count: number }) => sum + d.count, 0);
    expect(total).toBe(3);

    const todayKey = today.toISOString().slice(0, 10);
    const todayBucket = body.feedVolume.find((d: { date: string }) => d.date === todayKey);
    expect(todayBucket.count).toBe(2);

    // A day with no posts still appears, with count 0 -- not silently skipped.
    const zeroBucket = body.feedVolume.find((d: { count: number }) => d.count === 0);
    expect(zeroBucket).toBeDefined();

    await app.close();
  });
});
