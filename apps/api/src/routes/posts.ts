import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";
import { PLATFORMS, isPlatform, type PlatformId } from "../config.js";
import { attemptPublish } from "../lib/publish.js";

const publishSchema = z.object({
  content: z.string().min(1, "Post content is required").max(5000),
  platforms: z.array(z.string()).min(1, "Select at least one platform"),
  mediaUrls: z.array(z.string()).max(4).optional(),
  scheduledAt: z.string().datetime().optional(),
  // Phase E6: an optional client-generated key (the web composer sends a
  // UUID, one per compose session) so a retried request — a double-click,
  // a client retry after a dropped response — returns the original job's
  // result instead of publishing again.
  idempotencyKey: z.string().min(1).max(200).optional(),
});

type PublishResultItem = { platform: PlatformId; status: string; externalId: string; error: string; latencyMs: number };

/** Reconstructs the {jobId, results} response shape from an already-created job's current target rows. */
async function jobResponse(jobId: string): Promise<{ jobId: string; results: PublishResultItem[] }> {
  const targets = await prisma.publishTarget.findMany({ where: { jobId } });
  return {
    jobId,
    results: targets.map((t) => ({
      platform: t.platform as PlatformId,
      status: t.status,
      externalId: t.externalId,
      error: t.error,
      latencyMs: t.latencyMs,
    })),
  };
}

