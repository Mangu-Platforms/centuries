import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { PLATFORMS, isPlatform, type PlatformId } from "../config.js";
import { attemptPublish } from "../lib/publish.js";

const publishSchema = z.object({
  content: z.string().min(1, "Post content is required").max(5000),
  platforms: z.array(z.string()).min(1, "Select at least one platform"),
  mediaUrls: z.array(z.string()).max(4).optional(),
  scheduledAt: z.string().datetime().optional(),
});

export async function postRoutes(app: FastifyInstance): Promise<void> {
  // Cross-platform publishing (BRD section 5.5).
  app.post("/api/posts", { preHandler: [app.authenticate] }, async (request, reply) => {
    const parsed = publishSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message });

    const { content, mediaUrls = [], scheduledAt } = parsed.data;
    const platforms = parsed.data.platforms.filter(isPlatform) as PlatformId[];
    if (platforms.length === 0) return reply.code(400).send({ error: "No valid platforms selected" });

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

    const job = await prisma.publishJob.create({
      data: {
        userId: request.user.sub,
        content,
        mediaUrls: JSON.stringify(mediaUrls),
        scheduledAt: scheduledDate,
      },
    });

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
      results.push({ platform, ...outcome });
    }

    return reply.code(201).send({ jobId: job.id, results });
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
