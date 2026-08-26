import { createRestAPIClient } from "masto";
import sanitizeHtml from "sanitize-html";
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
//
// This used to be a hand-rolled chain of .replace() calls (strip tags,
// then separately unescape entities). CodeQL correctly flagged that as
// unsafe regardless of the order of operations: regex cannot reliably
// parse HTML, and a naive sequential entity-unescape chain can itself
// cascade-decode a double-encoded entity into markup that should have
// stayed inert text. Reordering the same regex chain didn't satisfy that —
// the fix is to stop hand-rolling tag removal. sanitize-html parses with
// htmlparser2 (a real HTML parser, not regex); with allowedTags: [] every
// tag is removed, and — because its job is producing text that's still
// safe to embed in HTML — it keeps HTML-significant characters entity-
// encoded in its own output rather than decoding them back to literal
// characters.
//
// decodeSafeEntities() below then decodes only the entities that can
// never reconstruct "<" or ">" (&amp; &quot; &#39;/&apos;) in a single
// regex pass with one replacer callback — not a chain of separate
// .replace() calls, so there is no step whose output a later step could
// re-match and cascade-decode. &lt;/&gt; are deliberately left encoded: if
// a Mastodon user's post literally contains typed "<"/">" characters, this
// function's output shows them as safe "&lt;"/"&gt;" text rather than
// either resurfacing literal, unstripped-looking markup (the security bug
// CodeQL flagged) or silently deleting the user's typed characters (the
// correctness bug a naive tag-strip pass would cause on that same input,
// mistaking literal escaped text for real markup to remove). This is the
// same guarantee sanitize-html itself provides, just extended through one
// more limited, provably one-way decode step.
function decodeSafeEntities(s: string): string {
  return s.replace(/&(amp|quot|#39|apos);/g, (matched, name: string) => {
    switch (name) {
      case "amp":
        return "&";
      case "quot":
        return '"';
      case "#39":
      case "apos":
        return "'";
      default:
        return matched;
    }
  });
}

function stripHtml(html: string): string {
  // Insert paragraph/line breaks before the real sanitizer runs below, so
  // multi-paragraph toots don't collapse into one run-on line. Purely
  // cosmetic and never the last word on safety: it only ever matches
  // literal, already-unescaped structural tags (never touches entities),
  // and sanitize-html unconditionally strips every tag afterward whether
  // or not this pass caught it.
  const withBreaks = html.replace(/<\/(p|div)>/gi, "\n\n").replace(/<br\s*\/?>/gi, "\n");
  const safeText = sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} });
  return decodeSafeEntities(safeText)
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
