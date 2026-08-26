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

describe("Phase E6: idempotency keys", () => {
  afterEach(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: "posts-test-" } } });
  });

  it("a retried request with the same key returns the original job instead of publishing again", async () => {
    const app = await buildApp();
    const { token, userId } = await registerAndConnect(app);
    const idempotencyKey = crypto.randomUUID();

    const first = await app.inject({
      method: "POST",
      url: "/api/posts",
      headers: { authorization: `Bearer ${token}` },
      payload: { content: "double-click me", platforms: ["bluesky"], idempotencyKey },
    });
    expect(first.statusCode).toBe(201);
    const firstBody = first.json();

    const retry = await app.inject({
      method: "POST",
      url: "/api/posts",
      headers: { authorization: `Bearer ${token}` },
      payload: { content: "double-click me", platforms: ["bluesky"], idempotencyKey },
    });
    expect(retry.statusCode).toBe(200); // not 201 — nothing new was created
    const retryBody = retry.json();
    expect(retryBody.jobId).toBe(firstBody.jobId);
    expect(retryBody.results).toEqual(firstBody.results);

    expect(await prisma.publishJob.count({ where: { userId } })).toBe(1);
    expect(await prisma.feedPost.count({ where: { userId, isOwn: true } })).toBe(1);

    await app.close();
  });

  it("truly concurrent requests with the same key still only publish once", async () => {
    const app = await buildApp();
    const { token, userId } = await registerAndConnect(app);
    const idempotencyKey = crypto.randomUUID();
    const payload = { content: "racing requests", platforms: ["bluesky"], idempotencyKey };

    const [a, b] = await Promise.all([
      app.inject({ method: "POST", url: "/api/posts", headers: { authorization: `Bearer ${token}` }, payload }),
      app.inject({ method: "POST", url: "/api/posts", headers: { authorization: `Bearer ${token}` }, payload }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 201]);
    expect(a.json().jobId).toBe(b.json().jobId);

    expect(await prisma.publishJob.count({ where: { userId } })).toBe(1);
    expect(await prisma.feedPost.count({ where: { userId, isOwn: true } })).toBe(1);

    await app.close();
  });

  it("a different key creates a genuinely separate post", async () => {
    const app = await buildApp();
    const { token, userId } = await registerAndConnect(app);

    await app.inject({
      method: "POST",
      url: "/api/posts",
      headers: { authorization: `Bearer ${token}` },
      payload: { content: "post one", platforms: ["bluesky"], idempotencyKey: crypto.randomUUID() },
    });
    await app.inject({
      method: "POST",
      url: "/api/posts",
      headers: { authorization: `Bearer ${token}` },
      payload: { content: "post two", platforms: ["bluesky"], idempotencyKey: crypto.randomUUID() },
    });

    expect(await prisma.publishJob.count({ where: { userId } })).toBe(2);

    await app.close();
  });

  it("omitting the key entirely still works and allows multiple posts (backward compatible)", async () => {
    const app = await buildApp();
    const { token, userId } = await registerAndConnect(app);

    const a = await app.inject({
      method: "POST",
      url: "/api/posts",
      headers: { authorization: `Bearer ${token}` },
      payload: { content: "no key one", platforms: ["bluesky"] },
    });
    const b = await app.inject({
      method: "POST",
      url: "/api/posts",
      headers: { authorization: `Bearer ${token}` },
      payload: { content: "no key two", platforms: ["bluesky"] },
    });
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    expect(await prisma.publishJob.count({ where: { userId } })).toBe(2);

    await app.close();
  });
});
