import type { PlatformId } from "../config.js";

export interface RemotePost {
  externalId: string;
  authorHandle: string;
  authorName: string;
  authorAvatar: string;
  content: string;
  mediaUrls: string[];
  likeCount: number;
  repostCount: number;
  replyCount: number;
  postedAt: Date;
  /**
   * Connector-opaque reference needed to mirror a like/bookmark action back
   * to the real platform (Mastodon: the status id; Bluesky: a JSON
   * `{uri,cid}` pair). Omitted by connectors with nothing real to mirror
   * to (the demo connectors) -- those posts stay like/bookmark-local-only.
   */
  mirrorRef?: string;
}

export interface PublishResult {
  externalId: string;
  latencyMs: number;
}

export interface ConnectionContext {
  handle: string;
  instance?: string;
  /** Decrypted OAuth access token, when the connection has one stored. */
  accessToken?: string;
  /** Decrypted OAuth refresh token, when the connection has one stored. */
  refreshToken?: string;
  /** Decrypted app password (e.g. Bluesky), when the connection has one stored. */
  appPassword?: string;
}

/** A FeedPost's stored mirror references, handed to setLiked/setBookmarked. */
export interface MirrorRef {
  mirrorRef: string;
  /** Bluesky only: the like record's own URI, if a previous like created one. */
  likeMirrorRef?: string;
}

/**
 * A PlatformConnector abstracts a single social network. The demo
 * implementations generate realistic data so the product is fully runnable
 * without third-party API credentials. To integrate a real platform, implement
 * this interface against the live API (see BRD section 8) and register it.
 */
export interface PlatformConnector {
  readonly platform: PlatformId;
  fetchTimeline(ctx: ConnectionContext, limit: number): Promise<RemotePost[]>;
  publish(ctx: ConnectionContext, content: string, mediaUrls: string[]): Promise<PublishResult>;
  /**
   * Mirrors a like/unlike to the real platform (Phase F2). Optional --
   * connectors with no way to do this (all demo connectors, and any post
   * with no mirrorRef) leave the like local-only in NEXUS. May return an
   * updated likeMirrorRef for the caller to persist (Bluesky's like is its
   * own record, addressed by a URI only known after creating it).
   */
  setLiked?(ctx: ConnectionContext, ref: MirrorRef, liked: boolean): Promise<{ likeMirrorRef?: string } | void>;
  /** Mirrors a bookmark/unbookmark to the real platform (Phase F2). Optional, same as setLiked. */
  setBookmarked?(ctx: ConnectionContext, ref: MirrorRef, bookmarked: boolean): Promise<void>;
}
