import { describe, expect, it } from "vitest";
import crypto from "node:crypto";

// Phase E8: managing a scheduled post before it fires — cancel (DELETE)
// and edit (PATCH), both only while every target is still pending.

const { buildApp } = await import("../app.js");
const { prisma } = await import("../db.js");

async function registerUser(app: Awaited<ReturnType<typeof buildApp>>) {
  const email = `posts-schedule-${crypto.randomUUID()}@nexus.app`;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, password: "password123", displayName: "Schedule Test" },
  });
  const body = res.json();
  return { token: body.token as string, userId: body.user.id as string };
}

async function connect(app: Awaited<ReturnType<typeof buildApp>>, token: string, platform: string, handle: string) {
  await app.inject({
    method: "POST",
    url: "/api/connections",
    headers: { authorization: `Bearer ${token}` },
    payload: { platform, handle },
  });
}

async function schedule(
  app: Awaited<ReturnType<typeof buildApp>>,
  token: string,
  platforms: string[],
  content = "scheduled post",
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/posts",
    headers: { authorization: `Bearer ${token}` },
    payload: {
      content,
      platforms,
      scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
  });
  expect(res.statusCode).toBe(201);
  expect(res.json().results.every((r: { status: string }) => r.status === "pending")).toBe(true);
  return res.json().jobId as string;
}

describe("scheduled post management (E8)", () => {
  describe("DELETE /api/posts/:id", () => {
    it("cancels a scheduled job while every target is pending (job and targets removed)", async () => {
      const app = await buildApp();
      const { token, userId } = await registerUser(app);
      await connect(app, token, "twitter", "schedcancel");
      const jobId = await schedule(app, token, ["twitter"]);

      const res = await app.inject({
        method: "DELETE",
        url: `/api/posts/${jobId}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(await prisma.publishJob.findUnique({ where: { id: jobId } })).toBeNull();
      expect(await prisma.publishTarget.count({ where: { jobId } })).toBe(0);

      await prisma.user.delete({ where: { id: userId } });
      await app.close();
    });

    it("refuses (409) once any target has been attempted — history is a ledger, not editable", async () => {
      const app = await buildApp();
      const { token, userId } = await registerUser(app);
      await connect(app, token, "twitter", "schedsent");

      const res = await app.inject({
        method: "POST",
        url: "/api/posts",
        headers: { authorization: `Bearer ${token}` },
        payload: { content: "sent immediately", platforms: ["twitter"] },
      });
      const jobId = res.json().jobId as string;

      const del = await app.inject({
        method: "DELETE",
        url: `/api/posts/${jobId}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(del.statusCode).toBe(409);
      expect(await prisma.publishJob.findUnique({ where: { id: jobId } })).not.toBeNull();

      await prisma.user.delete({ where: { id: userId } });
      await app.close();
    });

    it("404s for another user's job", async () => {
      const app = await buildApp();
      const { token: tokenA, userId: userA } = await registerUser(app);
      const { token: tokenB, userId: userB } = await registerUser(app);
      await connect(app, tokenA, "twitter", "schedforeign");
      const jobId = await schedule(app, tokenA, ["twitter"]);

      const res = await app.inject({
        method: "DELETE",
        url: `/api/posts/${jobId}`,
        headers: { authorization: `Bearer ${tokenB}` },
      });
      expect(res.statusCode).toBe(404);

      await prisma.user.delete({ where: { id: userA } });
      await prisma.user.delete({ where: { id: userB } });
      await app.close();
    });
  });

  describe("PATCH /api/posts/:id", () => {
    it("edits content and fire time while all targets are pending", async () => {
      const app = await buildApp();
      const { token, userId } = await registerUser(app);
      await connect(app, token, "twitter", "schededit");
      const jobId = await schedule(app, token, ["twitter"], "original wording");

      const newTime = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      const res = await app.inject({
        method: "PATCH",
        url: `/api/posts/${jobId}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { content: "rewritten wording", scheduledAt: newTime },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().job.content).toBe("rewritten wording");

      const stored = await prisma.publishJob.findUniqueOrThrow({ where: { id: jobId } });
      expect(stored.content).toBe("rewritten wording");
      expect(stored.scheduledAt?.toISOString()).toBe(newTime);

      await prisma.user.delete({ where: { id: userId } });
      await app.close();
    });

    it("re-validates per-platform character limits against the job's own targets", async () => {
      const app = await buildApp();
      const { token, userId } = await registerUser(app);
      await connect(app, token, "twitter", "schedlimit");
      const jobId = await schedule(app, token, ["twitter"]);

      const res = await app.inject({
        method: "PATCH",
        url: `/api/posts/${jobId}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { content: "x".repeat(281) },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/Twitter \/ X limit of 280/);

      const stored = await prisma.publishJob.findUniqueOrThrow({ where: { id: jobId } });
      expect(stored.content).toBe("scheduled post"); // unchanged

      await prisma.user.delete({ where: { id: userId } });
      await app.close();
    });

    it("refuses (409) once any target has been attempted", async () => {
      const app = await buildApp();
      const { token, userId } = await registerUser(app);
      await connect(app, token, "twitter", "schededitsent");

      const res = await app.inject({
        method: "POST",
        url: "/api/posts",
        headers: { authorization: `Bearer ${token}` },
        payload: { content: "already out", platforms: ["twitter"] },
      });
      const jobId = res.json().jobId as string;

      const patch = await app.inject({
        method: "PATCH",
        url: `/api/posts/${jobId}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { content: "too late" },
      });
      expect(patch.statusCode).toBe(409);

      await prisma.user.delete({ where: { id: userId } });
      await app.close();
    });

    it("rejects a scheduledAt in the past", async () => {
      const app = await buildApp();
      const { token, userId } = await registerUser(app);
      await connect(app, token, "twitter", "schedpast");
      const jobId = await schedule(app, token, ["twitter"]);

      const res = await app.inject({
        method: "PATCH",
        url: `/api/posts/${jobId}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { scheduledAt: new Date(Date.now() - 60_000).toISOString() },
      });
      expect(res.statusCode).toBe(400);

      await prisma.user.delete({ where: { id: userId } });
      await app.close();
    });
  });
});
