import crypto from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { prisma } from "../db.js";
import { DEV_CRON_SECRET } from "../routes/internal.js";
import { registerLiveConnector, __resetRegistryForTests } from "../connectors/registry.js";
import type { PlatformConnector } from "../connectors/types.js";
import { encryptSecret } from "../lib/crypto.js";

function uniqueEmail(): string {
  return `internal-test-${crypto.randomUUID()}@nexus.app`;
}

async function registerUser(app: Awaited<ReturnType<typeof buildApp>>) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: uniqueEmail(), password: "password123", displayName: "Internal Test" },
  });
  return res.json().user.id as string;
}

/** Directly constructs a "scheduled and still pending" job, bypassing the route (which only accepts future timestamps as pending) so scheduledAt can be set precisely. */
async function createScheduledJob(userId: string, platform: string, scheduledAt: Date) {
  const job = await prisma.publishJob.create({
    data: { userId, content: "scheduled content", mediaUrls: "[]", scheduledAt },
  });
  const target = await prisma.publishTarget.create({ data: { jobId: job.id, platform } });
  return { job, target };
}

describe("Phase E2: POST /internal/tick", () => {
  afterEach(async () => {
    __resetRegistryForTests();
    await prisma.user.deleteMany({ where: { email: { contains: "internal-test-" } } });
  });

  it("rejects a request with no secret", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/internal/tick" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("rejects a request with the wrong secret", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/internal/tick",
      headers: { "x-cron-secret": "not-the-real-secret" },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("publishes a due job's pending target and leaves a future one untouched", async () => {
    const fake: PlatformConnector = {
      platform: "bluesky",
      async fetchTimeline() {
        return [];
      },
      async publish() {
        return { externalId: "live-scheduled-1", latencyMs: 5 };
      },
    };
    registerLiveConnector("bluesky", () => fake);

    const app = await buildApp();
    const userId = await registerUser(app);
    await prisma.connection.create({
      data: { userId, platform: "bluesky", handle: "@x.bsky.social", appPasswordEnc: encryptSecret("pw") },
    });

    const due = await createScheduledJob(userId, "bluesky", new Date(Date.now() - 60_000));
    const future = await createScheduledJob(userId, "bluesky", new Date(Date.now() + 60 * 60_000));

    const res = await app.inject({
      method: "POST",
      url: "/internal/tick",
      headers: { "x-cron-secret": DEV_CRON_SECRET },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.jobsProcessed).toBe(1);
    expect(body.targetsPublished).toBe(1);
    expect(body.targetsFailed).toBe(0);

    const dueTarget = await prisma.publishTarget.findUniqueOrThrow({ where: { id: due.target.id } });
    expect(dueTarget.status).toBe("success");
    expect(dueTarget.externalId).toBe("live-scheduled-1");

    const futureTarget = await prisma.publishTarget.findUniqueOrThrow({ where: { id: future.target.id } });
    expect(futureTarget.status).toBe("pending");

    const feedPost = await prisma.feedPost.findFirst({ where: { userId, isOwn: true } });
    expect(feedPost).not.toBeNull();

    await app.close();
  });

  it("marks a target failed (without crashing the tick) when the connector rejects at send time", async () => {
    const fake: PlatformConnector = {
      platform: "bluesky",
      async fetchTimeline() {
        return [];
      },
      async publish() {
        throw new Error("platform rejected the post");
      },
    };
    registerLiveConnector("bluesky", () => fake);

    const app = await buildApp();
    const userId = await registerUser(app);
    await prisma.connection.create({
      data: { userId, platform: "bluesky", handle: "@x.bsky.social", appPasswordEnc: encryptSecret("pw") },
    });
    const { target } = await createScheduledJob(userId, "bluesky", new Date(Date.now() - 60_000));

    const res = await app.inject({
      method: "POST",
      url: "/internal/tick",
      headers: { "x-cron-secret": DEV_CRON_SECRET },
    });
    expect(res.json().targetsFailed).toBe(1);

    const stored = await prisma.publishTarget.findUniqueOrThrow({ where: { id: target.id } });
    expect(stored.status).toBe("failed");
    expect(stored.error).toMatch(/platform rejected the post/);

    await app.close();
  });

  it("marks a target failed when the connection no longer exists at send time", async () => {
    const app = await buildApp();
    const userId = await registerUser(app);
    // Deliberately no Connection row created — simulates the user having disconnected since scheduling.
    const { target } = await createScheduledJob(userId, "bluesky", new Date(Date.now() - 60_000));

    const res = await app.inject({
      method: "POST",
      url: "/internal/tick",
      headers: { "x-cron-secret": DEV_CRON_SECRET },
    });
    expect(res.json().targetsFailed).toBe(1);

    const stored = await prisma.publishTarget.findUniqueOrThrow({ where: { id: target.id } });
    expect(stored.status).toBe("failed");
    expect(stored.error).toMatch(/no bluesky connection/i);

    await app.close();
  });

  it("rate-limits repeated tick calls", async () => {
    const app = await buildApp();
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/internal/tick",
        headers: { "x-cron-secret": DEV_CRON_SECRET },
      });
      statuses.push(res.statusCode);
    }
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
    await app.close();
  });
});
