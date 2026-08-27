export type PlatformId = "twitter" | "threads" | "bluesky" | "mastodon" | "instagram";

export interface User {
  id: string;
  email: string;
  displayName: string;
  bio: string;
  avatarUrl: string;
  theme: "light" | "dark";
  emailVerifiedAt: string | null;
}

export interface Platform {
  id: PlatformId;
  name: string;
  charLimit: number;
  color: string;
  auth: string;
}

export interface SessionInfo {
  id: string;
  userAgent: string;
  ipAddress: string;
  createdAt: string;
  current: boolean;
}

export interface Connection {
  id: string;
  platform: PlatformId;
  handle: string;
  displayName: string;
  instance: string;
  status: "active" | "expired" | "error";
  createdAt: string;
}

export interface FeedPost {
  id: string;
  platform: PlatformId;
  authorHandle: string;
  authorName: string;
  authorAvatar: string;
  content: string;
  mediaUrls: string[];
  likeCount: number;
  repostCount: number;
  replyCount: number;
  liked: boolean;
  bookmarked: boolean;
  isOwn: boolean;
  postedAt: string;
}

export interface PublishTargetResult {
  platform: PlatformId;
  status: "pending" | "success" | "failed";
  externalId?: string;
  error: string;
  latencyMs: number;
}

export interface PublishHistoryItem {
  id: string;
  content: string;
  mediaUrls: string[];
  scheduledAt: string | null;
  createdAt: string;
  targets: Array<{ platform: PlatformId; status: string; latencyMs: number; error: string }>;
}

export interface AnalyticsData {
  perPlatform: Array<{
    platform: PlatformId;
    name: string;
    color: string;
    attempts: number;
    successCount: number;
    failedCount: number;
    successRate: number;
    avgLatencyMs: number;
  }>;
  feedVolume: Array<{ date: string; count: number }>;
}

export interface DashboardData {
  connections: Connection[];
  stats: {
    connectionsCount: number;
    totalFeedPosts: number;
    ownPosts: number;
    publishJobs: number;
    crossPosts: number;
    crossPostSuccessRate: number;
    crossPostFailed: number;
    totalLikes: number;
    totalReposts: number;
    totalReplies: number;
  };
  platforms: Array<{
    platform: PlatformId;
    name: string;
    color: string;
    charLimit: number;
    connected: boolean;
  }>;
}
