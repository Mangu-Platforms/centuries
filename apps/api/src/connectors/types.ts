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
  /** Decrypted OAuth access token, when the connection has one stored. */
  accessToken?: string;
  /** Decrypted OAuth refresh token, when the connection has one stored. */
  refreshToken?: string;
  /** Decrypted app password (e.g. Bluesky), when the connection has one stored. */
  appPassword?: string;
  /**
   * The Connection row this call acts for. Used by the resilience layer
   * (Phase C5) to key the per-connection circuit breaker and to persist
   * rotated tokens after a credential refresh. Connectors themselves
   * should not need it.
   */
  connectionId?: string;
}

/** Rotated tokens returned by a connector's refreshCredentials hook (Phase C5). */
export interface RefreshedCredentials {
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
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
   * Optional (Phase C5): exchange the connection's refresh token for fresh
   * credentials when a call fails with 401. Return null when refresh isn't
   * possible (no refresh token, revoked grant) — the original auth error
   * then stands. The resilience layer calls this at most once per
   * operation and persists whatever it returns; connectors never write to
   * the database themselves. First real implementer will be X's OAuth 2.0
   * PKCE connector (C3), whose access tokens expire hourly.
   */
  refreshCredentials?(ctx: ConnectionContext): Promise<RefreshedCredentials | null>;
}
