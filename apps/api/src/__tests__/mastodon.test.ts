import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getTimelineMock, createStatusMock, createRestAPIClientMock } = vi.hoisted(() => {
  const getTimelineMock = vi.fn();
  const createStatusMock = vi.fn();
  const createRestAPIClientMock = vi.fn().mockImplementation(() => ({
    v1: {
      timelines: { home: { list: getTimelineMock } },
      statuses: { create: createStatusMock },
    },
  }));
  return { getTimelineMock, createStatusMock, createRestAPIClientMock };
});

vi.mock("masto", () => ({
  createRestAPIClient: createRestAPIClientMock,
  createOAuthAPIClient: vi.fn(),
}));

// Imported after the mock so `createRestAPIClient(...)` resolves to the
// mock above. No live network call is made anywhere in this file.
const { MastodonConnector, normalizeInstanceUrl } = await import("../connectors/mastodon.js");
const { getConnector, hasLiveConnector } = await import("../connectors/registry.js");
const { getConnector: getDemoConnector } = await import("../connectors/demo.js");

describe("normalizeInstanceUrl", () => {
  it("adds https:// when no scheme is given", () => {
    expect(normalizeInstanceUrl("mastodon.social")).toBe("https://mastodon.social");
  });
  it("leaves an explicit scheme alone", () => {
    expect(normalizeInstanceUrl("http://localhost:3001")).toBe("http://localhost:3001");
  });
  it("strips a trailing slash", () => {
    expect(normalizeInstanceUrl("https://mastodon.social/")).toBe("https://mastodon.social");
  });
});

describe("Mastodon live connector", () => {
  beforeEach(() => {
    getTimelineMock.mockReset();
    createStatusMock.mockReset();
    createRestAPIClientMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("self-registers with the connector registry on import", () => {
    expect(hasLiveConnector("mastodon")).toBe(true);
    const connector = getConnector("mastodon", true);
    expect(connector.platform).toBe("mastodon");
    expect(connector).not.toBe(getDemoConnector("mastodon"));
  });

  it("refuses to call the live API without an access token or instance", async () => {
    const connector = new MastodonConnector();
    await expect(connector.fetchTimeline({ handle: "@a@mastodon.social", instance: "mastodon.social" }, 10)).rejects.toThrow(
      /access token/i,
    );
    await expect(connector.fetchTimeline({ handle: "@a@mastodon.social", accessToken: "tok" }, 10)).rejects.toThrow(
      /instance/i,
    );
    expect(createRestAPIClientMock).not.toHaveBeenCalled();
  });

  it("maps a live timeline response into RemotePost[], stripping HTML and normalizing the handle", async () => {
    getTimelineMock.mockResolvedValue([
      {
        id: "1",
        uri: "https://mastodon.social/@alice/123",
        createdAt: "2026-01-01T00:05:00.000Z",
        account: { username: "alice", acct: "alice", displayName: "Alice", avatar: "https://cdn/alice.jpg" },
        content: "<p>Hello <a href=\"https://example.com\">world</a> &amp; friends</p>",
        mediaAttachments: [
          { type: "image", url: "https://cdn/full.jpg", previewUrl: "https://cdn/thumb.jpg" },
          { type: "video", url: "https://cdn/video.mp4", previewUrl: "https://cdn/vthumb.jpg" },
        ],
        favouritesCount: 4,
        reblogsCount: 2,
        repliesCount: 1,
      },
    ]);

    const connector = new MastodonConnector();
    const posts = await connector.fetchTimeline(
      { handle: "@alice@mastodon.social", instance: "mastodon.social", accessToken: "tok" },
      10,
    );

    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      externalId: "https://mastodon.social/@alice/123",
      authorHandle: "@alice@mastodon.social", // local account's bare `acct` gets the instance host appended
      authorName: "Alice",
      content: "Hello world & friends",
      mediaUrls: ["https://cdn/full.jpg"], // only the image, not the video
      likeCount: 4,
      repostCount: 2,
      replyCount: 1,
    });
    expect(createRestAPIClientMock).toHaveBeenCalledWith({ url: "https://mastodon.social", accessToken: "tok" });
  });

  it("never lets HTML-escaped text resurface as a literal bracket (CodeQL: incomplete sanitization)", async () => {
    // Mastodon entity-escapes any literal "<"/">" a user types, so a toot
    // containing the literal text "<script>...</script>" arrives from the
    // API as "&lt;script&gt;...&lt;/script&gt;". decodeSafeEntities()
    // deliberately does not decode &lt;/&gt; back to literal brackets — the
    // output must show the user's typed text safely (still as "&lt;"/"&gt;"
    // text), never as literal, unstripped-looking "<script>" markup.
    getTimelineMock.mockResolvedValue([
      {
        id: "1",
        uri: "https://mastodon.social/@eve/1",
        createdAt: "2026-01-01T00:00:00.000Z",
        account: { username: "eve", acct: "eve", displayName: "Eve", avatar: "" },
        content: "<p>&lt;script&gt;alert(document.cookie)&lt;/script&gt; said Eve</p>",
        mediaAttachments: [],
        favouritesCount: 0,
        reblogsCount: 0,
        repliesCount: 0,
      },
    ]);
    const connector = new MastodonConnector();
    const posts = await connector.fetchTimeline(
      { handle: "@eve@mastodon.social", instance: "mastodon.social", accessToken: "tok" },
      10,
    );
    expect(posts[0].content).not.toMatch(/<script/i);
    expect(posts[0].content).not.toContain("<");
    expect(posts[0].content).not.toContain(">");
    expect(posts[0].content).toBe("&lt;script&gt;alert(document.cookie)&lt;/script&gt; said Eve");
  });

  it("keeps an already-qualified remote acct as-is", async () => {
    getTimelineMock.mockResolvedValue([
      {
        id: "1",
        uri: "https://other.social/@bob/1",
        createdAt: "2026-01-01T00:00:00.000Z",
        account: { username: "bob", acct: "bob@other.social", displayName: "", avatar: "" },
        content: "hi",
        mediaAttachments: [],
        favouritesCount: 0,
        reblogsCount: 0,
        repliesCount: 0,
      },
    ]);
    const connector = new MastodonConnector();
    const posts = await connector.fetchTimeline(
      { handle: "@x", instance: "mastodon.social", accessToken: "tok" },
      10,
    );
    expect(posts[0].authorHandle).toBe("@bob@other.social");
    expect(posts[0].authorAvatar).toMatch(/^data:image\/svg\+xml/); // falls back when avatar is empty
  });

  it("publishes a text post and returns the status uri as externalId", async () => {
    createStatusMock.mockResolvedValue({ uri: "https://mastodon.social/@alice/999" });
    const connector = new MastodonConnector();
    const result = await connector.publish(
      { handle: "@alice@mastodon.social", instance: "mastodon.social", accessToken: "tok" },
      "hello fediverse",
      [],
    );
    expect(createStatusMock).toHaveBeenCalledWith({ status: "hello fediverse" });
    expect(result.externalId).toBe("https://mastodon.social/@alice/999");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
