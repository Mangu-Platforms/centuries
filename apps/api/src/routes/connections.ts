import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { PLATFORMS, isPlatform } from "../config.js";
import { getConnector } from "../connectors/registry.js";
import { decryptSecret, encryptSecret } from "../lib/crypto.js";
import { INTERACTIVE_RESILIENCE, resetBreaker } from "../lib/resilience.js";
import { importInitialTimeline } from "../lib/timelineImport.js";

const connectSchema = z.object({
  platform: z.string().refine(isPlatform, "Unsupported platform"),
  handle: z.string().min(1).max(120),
  instance: z.string().max(120).optional(),
  // app password (Bluesky) — encrypted before storage, never persisted or
  // logged in plaintext. OAuth platforms don't take a raw credential here;
  // their token exchange lands via a dedicated flow in a later phase.
  credential: z.string().optional(),
});

function publicConnection(c: {
  id: string;
  userId: string;
  platform: string;
  handle: string;
  displayName: string;
  instance: string;
  status: string;
  createdAt: Date;
  lastSyncedAt: Date | null;
  lastError: string;
  tokenExpiresAt: Date | null;
  scopes: string;
}) {
  // Deliberately omit accessTokenEnc / refreshTokenEnc / appPasswordEnc /
  // metadata — encrypted credential material never leaves the API.
  return {
    id: c.id,
    platform: c.platform,
    handle: c.handle,
    displayName: c.displayName,
    instance: c.instance,
    status: c.status,
    createdAt: c.createdAt,
    lastSyncedAt: c.lastSyncedAt,
    lastError: c.lastError,
    tokenExpiresAt: c.tokenExpiresAt,
    scopes: c.scopes,
  };
}

export async function connectionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/connections", { preHandler: [app.authenticate] }, async (request) => {
    const connections = await prisma.connection.findMany({
      where: { userId: request.user.sub },
      orderBy: { createdAt: "asc" },
    });
    return { connections: connections.map(publicConnection) };
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

    // Only app-password platforms accept a raw credential today (Phase C1:
    // Bluesky). OAuth platforms (twitter/threads/mastodon) get their tokens
    // from a dedicated authorization-code exchange in a later phase, so a
    // credential posted for them here is accepted (for forward client
    // compatibility) but intentionally not stored.
    const appPasswordEnc =
      PLATFORMS[platform].auth === "app_password" && credential ? encryptSecret(credential) : "";

    const connection = await prisma.connection.create({
      data: {
        userId: request.user.sub,
        platform,
        handle,
        displayName: handle,
        instance: instance ?? "",
        status: "active",
        appPasswordEnc,
      },
    });

    // Pull an initial timeline from the connector so the feed is populated.
    // hasCredentials gates live-connector use — a platform with no live
    // connector registered yet, or a connection with no stored credentials,
    // always resolves to the demo connector (Phase C fills these in one
    // platform at a time; see connectors/registry.ts).
    const hasCredentials = Boolean(connection.appPasswordEnc || connection.accessTokenEnc);
    const connector = getConnector(platform, hasCredentials, INTERACTIVE_RESILIENCE);

    const { importedPosts, warning } = await importInitialTimeline({
      userId: request.user.sub,
      connectionId: connection.id,
      platform,
      connector,
      ctx: {
        handle,
        instance,
        appPassword: connection.appPasswordEnc ? decryptSecret(connection.appPasswordEnc) : undefined,
        accessToken: connection.accessTokenEnc ? decryptSecret(connection.accessTokenEnc) : undefined,
        connectionId: connection.id,
      },
    });

    // Re-read so the response reflects what the import wrote (status,
    // lastSyncedAt, lastError — Phase C6) instead of the pre-import row.
    const fresh = await prisma.connection.findUniqueOrThrow({ where: { id: connection.id } });

    return reply.code(201).send({
      connection: publicConnection(fresh),
      importedPosts,
      ...(warning ? { warning } : {}),
    });
  });

  // Phase C6: re-validate an existing connection. For app-password platforms
  // a fresh credential may be supplied (re-encrypted before storage, same as
  // connect); OAuth platforms re-run their authorization flow instead (the
  // web sends Mastodon back through /api/connections/mastodon/register), so
  // a reconnect here without a credential simply re-runs the timeline fetch
  // with whatever the connection already has — which is also the demo-mode
  // path. Success heals status/lastError and stamps lastSyncedAt.
  app.post(
    "/api/connections/:id/reconnect",
    // Rate-limited because a reconnect carrying a candidate credential
    // triggers an outbound live login attempt against a third-party
    // platform and reports its verdict — unbounded, this route is a free
    // credential-testing oracle. Auth runs first and the bucket is keyed
    // per user: behind a reverse proxy every client shares one IP, so a
    // per-IP bucket would be a single global limit (and anonymous traffic
    // could exhaust it — here it 401s before consuming anything).
    {
      preHandler: [
        app.authenticate,
        app.rateLimit({
          max: 5,
          timeWindow: "1 minute",
          keyGenerator: (req) => (req as { user?: { sub?: string } }).user?.sub ?? req.ip,
        }),
      ],
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z.object({ credential: z.string().max(500).optional() }).safeParse(request.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message });

      const connection = await prisma.connection.findFirst({ where: { id, userId: request.user.sub } });
      if (!connection) return reply.code(404).send({ error: "Connection not found" });
      if (!isPlatform(connection.platform)) return reply.code(400).send({ error: "Unsupported platform" });
      const platform = connection.platform;

      // A user-initiated reconnect IS the half-open probe: clear any open
      // breaker so a corrected credential is never rejected unseen by the
      // fail-fast path (this route is rate-limited, so abuse stays bounded).
      resetBreaker(connection.id);

      // A candidate credential is validated by actually fetching with it
      // BEFORE it is persisted — a failed reconnect must never destroy a
      // possibly-still-valid stored credential.
      const candidate =
        PLATFORMS[platform].auth === "app_password" && parsed.data.credential ? parsed.data.credential : undefined;
      const appPassword =
        candidate ?? (connection.appPasswordEnc ? decryptSecret(connection.appPasswordEnc) : undefined);

      const hasCredentials = Boolean(appPassword || connection.accessTokenEnc);
      const connector = getConnector(platform, hasCredentials, INTERACTIVE_RESILIENCE);

      const { importedPosts, warning } = await importInitialTimeline({
        userId: request.user.sub,
        connectionId: connection.id,
        platform,
        connector,
        ctx: {
          handle: connection.handle,
          instance: connection.instance || undefined,
          appPassword,
          accessToken: connection.accessTokenEnc ? decryptSecret(connection.accessTokenEnc) : undefined,
          connectionId: connection.id,
        },
      });

      if (candidate && !warning) {
        await prisma.connection.update({
          where: { id: connection.id },
          data: { appPasswordEnc: encryptSecret(candidate) },
        });
      }

      const fresh = await prisma.connection.findUniqueOrThrow({ where: { id: connection.id } });

      return reply.send({
        connection: publicConnection(fresh),
        importedPosts,
        ...(warning ? { warning } : {}),
      });
    },
  );

  app.delete("/api/connections/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const connection = await prisma.connection.findFirst({
      where: { id, userId: request.user.sub },
    });
    if (!connection) return reply.code(404).send({ error: "Connection not found" });

    await prisma.connection.delete({ where: { id } });
    // The id never comes back — drop its breaker state so the in-process
    // Map stays bounded by live connections.
    resetBreaker(id);
    return reply.send({ ok: true });
  });
}
