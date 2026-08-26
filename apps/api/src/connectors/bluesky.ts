import { AtpAgent } from "@atproto/api";
import { PLATFORMS } from "../config.js";
import { avatarFor } from "./demo.js";
import { registerLiveConnector } from "./registry.js";
import type { ConnectionContext, PlatformConnector, PublishResult, RemotePost } from "./types.js";

// Bluesky (AT Protocol) via app password — Phase C1. No OAuth developer app
// needed: the user generates their own app password in Bluesky settings and
// supplies it at connect time (encrypted into Connection.appPasswordEnc, see
// routes/connections.ts). Stateless by design: every call logs in fresh
// rather than caching a session, trading a little latency for simplicity.
// Session caching / retry / backoff is Phase C5, not this slice.

const SERVICE_URL = process.env.BLUESKY_SERVICE_URL || "https://bsky.social";

function stripAtSign(handle: string): string {
  return handle.startsWith("@") ? handle.slice(1) : handle;
}

async function loginAgent(ctx: ConnectionContext): Promise<AtpAgent> {
  if (!ctx.appPassword) {
    throw new Error("Bluesky connection is missing an app password");
  }
  const agent = new AtpAgent({ service: SERVICE_URL });
  await agent.login({ identifier: stripAtSign(ctx.handle), password: ctx.appPassword });
  return agent;
}

function extractText(record: unknown): string {
  if (record && typeof record === "object" && "text" in record) {
    const text = (record as { text: unknown }).text;
    if (typeof text === "string") return text;
  }
  return "";
}

function extractImageUrls(embed: unknown): string[] {
  if (
    embed &&
    typeof embed === "object" &&
    (embed as { $type?: string }).$type === "app.bsky.embed.images#view" &&
    "images" in embed
  ) {
    const images = (embed as { images: Array<{ fullsize: string }> }).images;
    return images.map((img) => img.fullsize);
  }
  return [];
}

class BlueskyConnector implements PlatformConnector {
  readonly platform = "bluesky" as const;

  async fetchTimeline(ctx: ConnectionContext, limit: number): Promise<RemotePost[]> {
    const agent = await loginAgent(ctx);
    const res = await agent.getTimeline({ limit });
    return res.data.feed.map((item): RemotePost => {
      const post = item.post;
      const author = post.author;
      return {
        externalId: post.uri,
        authorHandle: "@" + author.handle,
        authorName: author.displayName || author.handle,
        authorAvatar: author.avatar || avatarFor(author.displayName || author.handle, PLATFORMS.bluesky.color),
        content: extractText(post.record),
        mediaUrls: extractImageUrls(post.embed),
        likeCount: post.likeCount ?? 0,
        repostCount: post.repostCount ?? 0,
        replyCount: post.replyCount ?? 0,
        postedAt: new Date(post.indexedAt),
      };
    });
  }

  async publish(ctx: ConnectionContext, content: string, _mediaUrls: string[]): Promise<PublishResult> {
    void _mediaUrls; // image/video blob upload lands in Phase E3; text-only for now (matches demo connector parity)
    const start = Date.now();
    const agent = await loginAgent(ctx);
    const res = await agent.post({ text: content, createdAt: new Date().toISOString() });
    return { externalId: res.uri, latencyMs: Date.now() - start };
  }
}

registerLiveConnector("bluesky", () => new BlueskyConnector());

export { BlueskyConnector };
