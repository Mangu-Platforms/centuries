import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { PLATFORM_IDS, PLATFORMS } from "../config.js";

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  // Dashboard overview (BRD section 5.6): connections, basic analytics, totals.
  app.get("/api/dashboard", { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.sub;

    const [connections, totalFeedPosts, ownPosts, publishedTargets, jobs] = await Promise.all([
      prisma.connection.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
      prisma.feedPost.count({ where: { userId } }),
      prisma.feedPost.count({ where: { userId, isOwn: true } }),
      prisma.publishTarget.findMany({ where: { job: { userId } } }),
      prisma.publishJob.count({ where: { userId } }),
    ]);

    const aggregates = await prisma.feedPost.aggregate({
      where: { userId },
      _sum: { likeCount: true, repostCount: true, replyCount: true },
    });

    const successful = publishedTargets.filter((t) => t.status === "success").length;
    const failed = publishedTargets.filter((t) => t.status === "failed").length;
    const totalTargets = publishedTargets.length;

    const perPlatform = PLATFORM_IDS.map((id) => ({
      platform: id,
      name: PLATFORMS[id].name,
      color: PLATFORMS[id].color,
      charLimit: PLATFORMS[id].charLimit,
      connected: connections.some((c) => c.platform === id),
    }));

    return {
      connections,
      stats: {
        connectionsCount: connections.length,
        totalFeedPosts,
        ownPosts,
        publishJobs: jobs,
        crossPosts: totalTargets,
        crossPostSuccessRate: totalTargets ? Math.round((successful / totalTargets) * 100) : 0,
        crossPostFailed: failed,
        totalLikes: aggregates._sum.likeCount ?? 0,
        totalReposts: aggregates._sum.repostCount ?? 0,
        totalReplies: aggregates._sum.replyCount ?? 0,
      },
      platforms: perPlatform,
    };
  });
}
