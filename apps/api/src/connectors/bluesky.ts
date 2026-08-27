import { AtpAgent } from "@atproto/api";
import { PLATFORMS } from "../config.js";
import { avatarFor } from "./demo.js";
import { registerLiveConnector } from "./registry.js";
import type { ConnectionContext, MirrorRef, PlatformConnector, PublishResult, RemotePost } from "./types.js";

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
        // AT Protocol addresses a like by the liked post's uri *and* cid
        // together, not uri alone -- both travel together as one opaque
        // JSON reference (externalId only holds the uri).
        mirrorRef: JSON.stringify({ uri: post.uri, cid: post.cid }),
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

  // No setBookmarked: AT Protocol/Bluesky has no native "bookmark" record
  // type in the lexicons this connector already depends on, unlike likes
  // (app.bsky.feed.like) and reposts. Bookmarking a Bluesky post in NEXUS
  // stays local-only rather than faking a mirror that doesn't exist.
  async setLiked(ctx: ConnectionContext, ref: MirrorRef, liked: boolean): Promise<{ likeMirrorRef?: string } | void> {
    const agent = await loginAgent(ctx);
    if (liked) {
      const { uri, cid } = JSON.parse(ref.mirrorRef) as { uri: string; cid: string };
      const like = await agent.like(uri, cid);
      // The like is its own record, addressed by its own URI -- must be
      // persisted to ever be able to undo this like later.
      return { likeMirrorRef: like.uri };
    }
    if (ref.likeMirrorRef) {
      await agent.deleteLike(ref.likeMirrorRef);
    }
  }
}

registerLiveConnector("bluesky", () => new BlueskyConnector());

export { BlueskyConnector };
