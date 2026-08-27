import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { ALLOWED_MEDIA_MIME_TYPES, localUploadPath, storeMedia } from "../lib/mediaStorage.js";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB — generous for images, bounds abuse

// Only ever matches a key this route itself generated (see mediaStorage.ts's
// LocalDiskStorage — a crypto.randomUUID() plus a fixed extension), so a
// client can never point this at an arbitrary path on disk.
const KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|gif|webp)$/i;

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

export async function mediaRoutes(app: FastifyInstance): Promise<void> {
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

  // Media upload pipeline (Phase E3): local-disk storage today (see
  // lib/mediaStorage.ts), S3-compatible storage parked WAITING-ON-HUMAN
  // pending real bucket credentials. Returns a URL usable directly in
  // POST /api/posts's mediaUrls.
  app.post(
    "/api/media/upload",
    { preHandler: [app.rateLimit({ max: 20, timeWindow: "1 minute" }), app.authenticate] },
    async (request, reply) => {
      const file = await request.file();
      if (!file) return reply.code(400).send({ error: "No file uploaded" });

      if (!ALLOWED_MEDIA_MIME_TYPES.includes(file.mimetype)) {
        return reply.code(400).send({
          error: `Unsupported file type: ${file.mimetype}. Allowed: ${ALLOWED_MEDIA_MIME_TYPES.join(", ")}`,
        });
      }

      const buffer = await file.toBuffer();
      // @fastify/multipart doesn't reject an oversized file mid-stream when
      // buffered via toBuffer() — it silently truncates and flags it here.
      if (file.file.truncated) {
        return reply.code(413).send({ error: `File too large. Max ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB` });
      }

      const { url, key } = await storeMedia(buffer, file.mimetype);
      return reply.code(201).send({ url, key });
    },
  );

  // Serves locally-stored media (LocalDiskStorage's default today). A
  // future S3Storage would return a direct bucket URL instead and
  // wouldn't touch this route at all.
  app.get("/uploads/:key", async (request, reply) => {
    const { key } = request.params as { key: string };
    if (!KEY_PATTERN.test(key)) return reply.code(400).send({ error: "Invalid media key" });

    const filePath = localUploadPath(key);
    try {
      await stat(filePath);
    } catch {
      return reply.code(404).send({ error: "Not found" });
    }

    const ext = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
    reply.header("content-type", MIME_BY_EXT[ext] ?? "application/octet-stream");
    reply.header("cache-control", "public, max-age=31536000, immutable");
    return reply.send(createReadStream(filePath));
  });
}
