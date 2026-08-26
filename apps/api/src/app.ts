import crypto from "node:crypto";
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { config, PLATFORMS } from "./config.js";
import { prisma } from "./db.js";
import { registerAuth } from "./plugins/auth.js";
import { authRoutes } from "./routes/auth.js";
import { connectionRoutes } from "./routes/connections.js";
import { feedRoutes } from "./routes/feed.js";
import { postRoutes } from "./routes/posts.js";
import { dashboardRoutes } from "./routes/dashboard.js";
// Side-effect import: registers the live Bluesky connector with the
// connector registry (see connectors/registry.ts). Each live connector as
// it's implemented (Phase C) gets one line like this — this is the single
// place that wires "live connectors exist" into a running app.
import "./connectors/bluesky.js";

/** Structured API error shape returned by the global error/not-found handlers. */
interface ApiErrorBody {
  error: string;
  code: string;
  requestId: string;
  details?: unknown;
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.isProd
      ? true
      : { transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } } },
    genReqId: () => crypto.randomUUID(),
  });

  app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header("x-request-id", request.id);
  });

  await app.register(cors, { origin: config.corsOrigin, credentials: true });
  await registerAuth(app);

  // Uncaught errors (thrown exceptions, Fastify schema/body-parsing
  // failures) get a consistent { error, code, requestId, details? } shape
  // with the request id for correlation with logs. Handlers that already
  // return their own { error } shape via reply.send() (most route-level
  // Zod validation) are unaffected — this only catches what would otherwise
  // become Fastify's default error response.
  app.setErrorHandler((err: FastifyError, request, reply) => {
    const statusCode = err.statusCode ?? 500;
    const body: ApiErrorBody = {
      error: statusCode >= 500 ? "Internal server error" : err.message,
      code: err.code ?? (statusCode >= 500 ? "INTERNAL_ERROR" : "BAD_REQUEST"),
      requestId: request.id,
    };
    if (statusCode >= 500) {
      request.log.error({ err, requestId: request.id }, "Unhandled error");
    }
    void reply.code(statusCode).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    const body: ApiErrorBody = {
      error: "Not found",
      code: "NOT_FOUND",
      requestId: request.id,
    };
    void reply.code(404).send(body);
  });

  app.get("/health", async () => ({ status: "ok", uptime: process.uptime() }));
  app.get("/ready", async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: "ready" };
    } catch {
      return reply.code(503).send({ status: "not-ready" });
    }
  });
  app.get("/api/platforms", async () => ({ platforms: Object.values(PLATFORMS) }));

  await app.register(authRoutes);
  await app.register(connectionRoutes);
  await app.register(feedRoutes);
  await app.register(postRoutes);
  await app.register(dashboardRoutes);

  return app;
}
