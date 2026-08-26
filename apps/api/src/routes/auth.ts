import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db.js";
import { config } from "../config.js";
import {
  findActiveSessionIdByRawToken,
  issueRefreshToken,
  revokeAllForUserExcept,
  revokeRefreshToken,
  rotateRefreshToken,
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
} from "../lib/refreshTokens.js";
import { checkLockout, clearLockout, recordFailedLogin } from "../lib/loginLockout.js";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  displayName: z.string().min(1).max(60),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

// Access tokens are short-lived JWTs (Phase B1): the long-lived credential
// is now the refresh token below, kept out of JS entirely (httpOnly
// cookie) so an XSS bug can only steal a token that expires in minutes,
// not one valid for days.
const ACCESS_TOKEN_TTL = "15m";
// Matches lib/refreshTokens.ts's own TTL — kept as a separate constant
// here since the cookie's Max-Age and the token's server-side expiry are
// conceptually different settings that happen to need the same value.
const REFRESH_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: config.isProd,
    // Production is cross-origin by design (Vercel web + Railway API, per
    // DEPLOY.md), which requires SameSite=None — and browsers require
    // Secure whenever SameSite=None is set. Local dev has no HTTPS, so it
    // uses Lax instead; that still works because same-site cookie rules
    // only look at the registrable domain, not the port, and the web/API
    // dev servers are both on localhost.
    sameSite: config.isProd ? ("none" as const) : ("lax" as const),
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS,
  };
}

function requestMeta(request: FastifyRequest): { userAgent: string; ipAddress: string } {
  const userAgent = request.headers["user-agent"];
  return { userAgent: typeof userAgent === "string" ? userAgent : "", ipAddress: request.ip };
}

function publicUser(u: {
  id: string;
  email: string;
  displayName: string;
  bio: string;
  avatarUrl: string;
  theme: string;
  emailVerifiedAt: Date | null;
}) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    bio: u.bio,
    avatarUrl: u.avatarUrl,
    theme: u.theme,
    emailVerifiedAt: u.emailVerifiedAt ? u.emailVerifiedAt.toISOString() : null,
  };
}

