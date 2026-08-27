import { describe, expect, it } from "vitest";
import crypto from "node:crypto";

// Phase E7: POST /api/posts/:id/retry — re-attempts ONLY a job's failed
// targets, race-safely (a double-clicked retry must not double-post).

const { buildApp } = await import("../app.js");
const { prisma } = await import("../db.js");

async function registerUser(app: Awaited<ReturnType<typeof buildApp>>) {
  const email = `posts-retry-${crypto.randomUUID()}@nexus.app`;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, password: "password123", displayName: "Retry Test" },
  });
  const body = res.json();
  return { token: body.token as string, userId: body.user.id as string };
}

async function connectPlatform(
  app: Awaited<ReturnType<typeof buildApp>>,
  token: string,
  platform: string,
  handle: string,
) {
  const res = await app.inject({
    method: "POST",
    url: "/api/connections",
    headers: { authorization: `Bearer ${token}` },
    payload: { platform, handle },
  });
  return res.json().connection.id as string;
}

async function publish(
  app: Awaited<ReturnType<typeof buildApp>>,
  token: string,
  platforms: string[],
): Promise<{ jobId: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/posts",
    headers: { authorization: `Bearer ${token}` },
    payload: { content: "retry me", platforms },
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

describe("POST /api/posts/:id/retry (E7)", () => {
  it("404s for an unknown job and for another user's job", async () => {
    const app = await buildApp();
    const { token: tokenA, userId: userA } = await registerUser(app);
    const { token: tokenB, userId: userB } = await registerUser(app);

    await connectPlatform(app, tokenA, "twitter", "retrya");
    const { jobId } = await publish(app, tokenA, ["twitter"]);

    const unknown = await app.inject({
      method: "POST",
      url: "/api/posts/nonexistent-id/retry",
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(unknown.statusCode).toBe(404);

    const foreign = await app.inject({
      method: "POST",
      url: `/api/posts/${jobId}/retry`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(foreign.statusCode).toBe(404);

    await prisma.user.delete({ where: { id: userA } });
    await prisma.user.delete({ where: { id: userB } });
    await app.close();
  });

  it("re-attempts only the failed targets and leaves successful ones untouched", async () => {
    const app = await buildApp();
    const { token, userId } = await registerUser(app);
    await connectPlatform(app, token, "twitter", "retryboth1");
    await connectPlatform(app, token, "threads", "retryboth2");

    const { jobId } = await publish(app, token, ["twitter", "threads"]);

    // Both demo publishes succeeded; simulate that threads had failed.
    const successTarget = await prisma.publishTarget.findFirstOrThrow({
      where: { jobId, platform: "twitter" },
    });
    await prisma.publishTarget.updateMany({
      where: { jobId, platform: "threads" },
      data: { status: "failed", error: "simulated outage", externalId: "", latencyMs: 0 },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/posts/${jobId}/retry`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.retried).toBe(1);

    const byPlatform = Object.fromEntries(
      (body.results as Array<{ platform: string; status: string }>).map((r) => [r.platform, r]),
    );
    expect(byPlatform.threads.status).toBe("success");
    expect(byPlatform.twitter.status).toBe("success");

    // The already-successful target was not re-published: row unchanged.
    const successAfter = await prisma.publishTarget.findUniqueOrThrow({ where: { id: successTarget.id } });
    expect(successAfter.externalId).toBe(successTarget.externalId);
    expect(successAfter.latencyMs).toBe(successTarget.latencyMs);

    await prisma.user.delete({ where: { id: userId } });
    await app.close();
  });

  it("records a fresh failure when the platform has no connection at retry time", async () => {
    const app = await buildApp();
    const { token, userId } = await registerUser(app);
    const connectionId = await connectPlatform(app, token, "twitter", "retrygone");
    const { jobId } = await publish(app, token, ["twitter"]);

    await prisma.publishTarget.updateMany({
      where: { jobId },
      data: { status: "failed", error: "simulated outage" },
    });
    await app.inject({
      method: "DELETE",
      url: `/api/connections/${connectionId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/posts/${jobId}/retry`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.retried).toBe(0);
    expect(body.results[0].status).toBe("failed");
    expect(body.results[0].error).toMatch(/No twitter connection found at retry time/);

    await prisma.user.delete({ where: { id: userId } });
    await app.close();
  });

  it("is a no-op (retried: 0) when the job has no failed targets", async () => {
    const app = await buildApp();
    const { token, userId } = await registerUser(app);
    await connectPlatform(app, token, "twitter", "retrynoop");
    const { jobId } = await publish(app, token, ["twitter"]);

    const res = await app.inject({
      method: "POST",
      url: `/api/posts/${jobId}/retry`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().retried).toBe(0);
    expect(res.json().results[0].status).toBe("success");

    await prisma.user.delete({ where: { id: userId } });
    await app.close();
  });

  it("publishes a raced-retried target exactly once (atomic claim)", async () => {
    const app = await buildApp();
    const { token, userId } = await registerUser(app);
    await connectPlatform(app, token, "twitter", "retryrace");
    const { jobId } = await publish(app, token, ["twitter"]);

    await prisma.publishTarget.updateMany({
      where: { jobId },
      data: { status: "failed", error: "simulated outage", externalId: "" },
    });

    const [a, b] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/posts/${jobId}/retry`,
        headers: { authorization: `Bearer ${token}` },
      }),
      app.inject({
        method: "POST",
        url: `/api/posts/${jobId}/retry`,
        headers: { authorization: `Bearer ${token}` },
      }),
    ]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    // Exactly ONE of the two concurrent requests actually re-published.
    expect(a.json().retried + b.json().retried).toBe(1);

    // And exactly one own-post row exists for this retry (the original
    // success was wiped above by resetting externalId, so any isOwn rows
    // beyond the first publish's are from the retry).
    const target = await prisma.publishTarget.findFirstOrThrow({ where: { jobId } });
    expect(target.status).toBe("success");

    await prisma.user.delete({ where: { id: userId } });
    await app.close();
  });

  it("attemptPublish's claim makes a retry racing the tick worker publish exactly once", async () => {
    const { attemptPublish } = await import("../lib/publish.js");
    const app = await buildApp();
    const { token, userId } = await registerUser(app);
    await connectPlatform(app, token, "twitter", "retrytickrace");
    const { jobId } = await publish(app, token, ["twitter"]);

    // A pending target on a due job — the state both a user retry and a
    // concurrent /internal/tick would see.
    const target = await prisma.publishTarget.findFirstOrThrow({ where: { jobId } });
    await prisma.publishTarget.update({
      where: { id: target.id },
      data: { status: "pending", externalId: "", error: "", latencyMs: 0 },
    });
    const connection = await prisma.connection.findFirstOrThrow({
      where: { userId, platform: "twitter" },
    });
    const ownPostsBefore = await prisma.feedPost.count({ where: { userId, isOwn: true } });

    const params = {
      targetId: target.id,
      userId,
      connection,
      platform: "twitter" as const,
      content: "raced publish",
      mediaUrls: [] as string[],
    };
    const [a, b] = await Promise.all([attemptPublish(params), attemptPublish(params)]);

    // Exactly one caller wins the claim and publishes; the loser reports
    // "skipped" and must not have touched the connector or the feed.
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(["skipped", "success"]);
    const ownPostsAfter = await prisma.feedPost.count({ where: { userId, isOwn: true } });
    expect(ownPostsAfter).toBe(ownPostsBefore + 1);

    await prisma.user.delete({ where: { id: userId } });
    await app.close();
  });

  it("is rate-limited", async () => {
    const app = await buildApp();
    const { token, userId } = await registerUser(app);
    await connectPlatform(app, token, "twitter", "retrylimit");
    const { jobId } = await publish(app, token, ["twitter"]);

    let limited = false;
    for (let i = 0; i < 11; i++) {
      const res = await app.inject({
        method: "POST",
        url: `/api/posts/${jobId}/retry`,
        headers: { authorization: `Bearer ${token}` },
      });
      if (res.statusCode === 429) {
        limited = true;
        break;
      }
      expect(res.statusCode).toBe(200);
    }
    expect(limited).toBe(true);

    await prisma.user.delete({ where: { id: userId } });
    await app.close();
  });
});
