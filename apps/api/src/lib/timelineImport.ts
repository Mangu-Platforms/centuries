import { prisma } from "../db.js";
import type { PlatformId } from "../config.js";
import type { ConnectionContext, PlatformConnector, RemotePost } from "../connectors/types.js";

export interface ImportPostsResult {
  /** Posts that didn't already exist for this user+platform and were inserted. */
  newCount: number;
  /** Posts that already existed and had their engagement counts refreshed. */
  updatedCount: number;
}

/**
 * Stores a batch of remote posts as FeedPost rows for a user, deduplicating
 * by the (userId, platform, externalId) unique constraint (Phase D3). A post
 * already seen (e.g. re-fetched by a periodic sync, Phase D1) gets its
 * engagement counts and content refreshed rather than duplicated — but
 * never its `liked`/`bookmarked`/`isOwn` fields, which are local user state
 * with no remote equivalent to overwrite them with.
 *
 * Runs upserts sequentially rather than concurrently: SQLite (the dev/test
 * datasource) serializes writes to a single connection anyway, and this
 * keeps behavior identical across datasources rather than relying on
 * provider-specific batch semantics.
 */
export async function importTimelinePosts(params: {
  userId: string;
  connectionId: string;
  platform: PlatformId;
  posts: RemotePost[];
}): Promise<ImportPostsResult> {
  const { userId, connectionId, platform, posts } = params;
  if (posts.length === 0) return { newCount: 0, updatedCount: 0 };

  const existing = await prisma.feedPost.findMany({
    where: { userId, platform, externalId: { in: posts.map((p) => p.externalId) } },
    select: { externalId: true },
  });
  const existingIds = new Set(existing.map((e) => e.externalId));

  for (const p of posts) {
    await prisma.feedPost.upsert({
      where: { userId_platform_externalId: { userId, platform, externalId: p.externalId } },
      create: {
        userId,
        connectionId,
        platform,
        externalId: p.externalId,
        authorHandle: p.authorHandle,
        authorName: p.authorName,
        authorAvatar: p.authorAvatar,
        content: p.content,
        mediaUrls: JSON.stringify(p.mediaUrls),
        likeCount: p.likeCount,
        repostCount: p.repostCount,
        replyCount: p.replyCount,
        postedAt: p.postedAt,
      },
      update: {
        authorName: p.authorName,
        authorAvatar: p.authorAvatar,
        content: p.content,
        mediaUrls: JSON.stringify(p.mediaUrls),
        likeCount: p.likeCount,
        repostCount: p.repostCount,
        replyCount: p.replyCount,
      },
    });
  }

  return { newCount: posts.length - existingIds.size, updatedCount: existingIds.size };
}

export interface TimelineImportResult {
  importedPosts: number;
  /** Set (and the connection flipped to status "error") when the fetch failed. */
  warning?: string;
}

/**
 * Pulls an initial timeline from a connector for a freshly created connection
 * and stores it as FeedPost rows. A live connector can reject a bad
 * credential or hit a network error — that must never crash the caller's
 * request, so failures here are caught, the connection is flipped to
 * status "error", and a warning is returned instead of throwing. Shared by
 * every "connect a platform" entry point (direct connect for app-password
 * platforms, OAuth callbacks for authorization-code platforms) so this
 * failure handling only lives in one place.
 */
export async function importInitialTimeline(params: {
  userId: string;
  connectionId: string;
  platform: PlatformId;
  connector: PlatformConnector;
  ctx: ConnectionContext;
  limit?: number;
}): Promise<TimelineImportResult> {
  const { userId, connectionId, platform, connector, ctx, limit = 8 } = params;

  let remote: RemotePost[] = [];
  try {
    remote = await connector.fetchTimeline(ctx, limit);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch initial timeline";
    await prisma.connection.update({ where: { id: connectionId }, data: { status: "error" } });
    return { importedPosts: 0, warning: `Connected, but could not fetch the initial timeline: ${message}` };
  }

  const { newCount } = await importTimelinePosts({ userId, connectionId, platform, posts: remote });
  return { importedPosts: newCount };
}
