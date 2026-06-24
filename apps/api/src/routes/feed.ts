import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { isPlatform } from "../config.js";

function serialize(p: {
  id: string;
  platform: string;
  externalId: string;
  authorHandle: string;
  authorName: string;
  authorAvatar: string;
  content: string;
  mediaUrls: string;
  likeCount: number;
  repostCount: number;
  replyCount: number;
  liked: boolean;
  bookmarked: boolean;
  isOwn: boolean;
  postedAt: Date;
}) {
  return { ...p, mediaUrls: JSON.parse(p.mediaUrls) as string[] };
}

export async function feedRoutes(app: FastifyInstance): Promise<void> {
  // Unified, chronological, paginated feed (BRD FD01/FD02/FD04/FD06).
  app.get("/api/feed", { preHandler: [app.authenticate] }, async (request) => {
    const q = request.query as {
      cursor?: string;
      limit?: string;
      platform?: string;
      search?: string;
      bookmarked?: string;
    };
    const limit = Math.min(Math.max(Number(q.limit ?? 20), 1), 50);

    const where: Prisma.FeedPostWhereInput = { userId: request.user.sub };
    if (q.platform && q.platform !== "all" && isPlatform(q.platform)) {
      where.platform = q.platform;
    }
    if (q.search) {
      where.content = { contains: q.search };
    }
    if (q.bookmarked === "true") {
      where.bookmarked = true;
    }

    const posts = await prisma.feedPost.findMany({
      where,
      orderBy: { postedAt: "desc" },
      take: limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });

    const hasMore = posts.length > limit;
    const page = hasMore ? posts.slice(0, limit) : posts;
    return {
      posts: page.map(serialize),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  });

  app.post("/api/feed/:id/like", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const post = await prisma.feedPost.findFirst({ where: { id, userId: request.user.sub } });
    if (!post) return reply.code(404).send({ error: "Post not found" });

    const liked = !post.liked;
    const updated = await prisma.feedPost.update({
      where: { id },
      data: { liked, likeCount: { increment: liked ? 1 : -1 } },
    });
    return { post: serialize(updated) };
  });

  app.post("/api/feed/:id/bookmark", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const post = await prisma.feedPost.findFirst({ where: { id, userId: request.user.sub } });
    if (!post) return reply.code(404).send({ error: "Post not found" });

    const updated = await prisma.feedPost.update({
      where: { id },
      data: { bookmarked: !post.bookmarked },
    });
    return { post: serialize(updated) };
  });
}
