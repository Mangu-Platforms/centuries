import { createRestAPIClient } from "masto";
import { PLATFORMS } from "../config.js";
import { avatarFor } from "./demo.js";
import { registerLiveConnector } from "./registry.js";
import type { ConnectionContext, PlatformConnector, PublishResult, RemotePost } from "./types.js";

// Mastodon OAuth 2.0 against a user-supplied instance — Phase C2. Unlike
// X/Threads/Instagram, this needs no pre-registered developer app: NEXUS
// dynamically registers its own OAuth app on whichever instance the user
// names (see routes/mastodonAuth.ts for the register/callback flow), so
// there is nothing to wait on a human for here.
//
// Uses the `masto` package (a maintained, typed Mastodon API client) rather
// than hand-rolled fetch calls, same reasoning as the Bluesky connector's
// use of @atproto/api. Stateless per call, like Bluesky — session/token
// caching is Phase C5.

export function normalizeInstanceUrl(instance: string): string {
  const trimmed = instance.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function instanceHost(url: string): string {
  return new URL(url).host;
}

function requireContext(ctx: ConnectionContext): { instanceUrl: string; accessToken: string } {
  if (!ctx.instance) {
    throw new Error("Mastodon connection is missing its instance");
  }
  if (!ctx.accessToken) {
    throw new Error("Mastodon connection is missing an access token");
  }
  return { instanceUrl: normalizeInstanceUrl(ctx.instance), accessToken: ctx.accessToken };
}

// Mastodon status content is HTML-encoded; the web UI renders RemotePost's
// content as plain text, so it must be stripped here rather than at render
// time (mirrors how the rest of the app treats content as plain text).
function stripHtml(html: string): string {
  return html
    .replace(/<\/(p|div|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

class MastodonConnector implements PlatformConnector {
  readonly platform = "mastodon" as const;

  async fetchTimeline(ctx: ConnectionContext, limit: number): Promise<RemotePost[]> {
    const { instanceUrl, accessToken } = requireContext(ctx);
    const host = instanceHost(instanceUrl);
    const client = createRestAPIClient({ url: instanceUrl, accessToken });
    const statuses = await client.v1.timelines.home.list({ limit });

    return statuses.map((status): RemotePost => {
      const account = status.account;
      const acct = account.acct.includes("@") ? account.acct : `${account.username}@${host}`;
      return {
        externalId: status.uri,
        authorHandle: "@" + acct,
        authorName: account.displayName || account.username,
        authorAvatar: account.avatar || avatarFor(account.displayName || account.username, PLATFORMS.mastodon.color),
        content: stripHtml(status.content),
        mediaUrls: status.mediaAttachments
          .filter((m) => m.type === "image" && (m.url || m.previewUrl))
          .map((m) => (m.url || m.previewUrl) as string),
        likeCount: status.favouritesCount,
        repostCount: status.reblogsCount,
        replyCount: status.repliesCount,
        postedAt: new Date(status.createdAt),
      };
    });
  }

  async publish(ctx: ConnectionContext, content: string, _mediaUrls: string[]): Promise<PublishResult> {
    void _mediaUrls; // image/video attachment upload lands in Phase E3, same as the Bluesky connector
    const start = Date.now();
    const { instanceUrl, accessToken } = requireContext(ctx);
    const client = createRestAPIClient({ url: instanceUrl, accessToken });
    const status = await client.v1.statuses.create({ status: content });
    return { externalId: status.uri, latencyMs: Date.now() - start };
  }
}

registerLiveConnector("mastodon", () => new MastodonConnector());

export { MastodonConnector };
