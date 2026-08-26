import crypto from "node:crypto";
import { prisma } from "../db.js";

// Rotating refresh tokens (Phase B1). The access token (JWT) is short-lived
// (15 minutes); this is the long-lived credential that lets the web app
// silently obtain a new one without the user re-entering their password.
//
// The raw token is a high-entropy random value, never a user-chosen
// secret, so a fast SHA-256 hash (not bcrypt) is the right tool for
// hashing it at rest — bcrypt's slowness exists to resist brute-forcing a
// low-entropy human password, which doesn't apply here.
//
// Rotation: every refresh both issues a new token AND revokes the one
// that was presented, linking old -> new via replacedByHash. If a revoked
// token is ever presented again, that's a signal of theft (someone stole
// an old cookie value), not normal expiry — see rotateRefreshToken.

const REFRESH_TOKEN_BYTES = 32;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const REFRESH_COOKIE_NAME = "nexus_refresh";
export const REFRESH_COOKIE_PATH = "/api/auth";

function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

function generateRawToken(): string {
  return crypto.randomBytes(REFRESH_TOKEN_BYTES).toString("hex");
}

export interface IssuedRefreshToken {
  rawToken: string;
  expiresAt: Date;
}

export async function issueRefreshToken(
  userId: string,
  meta: { userAgent?: string; ipAddress?: string } = {},
): Promise<IssuedRefreshToken> {
  const rawToken = generateRawToken();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(rawToken),
      expiresAt,
      userAgent: meta.userAgent ?? "",
      ipAddress: meta.ipAddress ?? "",
    },
  });
  return { rawToken, expiresAt };
}

export type RefreshOutcome =
  | { status: "ok"; userId: string; issued: IssuedRefreshToken }
  | { status: "invalid" }
  | { status: "expired" }
  // The presented token was already rotated away — possible token theft.
  // All of the user's other refresh tokens are revoked defensively.
  | { status: "reused" };

/**
 * Validates a presented raw refresh token and, if valid, rotates it:
 * revokes the old one and issues a new one atomically-enough for SQLite's
 * single-writer model (no cross-request race window in practice here).
 */
export async function rotateRefreshToken(
  rawToken: string,
  meta: { userAgent?: string; ipAddress?: string } = {},
): Promise<RefreshOutcome> {
  const tokenHash = hashToken(rawToken);
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!existing) return { status: "invalid" };

  if (existing.revokedAt) {
    // This exact token was already used once before (or explicitly
    // revoked, e.g. by logout). Presenting it again means either a replay
    // of a stolen old cookie, or a benign double-submit race. Either way,
    // do not trust this token chain further: revoke every other active
    // token for the user so a real thief loses their session too.
    await revokeAllForUser(existing.userId);
    return { status: "reused" };
  }

  if (existing.expiresAt.getTime() < Date.now()) {
    return { status: "expired" };
  }

  const issued = await issueRefreshToken(existing.userId, meta);
  await prisma.refreshToken.update({
    where: { id: existing.id },
    data: { revokedAt: new Date(), replacedByHash: hashToken(issued.rawToken) },
  });

  return { status: "ok", userId: existing.userId, issued };
}

/** Revokes a single token (e.g. on logout). No-op if it doesn't exist or is already revoked. */
export async function revokeRefreshToken(rawToken: string): Promise<void> {
  const tokenHash = hashToken(rawToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Revokes every active refresh token for a user (e.g. logout-all, or reuse detection above). */
export async function revokeAllForUser(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
