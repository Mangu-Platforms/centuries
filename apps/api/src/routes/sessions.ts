import type { FastifyInstance } from "fastify";
import {
  findActiveSessionIdByRawToken,
  listActiveSessions,
  revokeAllForUserExcept,
  revokeSession,
  REFRESH_COOKIE_NAME,
} from "../lib/refreshTokens.js";

// Phase B4: lets a user see and manage their own active sessions — the
// per-session userAgent/ipAddress captured since B1 exists for exactly
// this. "Current" is determined by matching the request's own refresh
// cookie against the stored sessions, not by any session id the client
// sends, so a user can never spoof which row is "this device."

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/auth/sessions", { preHandler: [app.authenticate] }, async (request, reply) => {
    const rawToken = request.cookies[REFRESH_COOKIE_NAME];
    const currentSessionId = rawToken ? await findActiveSessionIdByRawToken(rawToken) : null;

    const sessions = await listActiveSessions(request.user.sub);
    return reply.send({
      sessions: sessions.map((s) => ({
        id: s.id,
        userAgent: s.userAgent,
        ipAddress: s.ipAddress,
        createdAt: s.createdAt.toISOString(),
        current: s.id === currentSessionId,
      })),
    });
  });

  app.delete("/api/auth/sessions/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const revoked = await revokeSession(request.user.sub, id);
    if (!revoked) return reply.code(404).send({ error: "Session not found" });
    return reply.send({ ok: true });
  });

  // Revokes every session except the one making this request, so the user
  // can't accidentally lock themselves out from their own device. Logging
  // out the current device too is what POST /api/auth/logout is for.
  app.post("/api/auth/sessions/logout-all", { preHandler: [app.authenticate] }, async (request, reply) => {
    const rawToken = request.cookies[REFRESH_COOKIE_NAME];
    const currentSessionId = rawToken ? await findActiveSessionIdByRawToken(rawToken) : null;
    const revoked = await revokeAllForUserExcept(request.user.sub, currentSessionId);
    return reply.send({ ok: true, revoked });
  });
}
