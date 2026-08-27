import { prisma } from "../db.js";
import { getConnector } from "../connectors/registry.js";
import { decryptSecret } from "./crypto.js";
import { isPlatform } from "../config.js";
import type { FeedPost } from "@prisma/client";

export interface MirrorOutcome {
  /** Present only when a like mirror changed the stored likeMirrorRef -- see routes/feed.ts. */
  likeMirrorRef?: string;
  /** Present when a mirror was attempted and failed; absent when nothing was attempted or it succeeded. */
  error?: string;
}

/**
 * Shared by mirrorLike/mirrorBookmark (Phase F2): resolves the connector and
 * decrypted context for a FeedPost's connection, or null when there's
 * nothing to mirror to -- either because this post was never fetched from a
 * live connector (no mirrorRef, e.g. every demo-imported post) or its
 * connection has since been disconnected.
 */
async function resolveMirrorContext(post: FeedPost) {
  if (!post.mirrorRef || !post.connectionId || !isPlatform(post.platform)) return null;
  const connection = await prisma.connection.findUnique({ where: { id: post.connectionId } });
  if (!connection) return null;
  const hasCredentials = Boolean(connection.appPasswordEnc || connection.accessTokenEnc);
  const connector = getConnector(post.platform, hasCredentials);
  const ctx = {
    handle: connection.handle,
    instance: connection.instance,
    appPassword: connection.appPasswordEnc ? decryptSecret(connection.appPasswordEnc) : undefined,
    accessToken: connection.accessTokenEnc ? decryptSecret(connection.accessTokenEnc) : undefined,
  };
  return { connector, ctx };
}

/**
 * Attempts to mirror a like/unlike to the real platform. Never throws: on
 * failure the caller still applies the local like (this function's `error`
 * is surfaced to the user as a "synced" vs "local only" distinction, not a
 * reason to lose the like entirely over a flaky third-party API).
 */
export async function mirrorLike(post: FeedPost, liked: boolean): Promise<MirrorOutcome> {
  const resolved = await resolveMirrorContext(post);
  if (!resolved || !resolved.connector.setLiked) return {};

  try {
    const result = await resolved.connector.setLiked(
      resolved.ctx,
      { mirrorRef: post.mirrorRef, likeMirrorRef: post.likeMirrorRef },
      liked,
    );
    if (result && "likeMirrorRef" in result) return { likeMirrorRef: result.likeMirrorRef ?? "" };
    // Connector didn't hand back a new ref: on unlike, always clear the
    // stored one (it's been deleted); on like, leave whatever was there.
    return liked ? {} : { likeMirrorRef: "" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to sync like to platform" };
  }
}

/** Attempts to mirror a bookmark/unbookmark to the real platform. Same never-throws contract as mirrorLike. */
export async function mirrorBookmark(post: FeedPost, bookmarked: boolean): Promise<MirrorOutcome> {
  const resolved = await resolveMirrorContext(post);
  if (!resolved || !resolved.connector.setBookmarked) return {};

  try {
    await resolved.connector.setBookmarked(resolved.ctx, { mirrorRef: post.mirrorRef }, bookmarked);
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to sync bookmark to platform" };
  }
}
