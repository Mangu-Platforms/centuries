import crypto from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { prisma } from "../db.js";

function uniqueEmail(): string {
  return `auth-lockout-test-${crypto.randomUUID()}@nexus.app`;
}

describe("Phase B3: rate limiting + account lockout", () => {
  afterEach(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: "auth-lockout-test-" } } });
  });

  it("locks the account after 5 failed login attempts, even with the correct password", async () => {
    const app = await buildApp();
    const email = uniqueEmail();
    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email, password: "password123", displayName: "Lockout Test" },
    });

    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email, password: "wrong-password" },
      });
      expect(res.statusCode).toBe(401);
    }

    // 6th attempt, this time with the CORRECT password — must still be
    // rejected, because the account is now locked regardless of credentials.
    const lockedRes = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password: "password123" },
    });
    expect(lockedRes.statusCode).toBe(423);
    expect(lockedRes.json().retryAfterSeconds).toBeGreaterThan(0);

    await app.close();
  });

  it("does not lock the account if a correct login happens before the threshold", async () => {
    const app = await buildApp();
    const email = uniqueEmail();
    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email, password: "password123", displayName: "Lockout Test" },
    });

    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email, password: "wrong-password" },
      });
    }

    const okRes = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password: "password123" },
    });
    expect(okRes.statusCode).toBe(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.failedLoginAttempts).toBe(0);
    expect(user.lockedUntil).toBeNull();

    await app.close();
  });

  it("a login for a nonexistent email is a plain 401, not a 423 (no account to lock)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: uniqueEmail(), password: "password123" },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("rate-limits repeated register calls", async () => {
    const app = await buildApp();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { email: uniqueEmail(), password: "password123", displayName: "Rate Test" },
      });
      statuses.push(res.statusCode);
    }

    // 5/minute is the configured limit — the 6th call in the same window must be rejected.
    expect(statuses.slice(0, 5)).toEqual([201, 201, 201, 201, 201]);
    expect(statuses[5]).toBe(429);

    await app.close();
  });

  it("rate-limits repeated login calls", async () => {
    const app = await buildApp();
    const email = uniqueEmail();
    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email, password: "password123", displayName: "Rate Test" },
    });

    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email, password: "wrong-password" },
      });
      statuses.push(res.statusCode);
    }

    // 10/minute is the configured limit — the 11th call in the same window must be rejected.
    // (The account also locks partway through this sequence, at attempt 5 — that's fine, the
    // rate limiter runs as a preHandler ahead of the lockout check either way.)
    expect(statuses[10]).toBe(429);

    await app.close();
  });

  it("rate-limits repeated refresh calls", async () => {
    const app = await buildApp();
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/refresh",
        cookies: { nexus_refresh: "not-a-real-token" },
      });
      statuses.push(res.statusCode);
    }

    // 20/minute is the configured limit — the 21st call in the same window must be rejected.
    expect(statuses.slice(0, 20).every((s) => s === 401)).toBe(true);
    expect(statuses[20]).toBe(429);

    await app.close();
  });
});
