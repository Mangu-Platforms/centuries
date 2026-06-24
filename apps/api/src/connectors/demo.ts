import { PLATFORMS, type PlatformId } from "../config.js";
import type {
  ConnectionContext,
  PlatformConnector,
  PublishResult,
  RemotePost,
} from "./types.js";

// Curated sample authors and content per platform so the unified feed looks
// realistic out of the box. This is the "demo" data source that stands in for
// live platform APIs (which require approved developer accounts).
const AUTHORS: Record<PlatformId, Array<{ handle: string; name: string }>> = {
  twitter: [
    { handle: "@verge", name: "The Verge" },
    { handle: "@naval", name: "Naval" },
    { handle: "@levelsio", name: "@levelsio" },
    { handle: "@sama", name: "Sam Altman" },
  ],
  threads: [
    { handle: "@mosseri", name: "Adam Mosseri" },
    { handle: "@design.daily", name: "Design Daily" },
    { handle: "@startup.notes", name: "Startup Notes" },
  ],
  bluesky: [
    { handle: "@jay.bsky.team", name: "Jay" },
    { handle: "@pfrazee.com", name: "Paul Frazee" },
    { handle: "@news.bsky.social", name: "Bluesky News" },
  ],
  mastodon: [
    { handle: "@gargron@mastodon.social", name: "Eugen Rochko" },
    { handle: "@fedithoughts@fosstodon.org", name: "Fedi Thoughts" },
    { handle: "@opensource@mastodon.social", name: "Open Source Daily" },
  ],
};

const SNIPPETS: Record<PlatformId, string[]> = {
  twitter: [
    "Shipping > planning. Just pushed v3 to prod 🚀",
    "Hot take: the best feature is the one you delete.",
    "Reminder that compounding works on skills too.",
    "Today's debugging lesson brought to you by a missing await.",
  ],
  threads: [
    "Threads keeps getting better. The fediverse integration is real now.",
    "What's one tool you can't live without in your workflow?",
    "Building in public update: 1,000 users this week 🎉",
  ],
  bluesky: [
    "Custom feeds on the AT Protocol are a genuine game changer.",
    "Decentralization isn't a feature, it's a foundation.",
    "Loving the chronological-by-default vibe over here.",
  ],
  mastodon: [
    "No algorithm, no ads, just my timeline. #fediverse",
    "ActivityPub federation means your followers come with you.",
    "Self-hosting your instance is more approachable than ever.",
  ],
};

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function avatarFor(seed: string, color: string): string {
  // Deterministic, dependency-free SVG data-URI avatar.
  const initial = seed.replace(/[^a-zA-Z0-9]/g, "").charAt(0).toUpperCase() || "?";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" rx="40" fill="${color}"/><text x="50%" y="54%" font-family="Arial" font-size="34" fill="white" text-anchor="middle" dominant-baseline="middle">${initial}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

class DemoConnector implements PlatformConnector {
  constructor(public readonly platform: PlatformId) {}

  async fetchTimeline(ctx: ConnectionContext, limit: number): Promise<RemotePost[]> {
    const authors = AUTHORS[this.platform];
    const snippets = SNIPPETS[this.platform];
    const color = PLATFORMS[this.platform].color;
    const base = hashString(this.platform + ctx.handle);
    const posts: RemotePost[] = [];
    const now = Date.now();

    for (let i = 0; i < limit; i++) {
      const author = authors[(base + i) % authors.length];
      const text = snippets[(base + i * 7) % snippets.length];
      const minutesAgo = (i + 1) * (11 + ((base + i) % 19));
      posts.push({
        externalId: `${this.platform}-${base}-${i}`,
        authorHandle: author.handle,
        authorName: author.name,
        authorAvatar: avatarFor(author.name, color),
        content: text,
        mediaUrls: [],
        likeCount: ((base + i * 13) % 950) + 5,
        repostCount: ((base + i * 5) % 220) + 1,
        replyCount: ((base + i * 3) % 90) + 0,
        postedAt: new Date(now - minutesAgo * 60_000),
      });
    }
    return posts;
  }

  async publish(
    ctx: ConnectionContext,
    _content: string,
    _mediaUrls: string[],
  ): Promise<PublishResult> {
    // Simulate realistic per-platform publish latency (BRD NF03: < 3s).
    const latencyMs = 300 + (hashString(this.platform + ctx.handle) % 1500);
    await new Promise((r) => setTimeout(r, Math.min(latencyMs, 1200)));
    return {
      externalId: `${this.platform}-post-${Date.now()}`,
      latencyMs,
    };
  }
}

const registry = new Map<PlatformId, PlatformConnector>();
for (const id of Object.keys(PLATFORMS) as PlatformId[]) {
  registry.set(id, new DemoConnector(id));
}

export function getConnector(platform: PlatformId): PlatformConnector {
  const c = registry.get(platform);
  if (!c) throw new Error(`No connector registered for platform: ${platform}`);
  return c;
}

export { avatarFor };