export async function postRoutes(app: FastifyInstance): Promise<void> {
  // Cross-platform publishing (BRD section 5.5).
  app.post("/api/posts", { preHandler: [app.authenticate] }, async (request, reply) => {
    const parsed = publishSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message });

    const { content, mediaUrls = [], scheduledAt, idempotencyKey } = parsed.data;
    const platforms = parsed.data.platforms.filter(isPlatform) as PlatformId[];
    if (platforms.length === 0) return reply.code(400).send({ error: "No valid platforms selected" });

    // A replayed request (same key, same user) returns the original job's
    // result rather than publishing again. Short-circuits before any of
    // the validation below, since a genuine replay should succeed even if
    // e.g. a connection was disconnected since the original request.
    if (idempotencyKey) {
      const existing = await prisma.publishJob.findUnique({
        where: { userId_idempotencyKey: { userId: request.user.sub, idempotencyKey } },
      });
      if (existing) return reply.send(await jobResponse(existing.id));
    }

    // Validate per-platform character limits (BRD CP02).
    const tooLong = platforms.find((p) => content.length > PLATFORMS[p].charLimit);
    if (tooLong) {
      return reply.code(400).send({
        error: `Content exceeds the ${PLATFORMS[tooLong].name} limit of ${PLATFORMS[tooLong].charLimit} characters`,
      });
    }

    // Verify the user has an active connection for each selected platform.
    const connections = await prisma.connection.findMany({
      where: { userId: request.user.sub, platform: { in: platforms } },
    });
    const byPlatform = new Map(connections.map((c) => [c.platform, c]));
    const missing = platforms.filter((p) => !byPlatform.has(p));
    if (missing.length > 0) {
      return reply.code(400).send({
        error: `Connect these platforms first: ${missing.map((p) => PLATFORMS[p].name).join(", ")}`,
      });
    }

    // Phase E2: a post scheduled for the future must not be sent now — it
    // used to be (scheduledAt was stored but never actually checked before
    // publishing). Every target starts "pending" regardless; only a
    // due-or-unscheduled post is attempted immediately here. A future one
    // is picked up later by POST /internal/tick (routes/internal.ts).
    const scheduledDate = scheduledAt ? new Date(scheduledAt) : null;
    const isFutureSend = scheduledDate !== null && scheduledDate.getTime() > Date.now();

    let job;
    try {
      job = await prisma.publishJob.create({
        data: {
          userId: request.user.sub,
          content,
          mediaUrls: JSON.stringify(mediaUrls),
          scheduledAt: scheduledDate,
          idempotencyKey: idempotencyKey ?? null,
        },
      });
    } catch (err) {
      // A genuinely concurrent request with the same key (e.g. a true
      // double-click racing two requests before either commits) can lose
      // the check above and still hit the unique constraint here — that's
      // fine, it just means the other request won the race. Return its
      // result rather than erroring.
      if (idempotencyKey && err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const winner = await prisma.publishJob.findUniqueOrThrow({
          where: { userId_idempotencyKey: { userId: request.user.sub, idempotencyKey } },
        });
        return reply.send(await jobResponse(winner.id));
      }
      throw err;
    }

    const targets = await Promise.all(
      platforms.map((platform) => prisma.publishTarget.create({ data: { jobId: job.id, platform } })),
    );

    const results: Array<{ platform: PlatformId; status: string; externalId: string; error: string; latencyMs: number }> = [];

    for (const target of targets) {
      const platform = target.platform as PlatformId;
      if (isFutureSend) {
        results.push({ platform, status: "pending", externalId: "", error: "", latencyMs: 0 });
        continue;
      }
      const conn = byPlatform.get(platform)!;
      const outcome = await attemptPublish({
        targetId: target.id,
        userId: request.user.sub,
        connection: conn,
        platform,
        content,
        mediaUrls,
      });
      if (outcome.status === "skipped") {
        // A concurrent tick beat this request to a due-scheduled target's
        // claim — report the row's actual current state, not "skipped".
        const current = await prisma.publishTarget.findUniqueOrThrow({ where: { id: target.id } });
        results.push({
          platform,
          status: current.status,
          externalId: current.externalId,
          error: current.error,
          latencyMs: current.latencyMs,
        });
        continue;
      }
      results.push({ platform, ...outcome });
    }

    return reply.code(201).send({ jobId: job.id, results });
  });

  // Phase E7: re-attempt ONLY a job's failed targets. Partial failure is
  // already reported per target (CP03); this turns it into one-tap
  // recovery. Race-safe by an atomic claim: each failed target is flipped
  // failed→pending via a guarded updateMany, so of two concurrent retries
  // only one actually re-publishes any given target (the loser's claim
  // matches zero rows). Rate-limited: every claim triggers an outbound
  // publish attempt.
  app.post(
    "/api/posts/:id/retry",
    { preHandler: [app.rateLimit({ max: 10, timeWindow: "1 minute" }), app.authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const job = await prisma.publishJob.findFirst({
        where: { id, userId: request.user.sub },
        include: { targets: true },
      });
      if (!job) return reply.code(404).send({ error: "Post not found" });

      const failedTargets = job.targets.filter((t) => t.status === "failed");
      const mediaUrls = JSON.parse(job.mediaUrls) as string[];

      const platforms = failedTargets.map((t) => t.platform as PlatformId);
      const connections = platforms.length
        ? await prisma.connection.findMany({
            where: { userId: request.user.sub, platform: { in: platforms } },
          })
        : [];
      const byPlatform = new Map(connections.map((c) => [c.platform, c]));

      let retried = 0;
      for (const target of failedTargets) {
        const platform = target.platform as PlatformId;
        const connection = byPlatform.get(platform);
        if (!connection) {
          await prisma.publishTarget.updateMany({
            where: { id: target.id, status: "failed" },
            data: { error: `No ${platform} connection found at retry time` },
          });
          continue;
        }

        // The atomic claim: only the request that wins this update may
        // re-publish this target. (If the process died between claim and
        // attempt, the target would show as "pending" until a further
        // manual retry — visible, not silent, and never double-posted.)
        const claim = await prisma.publishTarget.updateMany({
          where: { id: target.id, status: "failed" },
          data: { status: "pending", error: "" },
        });
        if (claim.count === 0) continue;

        const outcome = await attemptPublish({
          targetId: target.id,
          userId: request.user.sub,
          connection,
          platform,
          content: job.content,
          mediaUrls,
        });
        if (outcome.status !== "skipped") retried++;
      }

      const { results } = await jobResponse(job.id);
      return reply.send({ jobId: job.id, retried, results });
    },
  );

  // Phase E8: manage a scheduled post before it fires. Both routes require
  // (a) every target still "pending" AND (b) a strictly future scheduledAt.
  // (b) is what makes this race-free without locks: the tick worker only
  // ever claims targets of jobs whose scheduledAt is in the past, so a
  // future-scheduled job cannot be mid-publish while we cancel or edit it.
  // Anything already attempted (or already due) is ledger, not editable.
  app.delete("/api/posts/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await prisma.publishJob.findFirst({
      where: { id, userId: request.user.sub },
      include: { targets: true },
    });
    if (!job) return reply.code(404).send({ error: "Post not found" });

    const editable =
      job.targets.every((t) => t.status === "pending") &&
      job.scheduledAt !== null &&
      job.scheduledAt.getTime() > Date.now();
    if (!editable) {
      return reply.code(409).send({ error: "Only a not-yet-due scheduled post can be canceled" });
    }

    await prisma.publishJob.delete({ where: { id: job.id } }); // targets cascade
    return reply.send({ ok: true });
  });

  const editSchema = z.object({
    content: z.string().min(1).max(5000).optional(),
    scheduledAt: z.string().datetime().optional(),
  });

  app.patch("/api/posts/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = editSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message });

    const job = await prisma.publishJob.findFirst({
      where: { id, userId: request.user.sub },
      include: { targets: true },
    });
    if (!job) return reply.code(404).send({ error: "Post not found" });

    const editable =
      job.targets.every((t) => t.status === "pending") &&
      job.scheduledAt !== null &&
      job.scheduledAt.getTime() > Date.now();
    if (!editable) {
      return reply.code(409).send({ error: "Only a not-yet-due scheduled post can be edited" });
    }

    const content = parsed.data.content ?? job.content;
    // Re-validate limits against the job's own targets (CP02 holds on edit
    // exactly as it does on create).
    const platforms = job.targets.map((t) => t.platform).filter(isPlatform);
    const tooLong = platforms.find((p) => content.length > PLATFORMS[p].charLimit);
    if (tooLong) {
      return reply.code(400).send({
        error: `Content exceeds the ${PLATFORMS[tooLong].name} limit of ${PLATFORMS[tooLong].charLimit} characters`,
      });
    }

    let scheduledAt = job.scheduledAt;
    if (parsed.data.scheduledAt) {
      const next = new Date(parsed.data.scheduledAt);
      if (next.getTime() <= Date.now()) {
        return reply.code(400).send({ error: "The new send time must be in the future" });
      }
      scheduledAt = next;
    }

    const updated = await prisma.publishJob.update({
      where: { id: job.id },
      data: { content, scheduledAt },
    });
    return reply.send({
      job: {
        id: updated.id,
        content: updated.content,
        scheduledAt: updated.scheduledAt,
        mediaUrls: JSON.parse(updated.mediaUrls) as string[],
        createdAt: updated.createdAt,
      },
    });
  });

  // Publishing history (BRD DS03).
  app.get("/api/posts/history", { preHandler: [app.authenticate] }, async (request) => {
    const jobs = await prisma.publishJob.findMany({
      where: { userId: request.user.sub },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { targets: true },
    });
    return {
      jobs: jobs.map((j) => ({
        id: j.id,
        content: j.content,
        mediaUrls: JSON.parse(j.mediaUrls) as string[],
        scheduledAt: j.scheduledAt,
        createdAt: j.createdAt,
        targets: j.targets.map((t) => ({
          platform: t.platform,
          status: t.status,
          latencyMs: t.latencyMs,
          error: t.error,
        })),
      })),
    };
  });
}
