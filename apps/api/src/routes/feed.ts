import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { isPlatform } from "../config.js";
import { mirrorBookmark, mirrorLike } from "../lib/mirror.js";

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
  mirrorRef: string;
  likeMirrorRef: string;
}) {
  // mirrorRef/likeMirrorRef are internal bookkeeping for talking back to
  // the real platform (Phase F2) -- not useful to the client, so they're
  // deliberately left out of the response rather than spread in.
  const { mirrorRef: _mirrorRef, likeMirrorRef: _likeMirrorRef, mediaUrls, ...rest } = p;
  return { ...rest, mediaUrls: JSON.parse(mediaUrls) as string[] };
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
      // Phase D2: postedAt alone isn't unique — two posts (demo data, or a
      // burst of real activity) can share the same value, and Prisma's
      // cursor pagination only anchors on the id/skip:1 pair, not the sort
      // key. Without a deterministic tiebreaker, rows tied on postedAt can
      // be ordered differently between the initial query and a follow-up
      // cursor query, silently skipping or repeating a row across pages.
      // Sorting by id too (also desc, matching creation order for ties)
      // makes the full ordering deterministic regardless of duplicates.
      orderBy: [{ postedAt: "desc" }, { id: "desc" }],
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

  // Phase F2: a like/bookmark is mirrored to the real platform when the
  // post came from a live connector that supports it (see lib/mirror.ts).
  // The local toggle always applies, even when the mirror attempt fails --
  // losing a user's local like over a flaky third-party API would be worse
  // than the like being out of sync, so a mirror failure is surfaced via
  // `mirrorError` on the response rather than as a request failure.
  app.post("/api/feed/:id/like", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const post = await prisma.feedPost.findFirst({ where: { id, userId: request.user.sub } });
    if (!post) return reply.code(404).send({ error: "Post not found" });

    const liked = !post.liked;
    const mirror = await mirrorLike(post, liked);

    const updated = await prisma.feedPost.update({
      where: { id },
      data: {
        liked,
        likeCount: { increment: liked ? 1 : -1 },
        ...(mirror.likeMirrorRef !== undefined ? { likeMirrorRef: mirror.likeMirrorRef } : {}),
      },
    });
    return { post: serialize(updated), mirrorError: mirror.error };
  });

  app.post("/api/feed/:id/bookmark", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const post = await prisma.feedPost.findFirst({ where: { id, userId: request.user.sub } });
    if (!post) return reply.code(404).send({ error: "Post not found" });

    const bookmarked = !post.bookmarked;
    const mirror = await mirrorBookmark(post, bookmarked);

    const updated = await prisma.feedPost.update({
      where: { id },
      data: { bookmarked },
    });
    return { post: serialize(updated), mirrorError: mirror.error };
  });
}
