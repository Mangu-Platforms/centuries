import crypto from "node:crypto";
import { prisma } from "../db.js";

// Single-use, hashed tokens backing password reset and email verification
// (Phase B2) — same hashing rationale as lib/refreshTokens.ts: these are
// high-entropy random values, not user-chosen secrets, so SHA-256 (not
// bcrypt) is the right tool.

const TOKEN_BYTES = 32;

export type VerificationPurpose = "password_reset" | "email_verify";

const TTL_MS: Record<VerificationPurpose, number> = {
  password_reset: 30 * 60 * 1000, // 30 minutes — short-lived, security-sensitive
  email_verify: 24 * 60 * 60 * 1000, // 24 hours — low stakes, generous window
};

function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export interface IssuedVerificationToken {
  rawToken: string;
  expiresAt: Date;
}

export async function issueVerificationToken(
  userId: string,
  purpose: VerificationPurpose,
): Promise<IssuedVerificationToken> {
  const rawToken = crypto.randomBytes(TOKEN_BYTES).toString("hex");
  const expiresAt = new Date(Date.now() + TTL_MS[purpose]);
  await prisma.verificationToken.create({
    data: { userId, purpose, tokenHash: hashToken(rawToken), expiresAt },
  });
  return { rawToken, expiresAt };
}

export type ConsumeOutcome = { status: "ok"; userId: string } | { status: "invalid" | "expired" | "used" };

/**
 * Validates a presented raw token for the given purpose and, if valid,
 * marks it used (single-use — a second presentation of the same token
 * always fails, whether or not the first consumption succeeded).
 */
export async function consumeVerificationToken(
  rawToken: string,
  purpose: VerificationPurpose,
): Promise<ConsumeOutcome> {
  const tokenHash = hashToken(rawToken);
  const existing = await prisma.verificationToken.findUnique({ where: { tokenHash } });
  if (!existing || existing.purpose !== purpose) return { status: "invalid" };
  if (existing.usedAt) return { status: "used" };
  if (existing.expiresAt.getTime() < Date.now()) return { status: "expired" };

  await prisma.verificationToken.update({ where: { id: existing.id }, data: { usedAt: new Date() } });
  return { status: "ok", userId: existing.userId };
}
