import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { PLATFORM_IDS, PLATFORMS } from "../config.js";

const FEED_VOLUME_DAYS = 14;

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  // Real analytics (Phase F1): per-platform cross-post success rate and
  // average latency, plus a feed-volume trend. The dashboard overview
  // already had a single lifetime-aggregate success rate; this breaks it
  // down per platform (a slow/unreliable platform shouldn't hide inside a
  // healthy overall number) and adds latency and a time series, neither of
  // which existed anywhere before this route.
  app.get("/api/analytics", { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;

    const [targets, feedPosts] = await Promise.all([
      prisma.publishTarget.findMany({
        where: { job: { userId } },
        select: { platform: true, status: true, latencyMs: true },
      }),
      prisma.feedPost.findMany({
        where: { userId, postedAt: { gte: startOfUtcDay(daysAgo(FEED_VOLUME_DAYS - 1)) } },
        select: { postedAt: true },
      }),
    ]);

    const perPlatform = PLATFORM_IDS.map((id) => {
      const platformTargets = targets.filter((t) => t.platform === id);
      // A failed attempt's latencyMs is always 0 (lib/publish.ts never
      // times a failure), so only successful attempts go into the average
      // — otherwise a flaky platform would look artificially fast.
      const successful = platformTargets.filter((t) => t.status === "success");
      const attempts = platformTargets.length;
      const avgLatencyMs = successful.length
        ? Math.round(successful.reduce((sum, t) => sum + t.latencyMs, 0) / successful.length)
        : 0;

      return {
        platform: id,
        name: PLATFORMS[id].name,
        color: PLATFORMS[id].color,
        attempts,
        successCount: successful.length,
        failedCount: platformTargets.filter((t) => t.status === "failed").length,
        successRate: attempts ? Math.round((successful.length / attempts) * 100) : 0,
        avgLatencyMs,
      };
    });

    // Always include every day in the window, even ones with zero posts, so
    // the chart shows real gaps instead of silently compressing them away.
    const dayBuckets = new Map<string, number>();
    for (let i = FEED_VOLUME_DAYS - 1; i >= 0; i--) {
      dayBuckets.set(dayKey(daysAgo(i)), 0);
    }
    for (const post of feedPosts) {
      const key = dayKey(post.postedAt);
      if (dayBuckets.has(key)) dayBuckets.set(key, (dayBuckets.get(key) ?? 0) + 1);
    }

    return {
      perPlatform,
      feedVolume: Array.from(dayBuckets.entries()).map(([date, count]) => ({ date, count })),
    };
  });
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

function startOfUtcDay(d: Date): Date {
  const copy = new Date(d);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}
