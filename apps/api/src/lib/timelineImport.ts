import { prisma } from "../db.js";
import type { PlatformId } from "../config.js";
import type { ConnectionContext, PlatformConnector } from "../connectors/types.js";

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

  let remote: Awaited<ReturnType<typeof connector.fetchTimeline>> = [];
  try {
    remote = await connector.fetchTimeline(ctx, limit);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch initial timeline";
    await prisma.connection.update({ where: { id: connectionId }, data: { status: "error" } });
    return { importedPosts: 0, warning: `Connected, but could not fetch the initial timeline: ${message}` };
  }

  if (remote.length > 0) {
    await prisma.feedPost.createMany({
      data: remote.map((p) => ({
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
      })),
    });
  }

  return { importedPosts: remote.length };
}
