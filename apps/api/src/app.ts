import crypto from "node:crypto";
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { config, PLATFORMS } from "./config.js";
import { prisma } from "./db.js";
import { reportError } from "./lib/errorReporting.js";
import { recordRequest, renderMetrics } from "./lib/metrics.js";
import { registerAuth } from "./plugins/auth.js";
import { authRoutes } from "./routes/auth.js";
import { accountRecoveryRoutes } from "./routes/accountRecovery.js";
import { sessionRoutes } from "./routes/sessions.js";
import { connectionRoutes } from "./routes/connections.js";
import { mastodonAuthRoutes } from "./routes/mastodonAuth.js";
import { feedRoutes } from "./routes/feed.js";
import { postRoutes } from "./routes/posts.js";
import { mediaRoutes } from "./routes/media.js";
import { internalRoutes } from "./routes/internal.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { analyticsRoutes } from "./routes/analytics.js";
// Side-effect imports: register each live connector with the connector
// registry (see connectors/registry.ts). Each live connector as it's
// implemented (Phase C) gets one line like this — this is the single place
// that wires "live connectors exist" into a running app.
import "./connectors/bluesky.js";
import "./connectors/mastodon.js";

/** Structured API error shape returned by the global error/not-found handlers. */
interface ApiErrorBody {
  error: string;
  code: string;
  requestId: string;
  details?: unknown;
}

export async function buildApp(): Promise<FastifyInstance> {
  // Defense in depth: nothing in this codebase currently logs a header or a
  // request body (Fastify's default request/response logs are limited to
  // method/url/host/remoteAddress/statusCode), so this redaction never
  // actually fires today -- it guards against a future log call (a debug
  // line, a new plugin) accidentally leaking a credential, rather than a
  // known current leak.
  const redact = {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.password",
      "*.currentPassword",
      "*.newPassword",
      "*.appPassword",
      "*.token",
      "*.accessToken",
      "*.refreshToken",
    ],
    censor: "[redacted]",
  };

  const app = Fastify({
    logger: config.isProd
      ? { redact }
      : {
          redact,
          transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } },
        },
    genReqId: () => crypto.randomUUID(),
  });

  app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header("x-request-id", request.id);
  });

  // Phase G3: lightweight in-process request metrics (no prom-client
  // dependency -- see lib/metrics.ts for why). request.routeOptions.url is
  // the registered route *pattern* (e.g. "/api/posts/:id"), not the literal
  // requested URL, so this can't blow up into unbounded label cardinality
  // from real path params or garbage 404 paths.
  app.addHook("onResponse", async (request: FastifyRequest, reply: FastifyReply) => {
    const route = request.routeOptions.url ?? "unmatched";
    recordRequest(request.method, route, reply.statusCode, reply.elapsedTime);
  });

  await app.register(cors, { origin: config.corsOrigin, credentials: true });
  // Phase G4: baseline security headers (CSP, X-Content-Type-Options,
  // X-Frame-Options, etc). crossOriginResourcePolicy is overridden from
  // helmet's "same-origin" default to "cross-origin" -- GET /uploads/:key
  // (routes/media.ts) is deliberately fetched cross-origin, directly as
  // <img src>, by the separately-hosted web app; "same-origin" would have
  // browsers silently refuse to load every uploaded image.
  await app.register(helmet, { crossOriginResourcePolicy: { policy: "cross-origin" } });
  // No `secret` option: the refresh token cookie's value is itself a
  // high-entropy opaque random token (see lib/refreshTokens.ts), so it
  // doesn't need an additional signature — unlike a cookie that stored
  // readable/guessable data.
  await app.register(cookie);
  // global: false — this doesn't rate-limit every route by default, it only
  // makes the `app.rateLimit(...)` preHandler decorator available for
  // routes that opt in explicitly (see routes/mastodonAuth.ts). Blanket
  // rate limiting across every route is Phase B3's job.
  await app.register(rateLimit, { global: false });
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
      reportError(request.log, err, {
        requestId: request.id,
        method: request.method,
        url: request.url,
        statusCode,
      });
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
  app.get("/metrics", async (_request, reply) => {
    reply.header("content-type", "text/plain; version=0.0.4; charset=utf-8");
    return renderMetrics();
  });

  await app.register(authRoutes);
  await app.register(accountRecoveryRoutes);
  await app.register(sessionRoutes);
  await app.register(connectionRoutes);
  await app.register(mastodonAuthRoutes);
  await app.register(feedRoutes);
  await app.register(postRoutes);
  await app.register(mediaRoutes);
  await app.register(internalRoutes);
  await app.register(dashboardRoutes);
  await app.register(analyticsRoutes);

  return app;
}
