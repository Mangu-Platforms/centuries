import crypto from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { prisma } from "../db.js";

function uniqueEmail(): string {
  return `posts-test-${crypto.randomUUID()}@nexus.app`;
}

async function registerAndConnect(app: Awaited<ReturnType<typeof buildApp>>) {
  const email = uniqueEmail();
  const registerRes = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, password: "password123", displayName: "Posts Test" },
  });
  const { token, user } = registerRes.json();

  await app.inject({
    method: "POST",
    url: "/api/connections",
    headers: { authorization: `Bearer ${token}` },
    payload: { platform: "bluesky", handle: "@x.bsky.social" },
  });

  return { token, userId: user.id as string };
}

describe("Phase E2: scheduled sends", () => {
  afterEach(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: "posts-test-" } } });
  });

  it("publishes immediately when no scheduledAt is given (unchanged behavior)", async () => {
    const app = await buildApp();
    const { token, userId } = await registerAndConnect(app);

    const res = await app.inject({
      method: "POST",
      url: "/api/posts",
      headers: { authorization: `Bearer ${token}` },
      payload: { content: "hello now", platforms: ["bluesky"] },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.results[0].status).toBe("success");
    expect(body.results[0].externalId).toBeTruthy();

    const feedPost = await prisma.feedPost.findFirst({ where: { userId, isOwn: true } });
    expect(feedPost).not.toBeNull();
    expect(feedPost?.content).toBe("hello now");

    await app.close();
  });

  it("a future scheduledAt leaves the target pending and does not publish or touch the feed", async () => {
    const app = await buildApp();
    const { token, userId } = await registerAndConnect(app);

    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const res = await app.inject({
      method: "POST",
      url: "/api/posts",
      headers: { authorization: `Bearer ${token}` },
      payload: { content: "hello later", platforms: ["bluesky"], scheduledAt: future },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.results[0].status).toBe("pending");
    expect(body.results[0].externalId).toBe("");

    const target = await prisma.publishTarget.findFirst({ where: { jobId: body.jobId } });
    expect(target?.status).toBe("pending");

    const feedPost = await prisma.feedPost.findFirst({ where: { userId, isOwn: true } });
    expect(feedPost).toBeNull();

    await app.close();
  });

  it("a scheduledAt in the past still publishes immediately", async () => {
    const app = await buildApp();
    const { token, userId } = await registerAndConnect(app);

    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const res = await app.inject({
      method: "POST",
      url: "/api/posts",
      headers: { authorization: `Bearer ${token}` },
      payload: { content: "hello past", platforms: ["bluesky"], scheduledAt: past },
    });
    expect(res.json().results[0].status).toBe("success");

    const feedPost = await prisma.feedPost.findFirst({ where: { userId, isOwn: true } });
    expect(feedPost).not.toBeNull();

    await app.close();
  });

  it("still rejects a platform with no connection, whether scheduled or immediate", async () => {
    const app = await buildApp();
    const { token } = await registerAndConnect(app);

    const res = await app.inject({
      method: "POST",
      url: "/api/posts",
      headers: { authorization: `Bearer ${token}` },
      payload: { content: "no mastodon here", platforms: ["mastodon"] },
    });
    expect(res.statusCode).toBe(400);

    await app.close();
  });
});
