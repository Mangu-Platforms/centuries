import { describe, expect, it } from "vitest";
import { getConnector } from "../connectors/demo.js";
import { PLATFORM_IDS, PLATFORMS } from "../config.js";

describe("demo connectors", () => {
  it("registers a connector for every supported platform", () => {
    for (const id of PLATFORM_IDS) {
      expect(getConnector(id).platform).toBe(id);
    }
  });

  it("fetches a deterministic timeline of the requested length", async () => {
    const a = await getConnector("twitter").fetchTimeline({ handle: "@birdman" }, 8);
    const b = await getConnector("twitter").fetchTimeline({ handle: "@birdman" }, 8);
    expect(a).toHaveLength(8);
    expect(a.map((p) => p.externalId)).toEqual(b.map((p) => p.externalId));
    // Connector returns newest-first, so each subsequent post is older.
    expect(a[0].postedAt.getTime()).toBeGreaterThan(a[1].postedAt.getTime());
  });

  it("returns posts newest-first when sorted by postedAt", async () => {
    const posts = await getConnector("bluesky").fetchTimeline({ handle: "@x.bsky.social" }, 5);
    const sorted = [...posts].sort((x, y) => y.postedAt.getTime() - x.postedAt.getTime());
    expect(sorted[0].postedAt.getTime()).toBeGreaterThanOrEqual(sorted[4].postedAt.getTime());
  });

  it("gives some posts demo images (Phase D4), deterministically", async () => {
    const a = await getConnector("bluesky").fetchTimeline({ handle: "@birdman" }, 12);
    const b = await getConnector("bluesky").fetchTimeline({ handle: "@birdman" }, 12);
    expect(a.map((p) => p.mediaUrls)).toEqual(b.map((p) => p.mediaUrls));
    expect(a.some((p) => p.mediaUrls.length > 0)).toBe(true);
    expect(a.some((p) => p.mediaUrls.length === 0)).toBe(true);
    for (const post of a) {
      for (const url of post.mediaUrls) {
        expect(url).toMatch(/^data:image\/svg\+xml;utf8,/);
      }
    }
  });

  it("publishes and returns an external id", async () => {
    const res = await getConnector("mastodon").publish({ handle: "@a@b.social" }, "hello world", []);
    expect(res.externalId).toContain("mastodon-post-");
    expect(res.latencyMs).toBeGreaterThan(0);
  });

  it("exposes character limits matching the BRD", () => {
    expect(PLATFORMS.twitter.charLimit).toBe(280);
    expect(PLATFORMS.bluesky.charLimit).toBe(300);
    expect(PLATFORMS.threads.charLimit).toBe(500);
    expect(PLATFORMS.mastodon.charLimit).toBe(500);
  });
});
