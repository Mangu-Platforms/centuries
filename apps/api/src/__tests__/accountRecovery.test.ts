import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { prisma } from "../db.js";
import { setEmailProvider, type EmailMessage } from "../lib/email.js";

function uniqueEmail(): string {
  return `account-recovery-test-${crypto.randomUUID()}@nexus.app`;
}

// Captures every email "sent" during a test instead of actually sending
// one, and lets tests pull the raw token out of the link in the body —
// the console transport is real, but assertion needs the structured data.
let sentEmails: EmailMessage[] = [];

function extractToken(text: string): string {
  const match = text.match(/[?&]token=([0-9a-f]+)/);
  if (!match) throw new Error(`No token found in email body: ${text}`);
  return match[1];
}

beforeEach(() => {
  sentEmails = [];
  setEmailProvider({
    async send(message) {
      sentEmails.push(message);
    },
  });
});

describe("Phase B2: password reset", () => {
  afterEach(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: "account-recovery-test-" } } });
  });

  it("requesting a reset for a real email sends a token and resets the password end-to-end", async () => {
    const app = await buildApp();
    const email = uniqueEmail();
    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email, password: "old-password1", displayName: "Reset Test" },
    });

    const requestRes = await app.inject({
      method: "POST",
      url: "/api/auth/password-reset/request",
      payload: { email },
    });
    expect(requestRes.statusCode).toBe(200);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe(email);
    const token = extractToken(sentEmails[0].text);

    const confirmRes = await app.inject({
      method: "POST",
      url: "/api/auth/password-reset/confirm",
      payload: { token, newPassword: "new-password1" },
    });
    expect(confirmRes.statusCode).toBe(200);

    const oldLoginRes = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password: "old-password1" },
    });
    expect(oldLoginRes.statusCode).toBe(401);

    const newLoginRes = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password: "new-password1" },
    });
    expect(newLoginRes.statusCode).toBe(200);

    await app.close();
  });

  it("requesting a reset for an unregistered email still returns 200 and sends nothing (no enumeration)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/password-reset/request",
      payload: { email: uniqueEmail() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(sentEmails).toHaveLength(0);
    await app.close();
  });

  it("rejects an invalid token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/password-reset/confirm",
      payload: { token: "not-a-real-token", newPassword: "new-password1" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("rejects reuse of an already-consumed reset token", async () => {
    const app = await buildApp();
    const email = uniqueEmail();
    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email, password: "old-password1", displayName: "Reset Test" },
    });
    await app.inject({ method: "POST", url: "/api/auth/password-reset/request", payload: { email } });
    const token = extractToken(sentEmails[0].text);

    const first = await app.inject({
      method: "POST",
      url: "/api/auth/password-reset/confirm",
      payload: { token, newPassword: "new-password1" },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "POST",
      url: "/api/auth/password-reset/confirm",
      payload: { token, newPassword: "another-password1" },
    });
    expect(second.statusCode).toBe(400);

    await app.close();
  });

  it("a successful reset revokes existing sessions and clears any lockout", async () => {
    const app = await buildApp();
    const email = uniqueEmail();
    const registerRes = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email, password: "old-password1", displayName: "Reset Test" },
    });
    const refreshCookie = registerRes.cookies.find((c) => c.name === "nexus_refresh")!;

    // Rack up some failed logins (not enough to auto-lock) so there's
    // lockout state to verify gets cleared too.
    await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "wrong" } });
    await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "wrong" } });

    await app.inject({ method: "POST", url: "/api/auth/password-reset/request", payload: { email } });
    const token = extractToken(sentEmails[0].text);
    await app.inject({
      method: "POST",
      url: "/api/auth/password-reset/confirm",
      payload: { token, newPassword: "new-password1" },
    });

    const refreshAfterReset = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { nexus_refresh: refreshCookie.value },
    });
    expect(refreshAfterReset.statusCode).toBe(401);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.failedLoginAttempts).toBe(0);
    expect(user.lockedUntil).toBeNull();

    await app.close();
  });

  it("rate-limits repeated reset-request calls", async () => {
    const app = await buildApp();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/password-reset/request",
        payload: { email: uniqueEmail() },
      });
      statuses.push(res.statusCode);
    }
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);
    await app.close();
  });
});

describe("Phase B2: email verification", () => {
  afterEach(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: "account-recovery-test-" } } });
  });

  it("requesting verification, then visiting the link, marks the account verified", async () => {
    const app = await buildApp();
    const email = uniqueEmail();
    const registerRes = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email, password: "password123", displayName: "Verify Test" },
    });
    const { token: accessToken } = registerRes.json();
    expect(registerRes.json().user.emailVerifiedAt).toBeNull();

    const requestRes = await app.inject({
      method: "POST",
      url: "/api/auth/email/verify/request",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(requestRes.statusCode).toBe(200);
    expect(requestRes.json()).toEqual({ ok: true });
    const verifyToken = extractToken(sentEmails[0].text);

    const clickRes = await app.inject({ method: "GET", url: `/api/auth/email/verify?token=${verifyToken}` });
    expect(clickRes.statusCode).toBe(302);
    expect(clickRes.headers.location).toContain("emailVerified=1");

    const meRes = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(meRes.json().user.emailVerifiedAt).not.toBeNull();

    await app.close();
  });

  it("requesting verification when already verified is a no-op, sends nothing", async () => {
    const app = await buildApp();
    const email = uniqueEmail();
    const registerRes = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email, password: "password123", displayName: "Verify Test" },
    });
    const { token: accessToken, user } = registerRes.json();
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/email/verify/request",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, alreadyVerified: true });
    expect(sentEmails).toHaveLength(0);

    await app.close();
  });

  it("requires authentication to request verification", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/auth/email/verify/request" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("an invalid or missing token redirects with an error, not a 500", async () => {
    const app = await buildApp();
    const missing = await app.inject({ method: "GET", url: "/api/auth/email/verify" });
    expect(missing.statusCode).toBe(302);
    expect(missing.headers.location).toContain("emailVerifyError=");

    const invalid = await app.inject({ method: "GET", url: "/api/auth/email/verify?token=garbage" });
    expect(invalid.statusCode).toBe(302);
    expect(invalid.headers.location).toContain("emailVerifyError=");

    await app.close();
  });

  it("a password-reset token cannot be replayed against the email-verify endpoint", async () => {
    const app = await buildApp();
    const email = uniqueEmail();
    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email, password: "password123", displayName: "Verify Test" },
    });
    await app.inject({ method: "POST", url: "/api/auth/password-reset/request", payload: { email } });
    const resetToken = extractToken(sentEmails[0].text);

    const res = await app.inject({ method: "GET", url: `/api/auth/email/verify?token=${resetToken}` });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain("emailVerifyError=");

    await app.close();
  });
});
