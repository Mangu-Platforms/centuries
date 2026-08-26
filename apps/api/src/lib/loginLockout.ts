import { prisma } from "../db.js";

// Account lockout (Phase B3): defends against a brute-force password guess
// spread across many requests, which per-IP rate limiting alone doesn't
// stop (a distributed attacker just uses many IPs against one account).
// Per-IP rate limiting on the route (see routes/auth.ts) still bounds a
// single-IP attacker's request rate; this bounds total guesses against one
// account regardless of source.
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

export interface LockoutStatus {
  locked: boolean;
  retryAfterSeconds?: number;
}

/** Checks whether an account is currently locked out. Does not mutate state. */
export function checkLockout(user: { lockedUntil: Date | null }): LockoutStatus {
  if (!user.lockedUntil || user.lockedUntil.getTime() <= Date.now()) {
    return { locked: false };
  }
  return {
    locked: true,
    retryAfterSeconds: Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000),
  };
}

/**
 * Records a failed login attempt, locking the account once
 * MAX_FAILED_ATTEMPTS is reached. Called only after a lockout check has
 * already confirmed the account isn't currently locked.
 */
export async function recordFailedLogin(userId: string): Promise<void> {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { failedLoginAttempts: { increment: 1 } },
    select: { failedLoginAttempts: true },
  });
  if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
    await prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: 0, lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS) },
    });
  }
}

/** Clears any lockout state after a successful login. */
export async function clearLockout(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { failedLoginAttempts: 0, lockedUntil: null },
  });
}
