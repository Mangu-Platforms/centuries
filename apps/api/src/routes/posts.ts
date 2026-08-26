import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { PLATFORMS, isPlatform, type PlatformId } from "../config.js";
import { getConnector } from "../connectors/registry.js";
import { decryptSecret } from "../lib/crypto.js";

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

    const job = await prisma.publishJob.create({
      data: {
        userId: request.user.sub,
        content,
        mediaUrls: JSON.stringify(mediaUrls),
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      },
    });

    const results: Array<{ platform: PlatformId; status: string; externalId: string; error: string; latencyMs: number }> = [];

    for (const platform of platforms) {
      const conn = byPlatform.get(platform)!;
      try {
        const hasCredentials = Boolean(conn.appPasswordEnc || conn.accessTokenEnc);
        const res = await getConnector(platform, hasCredentials).publish(
          {
            handle: conn.handle,
            instance: conn.instance,
            appPassword: conn.appPasswordEnc ? decryptSecret(conn.appPasswordEnc) : undefined,
            accessToken: conn.accessTokenEnc ? decryptSecret(conn.accessTokenEnc) : undefined,
          },
          content,
          mediaUrls,
        );
        await prisma.publishTarget.create({
          data: { jobId: job.id, platform, status: "success", externalId: res.externalId, latencyMs: res.latencyMs },
        });
        // Surface the user's own post in the unified feed.
        await prisma.feedPost.create({
          data: {
            userId: request.user.sub,
            connectionId: conn.id,
            platform,
            externalId: res.externalId,
            authorHandle: conn.handle,
            authorName: conn.displayName || conn.handle,
            authorAvatar: "",
            content,
            mediaUrls: JSON.stringify(mediaUrls),
            isOwn: true,
            postedAt: new Date(),
          },
        });
        results.push({ platform, status: "success", externalId: res.externalId, error: "", latencyMs: res.latencyMs });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        await prisma.publishTarget.create({
          data: { jobId: job.id, platform, status: "failed", error: message },
        });
        results.push({ platform, status: "failed", externalId: "", error: message, latencyMs: 0 });
      }
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
