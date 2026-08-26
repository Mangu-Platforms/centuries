import crypto from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { prisma } from "../db.js";
import { REFRESH_COOKIE_NAME } from "../lib/refreshTokens.js";

function decodeJwtPayload(token: string): { exp: number; iat: number } {
  const [, payloadB64] = token.split(".");
  return JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
}

async function registerAndGetCookie(app: Awaited<ReturnType<typeof buildApp>>) {
  const email = `refresh-test-${crypto.randomUUID()}@nexus.app`;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, password: "password123", displayName: "Refresh Test" },
  });
  const refreshCookie = res.cookies.find((c) => c.name === REFRESH_COOKIE_NAME);
  return { body: res.json(), refreshCookie, userId: res.json().user.id as string, email };
}

describe("Phase B1: rotating refresh tokens", () => {
  afterEach(async () => {
    // Best-effort cleanup: tests create their own users and rely on
    // onDelete: Cascade to clean up RefreshToken rows with them.
    await prisma.user.deleteMany({ where: { email: { contains: "refresh-test-" } } });
  });

  it("register sets a well-formed httpOnly refresh cookie and a short-lived access token", async () => {
    const app = await buildApp();
    const { body, refreshCookie } = await registerAndGetCookie(app);

    expect(refreshCookie).toBeTruthy();
    expect(refreshCookie!.httpOnly).toBe(true);
    expect(refreshCookie!.path).toBe("/api/auth");
    // Not config.isProd in tests, so sameSite should be Lax, not None.
    expect(String(refreshCookie!.sameSite).toLowerCase()).toBe("lax");
    expect(refreshCookie!.value).toMatch(/^[0-9a-f]{64}$/); // 32 random bytes, hex

    const payload = decodeJwtPayload(body.token);
    const ttlSeconds = payload.exp - payload.iat;
    expect(ttlSeconds).toBe(15 * 60);

    await app.close();
  });

  it("login also sets a refresh cookie", async () => {
    const app = await buildApp();
    const { email } = await registerAndGetCookie(app);

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password: "password123" },
    });
    expect(res.cookies.find((c) => c.name === REFRESH_COOKIE_NAME)).toBeTruthy();
    await app.close();
  });

  it("refresh issues a new access token and rotates the cookie to a new value", async () => {
    const app = await buildApp();
    const { refreshCookie } = await registerAndGetCookie(app);

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { [REFRESH_COOKIE_NAME]: refreshCookie!.value },
    });
    expect(res.statusCode).toBe(200);
    const newCookie = res.cookies.find((c) => c.name === REFRESH_COOKIE_NAME);
    expect(newCookie).toBeTruthy();
    expect(newCookie!.value).not.toBe(refreshCookie!.value);

    await app.close();
  });

  it("the new access token from refresh actually works on a protected route", async () => {
    const app = await buildApp();
    const { refreshCookie } = await registerAndGetCookie(app);

    const refreshRes = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { [REFRESH_COOKIE_NAME]: refreshCookie!.value },
    });
    const { token } = refreshRes.json();

    const meRes = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(meRes.statusCode).toBe(200);
    await app.close();
  });

  it("rejects refresh with no cookie", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/auth/refresh" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toMatch(/no refresh token/i);
    await app.close();
  });

  it("rejects refresh with a garbage cookie value", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { [REFRESH_COOKIE_NAME]: "not-a-real-token" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toMatch(/invalid/i);
    await app.close();
  });

  it("rejects a refresh token that has expired", async () => {
    const app = await buildApp();
    const { refreshCookie, userId } = await registerAndGetCookie(app);

    // Force this token's expiry into the past directly in the DB — the
    // library only ever hands back raw tokens through issue/rotate, so
    // this is the one legitimate way to construct an expired-but-known
    // raw token for a test.
    const tokenHash = crypto.createHash("sha256").update(refreshCookie!.value).digest("hex");
    await prisma.refreshToken.update({
      where: { tokenHash },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await prisma.refreshToken.count({ where: { userId } })).toBe(1);

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { [REFRESH_COOKIE_NAME]: refreshCookie!.value },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toMatch(/expired/i);

    await app.close();
  });

  it("rejects reuse of an already-rotated token and revokes the user's other sessions too", async () => {
    const app = await buildApp();
    const { refreshCookie: sessionAOriginal, email } = await registerAndGetCookie(app);

    // A second, independent login for the same account (e.g. a second device).
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password: "password123" },
    });
    const sessionB = loginRes.cookies.find((c) => c.name === REFRESH_COOKIE_NAME)!;

    // Rotate session A normally once — this is the expected, legitimate use.
    const firstRotate = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { [REFRESH_COOKIE_NAME]: sessionAOriginal!.value },
    });
    expect(firstRotate.statusCode).toBe(200);

    // Now replay the ORIGINAL session-A token (already rotated away) — a
    // stolen-cookie scenario.
    const replay = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { [REFRESH_COOKIE_NAME]: sessionAOriginal!.value },
    });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error).toMatch(/already used/i);

    // Session B, which never did anything wrong, must be revoked too —
    // reuse of any token for this user is treated as possible compromise.
    const sessionBRefresh = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { [REFRESH_COOKIE_NAME]: sessionB.value },
    });
    expect(sessionBRefresh.statusCode).toBe(401);

    await app.close();
  });

  it("logout revokes the refresh token so it can no longer be used", async () => {
    const app = await buildApp();
    const { refreshCookie } = await registerAndGetCookie(app);

    const logoutRes = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      cookies: { [REFRESH_COOKIE_NAME]: refreshCookie!.value },
    });
    expect(logoutRes.statusCode).toBe(200);
    const clearedCookie = logoutRes.cookies.find((c) => c.name === REFRESH_COOKIE_NAME);
    expect(clearedCookie?.value).toBe(""); // clearCookie sets an empty value

    const refreshAfterLogout = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { [REFRESH_COOKIE_NAME]: refreshCookie!.value },
    });
    expect(refreshAfterLogout.statusCode).toBe(401);

    await app.close();
  });

  it("logout without a cookie is a harmless no-op, not an error", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/auth/logout" });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