/** Issues a fresh access token + refresh token pair for a just-authenticated user. */
async function issueSession(
  user: { id: string; email: string },
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<string> {
  const accessToken = await reply.jwtSign({ sub: user.id, email: user.email }, { expiresIn: ACCESS_TOKEN_TTL });
  const { rawToken } = await issueRefreshToken(user.id, requestMeta(request));
  reply.setCookie(REFRESH_COOKIE_NAME, rawToken, refreshCookieOptions());
  return accessToken;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/auth/register",
    // Prevents spamming account creation from a single source.
    { preHandler: [app.rateLimit({ max: 5, timeWindow: "1 minute" })] },
    async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0].message });
    }
    const { email, password, displayName } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return reply.code(409).send({ error: "An account with that email already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 12); // BRD NF16: bcrypt cost 12
    const user = await prisma.user.create({
      data: { email, passwordHash, displayName },
    });

    const token = await issueSession(user, request, reply);
    return reply.code(201).send({ token, user: publicUser(user) });
    },
  );

  app.post(
    "/api/auth/login",
    // Rate-limited per IP to slow a single-source brute force; the account
    // lockout below (per-user, not per-IP) is what actually bounds total
    // guesses against one account regardless of how many IPs an attacker
    // spreads across.
    { preHandler: [app.rateLimit({ max: 10, timeWindow: "1 minute" })] },
    async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid email or password" });
    }
    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return reply.code(401).send({ error: "Invalid email or password" });
    }

    const lockout = checkLockout(user);
    if (lockout.locked) {
      return reply.code(423).send({
        error: "Too many failed login attempts. Please try again later.",
        retryAfterSeconds: lockout.retryAfterSeconds,
      });
    }

    if (!(await bcrypt.compare(password, user.passwordHash))) {
      await recordFailedLogin(user.id);
      return reply.code(401).send({ error: "Invalid email or password" });
    }

    await clearLockout(user.id);
    const token = await issueSession(user, request, reply);
    return reply.send({ token, user: publicUser(user) });
    },
  );

  // Silently exchanges the httpOnly refresh cookie for a new access token,
  // rotating the refresh token in the process (see lib/refreshTokens.ts).
  app.post(
    "/api/auth/refresh",
    // Generous relative to register/login: legitimate use fires this on
    // every 401 across possibly several open tabs, so it needs headroom
    // beyond a login-brute-force budget while still bounding abuse.
    { preHandler: [app.rateLimit({ max: 20, timeWindow: "1 minute" })] },
    async (request, reply) => {
    const rawToken = request.cookies[REFRESH_COOKIE_NAME];
    if (!rawToken) return reply.code(401).send({ error: "No refresh token" });

    const outcome = await rotateRefreshToken(rawToken, requestMeta(request));
    if (outcome.status !== "ok") {
      reply.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
      const message =
        outcome.status === "reused"
          ? "Refresh token already used — all sessions for this account have been signed out"
          : outcome.status === "expired"
            ? "Refresh token expired, please log in again"
            : "Invalid refresh token";
      return reply.code(401).send({ error: message });
    }

    const user = await prisma.user.findUnique({ where: { id: outcome.userId } });
    if (!user) {
      reply.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
      return reply.code(401).send({ error: "User not found" });
    }

    const accessToken = await reply.jwtSign({ sub: user.id, email: user.email }, { expiresIn: ACCESS_TOKEN_TTL });
    reply.setCookie(REFRESH_COOKIE_NAME, outcome.issued.rawToken, refreshCookieOptions());
    return reply.send({ token: accessToken, user: publicUser(user) });
    },
  );

  // Not behind app.authenticate on purpose: a user with an already-expired
  // access token must still be able to end their session. It only ever
  // acts on the refresh cookie's own token, never on someone else's.
  app.post("/api/auth/logout", async (request, reply) => {
    const rawToken = request.cookies[REFRESH_COOKIE_NAME];
    if (rawToken) await revokeRefreshToken(rawToken);
    reply.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
    return reply.send({ ok: true });
  });

  app.get("/api/auth/me", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.user.sub } });
    if (!user) return reply.code(404).send({ error: "User not found" });
    return reply.send({ user: publicUser(user) });
  });

  app.post(
    "/api/auth/change-password",
    { preHandler: [app.rateLimit({ max: 10, timeWindow: "1 minute" }), app.authenticate] },
    async (request, reply) => {
      const parsed = changePasswordSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message });

      const user = await prisma.user.findUnique({ where: { id: request.user.sub } });
      if (!user) return reply.code(404).send({ error: "User not found" });

      if (!(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash))) {
        return reply.code(401).send({ error: "Current password is incorrect" });
      }

      const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12); // BRD NF16: bcrypt cost 12
      await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

      // Keep the session making this request alive (the user just proved
      // they control it by entering the current password), but sign every
      // other session out — same reasoning as a B2 password reset: a
      // credential change should invalidate sessions the user didn't just
      // re-prove control of.
      const rawToken = request.cookies[REFRESH_COOKIE_NAME];
      const currentSessionId = rawToken ? await findActiveSessionIdByRawToken(rawToken) : null;
      await revokeAllForUserExcept(user.id, currentSessionId);

      return reply.send({ ok: true });
    },
  );

  app.patch("/api/auth/me", { preHandler: [app.authenticate] }, async (request, reply) => {
    const schema = z.object({
      displayName: z.string().min(1).max(60).optional(),
      bio: z.string().max(280).optional(),
      theme: z.enum(["light", "dark"]).optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message });

    const user = await prisma.user.update({
      where: { id: request.user.sub },
      data: parsed.data,
    });
    return reply.send({ user: publicUser(user) });
  });
}
