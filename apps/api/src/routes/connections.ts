import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { PLATFORMS, isPlatform } from "../config.js";
import { getConnector } from "../connectors/demo.js";

const connectSchema = z.object({
  platform: z.string().refine(isPlatform, "Unsupported platform"),
  handle: z.string().min(1).max(120),
  instance: z.string().max(120).optional(),
  // app password (bluesky) / token are accepted but not required in demo mode
  credential: z.string().optional(),
});

export async function connectionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/connections", { preHandler: [app.authenticate] }, async (request) => {
    const connections = await prisma.connection.findMany({
      where: { userId: request.user.sub },
      orderBy: { createdAt: "asc" },
    });
    return { connections };
  });

  app.post("/api/connections", { preHandler: [app.authenticate] }, async (request, reply) => {
    const parsed = connectSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message });

    const { platform, instance, credential } = parsed.data;
    let handle = parsed.data.handle.trim();
    if (!handle.startsWith("@") && platform !== "mastodon") handle = "@" + handle;
    if (!isPlatform(platform)) return reply.code(400).send({ error: "Unsupported platform" });

    const existing = await prisma.connection.findUnique({
      where: { userId_platform_handle: { userId: request.user.sub, platform, handle } },
    });
    if (existing) {
      return reply.code(409).send({ error: `${PLATFORMS[platform].name} account already connected` });
    }

    const connection = await prisma.connection.create({
      data: {
        userId: request.user.sub,
        platform,
        handle,
        displayName: handle,
        instance: instance ?? "",
        status: "active",
      },
    });

    // Pull an initial timeline from the connector so the feed is populated.
    const connector = getConnector(platform);
    const remote = await connector.fetchTimeline({ handle, instance }, 8);
    if (remote.length > 0) {
      await prisma.feedPost.createMany({
        data: remote.map((p) => ({
          userId: request.user.sub,
          connectionId: connection.id,
          platform,
          externalId: p.externalId,
          authorHandle: p.authorHandle,
          authorName: p.authorName,
          authorAvatar: p.authorAvatar,
          content: p.content,
          mediaUrls: JSON.stringify(p.mediaUrls),
          likeCount: p.likeCount,
          repostCount: p.repostCount,
          replyCount: p.replyCount,
          postedAt: p.postedAt,
        })),
      });
    }
    void credential; // accepted for parity with real connectors; unused in demo

    return reply.code(201).send({ connection, importedPosts: remote.length });
  });

  app.delete("/api/connections/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const connection = await prisma.connection.findFirst({
      where: { id, userId: request.user.sub },
    });
    if (!connection) return reply.code(404).send({ error: "Connection not found" });

    await prisma.connection.delete({ where: { id } });
    return reply.send({ ok: true });
  });
}
