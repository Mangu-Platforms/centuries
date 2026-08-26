import crypto from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { prisma } from "../db.js";
import { REFRESH_COOKIE_NAME } from "../lib/refreshTokens.js";

function uniqueEmail(): string {
  return `sessions-test-${crypto.randomUUID()}@nexus.app`;
}

async function registerAndGetCookie(app: Awaited<ReturnType<typeof buildApp>>, email: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, password: "password123", displayName: "Sessions Test" },
  });
  return {
    token: res.json().token as string,
    refreshCookie: res.cookies.find((c) => c.name === REFRESH_COOKIE_NAME)!.value as string,
  };
}

describe("Phase B4: session list + logout-all-others", () => {
  afterEach(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: "sessions-test-" } } });
  });

  it("lists the current session and marks it current", async () => {
    const app = await buildApp();
    const email = uniqueEmail();
    const { token, refreshCookie } = await registerAndGetCookie(app, email);

    const res = await app.inject({
      method: "GET",
      url: "/api/auth/sessions",
      headers: { authorization: `Bearer ${token}` },
      cookies: { [REFRESH_COOKIE_NAME]: refreshCookie },
    });
    expect(res.statusCode).toBe(200);
    const { sessions } = res.json();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].current).toBe(true);

    await app.close();
  });

  it("lists a session from a second login as not current", async () => {
    const app = await buildApp();
    const email = uniqueEmail();
    const { token, refreshCookie } = await registerAndGetCookie(app, email);

    // A second, independent login for the same account (e.g. a second device).
    await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "password123" } });

    const res = await app.inject({
      method: "GET",
      url: "/api/auth/sessions",
      headers: { authorization: `Bearer ${token}` },
      cookies: { [REFRESH_COOKIE_NAME]: refreshCookie },
    });
    const { sessions } = res.json();
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);

    await app.close();
  });

  it("listing without a refresh cookie still works, with nothing marked current", async () => {
    const app = await buildApp();
    const email = uniqueEmail();
    const { token } = await registerAndGetCookie(app, email);

    const res = await app.inject({
      method: "GET",
      url: "/api/auth/sessions",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const { sessions } = res.json();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].current).toBe(false);

    await app.close();
  });

  it("revokes one specific session by id, which then can no longer refresh", async () => {
    const app = await buildApp();
    const email = uniqueEmail();
    const { token, refreshCookie } = await registerAndGetCookie(app, email);
    const loginRes = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "password123" } });
    const secondCookie = loginRes.cookies.find((c) => c.name === REFRESH_COOKIE_NAME)!.value;

    const listRes = await app.inject({
      method: "GET",
      url: "/api/auth/sessions",
      headers: { authorization: `Bearer ${token}` },
      cookies: { [REFRESH_COOKIE_NAME]: refreshCookie },
    });
    const otherSession = listRes.json().sessions.find((s: { current: boolean }) => !s.current);

    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/api/auth/sessions/${otherSession.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(deleteRes.statusCode).toBe(200);

    const refreshRes = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { [REFRESH_COOKIE_NAME]: secondCookie },
    });
    expect(refreshRes.statusCode).toBe(401);

    await app.close();
  });

  it("revoking one device's session does not cascade into revoking the others when that device later tries to refresh", async () => {
    const app = await buildApp();
    const email = uniqueEmail();
    const { token, refreshCookie } = await registerAndGetCookie(app, email);
    const loginRes = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "password123" } });
    const otherCookie = loginRes.cookies.find((c) => c.name === REFRESH_COOKIE_NAME)!.value;

    const listRes = await app.inject({
      method: "GET",
      url: "/api/auth/sessions",
      headers: { authorization: `Bearer ${token}` },
      cookies: { [REFRESH_COOKIE_NAME]: refreshCookie },
    });
    const otherSession = listRes.json().sessions.find((s: { current: boolean }) => !s.current);
    await app.inject({
      method: "DELETE",
      url: `/api/auth/sessions/${otherSession.id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    // The revoked device's browser still holds its (now-stale) cookie and
    // has no way to know it was logged out remotely — it will naturally
    // try to refresh with it eventually. That must fail for that device
    // only, not nuke the session that did the revoking.
    const staleRefresh = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { [REFRESH_COOKIE_NAME]: otherCookie },
    });
    expect(staleRefresh.statusCode).toBe(401);

    const currentStillWorks = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { [REFRESH_COOKIE_NAME]: refreshCookie },
    });
    expect(currentStillWorks.statusCode).toBe(200);

    await app.close();
  });

  it("refuses to revoke a session that isn't the caller's", async () => {
    const app = await buildApp();
    const emailA = uniqueEmail();
    const emailB = uniqueEmail();
    const { token: tokenA, refreshCookie: cookieA } = await registerAndGetCookie(app, emailA);
    await registerAndGetCookie(app, emailB);

    const listA = await app.inject({
      method: "GET",
      url: "/api/auth/sessions",
      headers: { authorization: `Bearer ${tokenA}` },
      cookies: { [REFRESH_COOKIE_NAME]: cookieA },
    });
    const sessionAId = listA.json().sessions[0].id;

    // tokenA belongs to A; try to delete A's own session using B's token — should be denied.
    const registerB = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: emailB, password: "password123" },
    });
    const tokenB = registerB.json().token;

    const res = await app.inject({
      method: "DELETE",
      url: `/api/auth/sessions/${sessionAId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it("logout-all revokes every other session but keeps the current one alive", async () => {
    const app = await buildApp();
    const email = uniqueEmail();
    const { token, refreshCookie } = await registerAndGetCookie(app, email);
    const loginRes1 = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "password123" } });
    const loginRes2 = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "password123" } });
    const otherCookie1 = loginRes1.cookies.find((c) => c.name === REFRESH_COOKIE_NAME)!.value;
    const otherCookie2 = loginRes2.cookies.find((c) => c.name === REFRESH_COOKIE_NAME)!.value;

    const logoutAllRes = await app.inject({
      method: "POST",
      url: "/api/auth/sessions/logout-all",
      headers: { authorization: `Bearer ${token}` },
      cookies: { [REFRESH_COOKIE_NAME]: refreshCookie },
    });
    expect(logoutAllRes.statusCode).toBe(200);
    expect(logoutAllRes.json().revoked).toBe(2);

    const currentRefresh = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { [REFRESH_COOKIE_NAME]: refreshCookie },
    });
    expect(currentRefresh.statusCode).toBe(200);

    const otherRefresh1 = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { [REFRESH_COOKIE_NAME]: otherCookie1 },
    });
    expect(otherRefresh1.statusCode).toBe(401);

    const otherRefresh2 = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { [REFRESH_COOKIE_NAME]: otherCookie2 },
    });
    expect(otherRefresh2.statusCode).toBe(401);

    await app.close();
  });

  it("requires authentication for every sessions endpoint", async () => {
    const app = await buildApp();
    const listRes = await app.inject({ method: "GET", url: "/api/auth/sessions" });
    expect(listRes.statusCode).toBe(401);
    const deleteRes = await app.inject({ method: "DELETE", url: "/api/auth/sessions/nonexistent" });
    expect(deleteRes.statusCode).toBe(401);
    const logoutAllRes = await app.inject({ method: "POST", url: "/api/auth/sessions/logout-all" });
    expect(logoutAllRes.statusCode).toBe(401);
    await app.close();
  });
});
