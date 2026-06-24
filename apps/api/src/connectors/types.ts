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
}

export interface PublishResult {
  externalId: string;
  latencyMs: number;
}

export interface ConnectionContext {
  handle: string;
  instance?: string;
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
}
