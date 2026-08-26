import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";

const { loginMock, getTimelineMock, AtpAgentMock } = vi.hoisted(() => {
  const loginMock = vi.fn();
  const getTimelineMock = vi.fn();
  const AtpAgentMock = vi.fn().mockImplementation(() => ({
    login: loginMock,
    getTimeline: getTimelineMock,
    post: vi.fn(),
  }));
  return { loginMock, getTimelineMock, AtpAgentMock };
});

vi.mock("@atproto/api", () => ({ AtpAgent: AtpAgentMock }));

const { buildApp } = await import("../app.js");
const { prisma } = await import("../db.js");

async function registerUser(app: Awaited<ReturnType<typeof buildApp>>) {
  const email = `connections-test-${crypto.randomUUID()}@nexus.app`;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, password: "password123", displayName: "Test User" },
  });
  const body = res.json();
  return { token: body.token as string, userId: body.user.id as string };
}

describe("POST /api/connections — Bluesky live connector wiring", () => {
  beforeEach(() => {
    loginMock.mockReset();
    getTimelineMock.mockReset();
    AtpAgentMock.mockClear();
  });

  afterEach(async () => {
    vi.clearAllMocks();
  });

  it("connects successfully and imports the live timeline when the app password is valid", async () => {
    loginMock.mockResolvedValue({});
    getTimelineMock.mockResolvedValue({
      data: {
        feed: [
          {
            post: {
              uri: "at://did:plc:x/app.bsky.feed.post/1",
              cid: "c1",
              author: { did: "did:plc:x", handle: "real.bsky.social", displayName: "Real Account" },
              record: { text: "a genuine post" },
              likeCount: 2,
              repostCount: 0,
              replyCount: 0,
              indexedAt: "2026-01-01T00:00:00.000Z",
            },
          },
        ],
      },
    });

    const app = await buildApp();
    const { token, userId } = await registerUser(app);

    const res = await app.inject({
      method: "POST",
      url: "/api/connections",
      headers: { authorization: `Bearer ${token}` },
      payload: { platform: "bluesky", handle: "real.bsky.social", credential: "correct-horse-battery-staple" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.importedPosts).toBe(1);
    expect(body.warning).toBeUndefined();
    expect(body.connection.status).toBe("active");
    // Encrypted fields must never appear in the response.
    expect(body.connection.appPasswordEnc).toBeUndefined();
    expect(loginMock).toHaveBeenCalledWith({ identifier: "real.bsky.social", password: "correct-horse-battery-staple" });

    await prisma.user.delete({ where: { id: userId } });
    await app.close();
  });

  it("keeps the connection but reports a warning when the app password is rejected", async () => {
    loginMock.mockRejectedValue(new Error("Invalid identifier or password"));

    const app = await buildApp();
    const { token, userId } = await registerUser(app);

    const res = await app.inject({
      method: "POST",
      url: "/api/connections",
      headers: { authorization: `Bearer ${token}` },
      payload: { platform: "bluesky", handle: "bad.bsky.social", credential: "wrong-password" },
    });

    // Must not 500 — a bad live credential is a handled outcome, not a crash.
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.importedPosts).toBe(0);
    expect(body.warning).toMatch(/Invalid identifier or password/);
    expect(body.connection.status).toBe("error");

    const stored = await prisma.connection.findUnique({ where: { id: body.connection.id } });
    expect(stored?.status).toBe("error");

    await prisma.user.delete({ where: { id: userId } });
    await app.close();
  });
});
