import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { loginMock, getTimelineMock, postMock, AtpAgentMock } = vi.hoisted(() => {
  const loginMock = vi.fn();
  const getTimelineMock = vi.fn();
  const postMock = vi.fn();
  const AtpAgentMock = vi.fn().mockImplementation(() => ({
    login: loginMock,
    getTimeline: getTimelineMock,
    post: postMock,
  }));
  return { loginMock, getTimelineMock, postMock, AtpAgentMock };
});

vi.mock("@atproto/api", () => ({ AtpAgent: AtpAgentMock }));

// Imported after the mock so bluesky.ts's `new AtpAgent(...)` resolves to
// the mock above. Never exercises the real network — no live API call is
// made anywhere in this file.
const { BlueskyConnector } = await import("../connectors/bluesky.js");
const { getConnector, hasLiveConnector } = await import("../connectors/registry.js");
const { getConnector: getDemoConnector } = await import("../connectors/demo.js");

describe("Bluesky live connector", () => {
  beforeEach(() => {
    loginMock.mockReset().mockResolvedValue({});
    getTimelineMock.mockReset();
    postMock.mockReset();
    AtpAgentMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("self-registers with the connector registry on import", () => {
    expect(hasLiveConnector("bluesky")).toBe(true);
    const connector = getConnector("bluesky", true);
    expect(connector.platform).toBe("bluesky");
    expect(connector).not.toBe(getDemoConnector("bluesky"));
  });

  it("refuses to call the live API without an app password", async () => {
    const connector = new BlueskyConnector();
    await expect(connector.fetchTimeline({ handle: "@alice.bsky.social" }, 10)).rejects.toThrow(
      /app password/i,
    );
    await expect(connector.publish({ handle: "@alice.bsky.social" }, "hi", [])).rejects.toThrow(
      /app password/i,
    );
    expect(AtpAgentMock).not.toHaveBeenCalled();
  });

  it("strips the leading @ from the handle when logging in", async () => {
    getTimelineMock.mockResolvedValue({ data: { feed: [] } });
    const connector = new BlueskyConnector();
    await connector.fetchTimeline({ handle: "@alice.bsky.social", appPassword: "xxxx-yyyy-zzzz" }, 10);
    expect(loginMock).toHaveBeenCalledWith({ identifier: "alice.bsky.social", password: "xxxx-yyyy-zzzz" });
  });

  it("maps a live timeline response into RemotePost[]", async () => {
    getTimelineMock.mockResolvedValue({
      data: {
        feed: [
          {
            post: {
              uri: "at://did:plc:abc123/app.bsky.feed.post/xyz",
              cid: "bafycid",
              author: { did: "did:plc:abc123", handle: "alice.bsky.social", displayName: "Alice" },
              record: { text: "hello from the real timeline", createdAt: "2026-01-01T00:00:00.000Z" },
              embed: {
                $type: "app.bsky.embed.images#view",
                images: [{ thumb: "https://cdn/thumb.jpg", fullsize: "https://cdn/full.jpg", alt: "" }],
              },
              likeCount: 3,
              repostCount: 1,
              replyCount: 0,
              indexedAt: "2026-01-01T00:05:00.000Z",
            },
          },
        ],
      },
    });

    const connector = new BlueskyConnector();
    const posts = await connector.fetchTimeline({ handle: "@x.bsky.social", appPassword: "pw" }, 10);

    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      externalId: "at://did:plc:abc123/app.bsky.feed.post/xyz",
      authorHandle: "@alice.bsky.social",
      authorName: "Alice",
      content: "hello from the real timeline",
      mediaUrls: ["https://cdn/full.jpg"],
      likeCount: 3,
      repostCount: 1,
      replyCount: 0,
    });
    expect(posts[0].postedAt.toISOString()).toBe("2026-01-01T00:05:00.000Z");
  });

  it("falls back to a generated avatar when the profile has none", async () => {
    getTimelineMock.mockResolvedValue({
      data: {
        feed: [
          {
            post: {
              uri: "at://did:plc:abc/app.bsky.feed.post/1",
              cid: "c",
              author: { did: "did:plc:abc", handle: "noavatar.bsky.social" },
              record: { text: "no avatar here" },
              likeCount: 0,
              repostCount: 0,
              replyCount: 0,
              indexedAt: "2026-01-01T00:00:00.000Z",
            },
          },
        ],
      },
    });
    const connector = new BlueskyConnector();
    const posts = await connector.fetchTimeline({ handle: "@x.bsky.social", appPassword: "pw" }, 10);
    expect(posts[0].authorAvatar).toMatch(/^data:image\/svg\+xml/);
  });

  it("publishes a text post and returns the post uri as externalId", async () => {
    postMock.mockResolvedValue({ uri: "at://did:plc:abc/app.bsky.feed.post/new", cid: "cid" });
    const connector = new BlueskyConnector();
    const result = await connector.publish({ handle: "@x.bsky.social", appPassword: "pw" }, "hello world", []);
    expect(postMock).toHaveBeenCalledWith(expect.objectContaining({ text: "hello world" }));
    expect(result.externalId).toBe("at://did:plc:abc/app.bsky.feed.post/new");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
