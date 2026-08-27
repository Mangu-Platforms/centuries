import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { isPlatform } from "../config.js";
import { getConnector } from "../connectors/registry.js";
import { capabilitiesOf } from "../connectors/types.js";
import { decryptSecret } from "../lib/crypto.js";
import { INTERACTIVE_RESILIENCE } from "../lib/resilience.js";

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
      // Phase D6: every whitespace-separated term must match somewhere in
      // the post — content, author handle, or author name — instead of the
      // old single raw substring over content only. Term count is bounded
      // so a pathological query can't explode the WHERE clause. Full-text
      // indexing (FTS5/tsvector) deliberately waits for G1's Postgres
      // migration: it requires provider-specific raw SQL the migration
      // would immediately redo.
      const terms = q.search.trim().split(/\s+/).filter(Boolean).slice(0, 8);
      if (terms.length > 0) {
        where.AND = terms.map((term) => ({
          OR: [
            { content: { contains: term } },
            { authorHandle: { contains: term } },
            { authorName: { contains: term } },
          ],
        }));
      }
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

    // Phase C7/D5: per-post thread availability, so the UI can
    // capability-gate the "view thread" affordance per network instead of
    // pretending uniformity. Resolved the same way a thread fetch would be
    // (connection credentials decide demo vs live), memoized per
    // (platform, hasCredentials) — at most one resolution per pair.
    const connections = await prisma.connection.findMany({
      where: { userId: request.user.sub },
      select: { id: true, appPasswordEnc: true, accessTokenEnc: true },
    });
    const credsByConnection = new Map(
      connections.map((c) => [c.id, Boolean(c.appPasswordEnc || c.accessTokenEnc)]),
    );
    const capabilityCache = new Map<string, boolean>();
    const threadAvailable = (platform: string, connectionId: string | null): boolean => {
      if (!isPlatform(platform) || !connectionId) return false;
      const hasCreds = credsByConnection.get(connectionId);
      if (hasCreds === undefined) return false; // connection since deleted
      const key = `${platform}:${hasCreds}`;
      if (!capabilityCache.has(key)) {
        capabilityCache.set(key, capabilitiesOf(getConnector(platform, hasCreds)).thread);
      }
      return capabilityCache.get(key)!;
    };

    return {
      posts: page.map((p) => ({
        ...serialize(p),
        threadAvailable: threadAvailable(p.platform, p.connectionId),
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  });

  // Phase D5 (read-only half): the conversation around one cached post.
  // The locally cached row is the root (it's what the user clicked, and
  // for own posts it's the only true copy); the connector supplies the
  // replies. Capability-gated: a connector without fetchThread 404s here
  // and the feed marks its posts threadAvailable: false.
  app.get("/api/feed/:id/thread", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const post = await prisma.feedPost.findFirst({ where: { id, userId: request.user.sub } });
    if (!post) return reply.code(404).send({ error: "Post not found" });
    if (!isPlatform(post.platform)) return reply.code(404).send({ error: "Thread not available" });

    if (!post.connectionId) {
      return reply.code(404).send({ error: "This post's connection is gone — thread not available" });
    }
    const connection = await prisma.connection.findUnique({ where: { id: post.connectionId } });
    if (!connection || connection.userId !== request.user.sub) {
      return reply.code(404).send({ error: "This post's connection is gone — thread not available" });
    }

    const hasCredentials = Boolean(connection.appPasswordEnc || connection.accessTokenEnc);
    const connector = getConnector(post.platform, hasCredentials, INTERACTIVE_RESILIENCE);
    if (!capabilitiesOf(connector).thread) {
      return reply.code(404).send({ error: "Threads aren't available for this connection yet" });
    }

    let remote;
    try {
      remote = await connector.fetchThread!(
        {
          handle: connection.handle,
          instance: connection.instance || undefined,
          appPassword: connection.appPasswordEnc ? decryptSecret(connection.appPasswordEnc) : undefined,
          accessToken: connection.accessTokenEnc ? decryptSecret(connection.accessTokenEnc) : undefined,
          connectionId: connection.id,
        },
        post.externalId,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch the thread";
      return reply.code(502).send({ error: message });
    }

    const replies = remote
      .filter((r) => r.externalId !== post.externalId)
      .map((r) => ({
        externalId: r.externalId,
        authorHandle: r.authorHandle,
        authorName: r.authorName,
        authorAvatar: r.authorAvatar,
        content: r.content,
        mediaUrls: r.mediaUrls,
        likeCount: r.likeCount,
        repostCount: r.repostCount,
        replyCount: r.replyCount,
        postedAt: r.postedAt,
      }));

    return { root: serialize(post), replies };
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
