import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { sendEmail } from "../lib/email.js";
import { consumeVerificationToken, issueVerificationToken } from "../lib/verificationTokens.js";
import { revokeAllForUser } from "../lib/refreshTokens.js";
import { clearLockout } from "../lib/loginLockout.js";

// Phase B2: password reset + email verification. Both flows share the same
// hashed single-use token machinery (lib/verificationTokens.ts) and the
// same "console transport in dev" email provider (lib/email.ts).

const requestResetSchema = z.object({ email: z.string().email() });
const confirmResetSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

function resetLink(rawToken: string): string {
  const url = new URL("/reset-password", config.webAppUrl);
  url.searchParams.set("token", rawToken);
  return url.toString();
}

function verifyEmailLink(rawToken: string): string {
  const url = new URL("/api/auth/email/verify", config.apiPublicUrl);
  url.searchParams.set("token", rawToken);
  return url.toString();
}

function settingsUrl(query: Record<string, string>): string {
  const url = new URL("/dashboard/settings", config.webAppUrl);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url.toString();
}

export async function accountRecoveryRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/auth/password-reset/request",
    // Rate-limited, not authenticated — this is the entry point an
    // attacker would use to enumerate emails or spam a victim's inbox.
    { preHandler: [app.rateLimit({ max: 5, timeWindow: "1 minute" })] },
    async (request, reply) => {
      const parsed = requestResetSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message });

      const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
      // Always respond the same way regardless of whether the email is
      // registered — a different response would let an attacker enumerate
      // accounts by email address.
      if (user) {
        const { rawToken } = await issueVerificationToken(user.id, "password_reset");
        await sendEmail({
          to: user.email,
          subject: "Reset your NEXUS password",
          text: `Someone requested a password reset for this account. If this was you, reset your password here (link expires in 30 minutes):\n\n${resetLink(rawToken)}\n\nIf you didn't request this, you can ignore this email.`,
        });
      }
      return reply.send({ ok: true });
    },
  );

  app.post(
    "/api/auth/password-reset/confirm",
    { preHandler: [app.rateLimit({ max: 10, timeWindow: "1 minute" })] },
    async (request, reply) => {
      const parsed = confirmResetSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message });

      const outcome = await consumeVerificationToken(parsed.data.token, "password_reset");
      if (outcome.status !== "ok") {
        return reply.code(400).send({ error: "This password reset link is invalid or has expired" });
      }

      const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12); // BRD NF16: bcrypt cost 12
      await prisma.user.update({ where: { id: outcome.userId }, data: { passwordHash } });
      // A password change invalidates every existing session — a stolen
      // refresh token from before the reset must stop working — and clears
      // any lockout, since the credential that caused it no longer exists.
      await revokeAllForUser(outcome.userId);
      await clearLockout(outcome.userId);

      return reply.send({ ok: true });
    },
  );

  app.post(
    "/api/auth/email/verify/request",
    { preHandler: [app.rateLimit({ max: 5, timeWindow: "1 minute" }), app.authenticate] },
    async (request, reply) => {
      const user = await prisma.user.findUnique({ where: { id: request.user.sub } });
      if (!user) return reply.code(404).send({ error: "User not found" });
      if (user.emailVerifiedAt) return reply.send({ ok: true, alreadyVerified: true });

      const { rawToken } = await issueVerificationToken(user.id, "email_verify");
      await sendEmail({
        to: user.email,
        subject: "Verify your NEXUS email address",
        text: `Confirm this is your email address (link expires in 24 hours):\n\n${verifyEmailLink(rawToken)}`,
      });
      return reply.send({ ok: true });
    },
  );

  // No app.authenticate: this is a link clicked directly from an email, so
  // it can't carry an Authorization header — same reasoning as the
  // Mastodon OAuth callback (routes/mastodonAuth.ts). The token itself is
  // the only credential this route trusts.
  app.get(
    "/api/auth/email/verify",
    { preHandler: [app.rateLimit({ max: 10, timeWindow: "1 minute" })] },
    async (request, reply) => {
      const query = request.query as { token?: string };
      if (!query.token) {
        return reply.redirect(settingsUrl({ emailVerifyError: "Missing verification token" }));
      }

      const outcome = await consumeVerificationToken(query.token, "email_verify");
      if (outcome.status !== "ok") {
        return reply.redirect(settingsUrl({ emailVerifyError: "This verification link is invalid or has expired" }));
      }

      await prisma.user.update({ where: { id: outcome.userId }, data: { emailVerifiedAt: new Date() } });
      return reply.redirect(settingsUrl({ emailVerified: "1" }));
    },
  );
}
