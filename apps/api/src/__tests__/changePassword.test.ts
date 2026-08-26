import crypto from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { prisma } from "../db.js";
import { REFRESH_COOKIE_NAME } from "../lib/refreshTokens.js";

function uniqueEmail(): string {
  return `change-password-test-${crypto.randomUUID()}@nexus.app`;
}

describe("Phase B5: change password while authenticated", () => {
  afterEach(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: "change-password-test-" } } });
  });

  it("changes the password end-to-end: old password stops working, new one works", async () => {
    const app = await buildApp();
    const email = uniqueEmail();
    const registerRes = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email, password: "old-password1", displayName: "Change Password Test" },
    });
    const { token } = registerRes.json();

    const changeRes = await app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      headers: { authorization: `Bearer ${token}` },
      payload: { currentPassword: "old-password1", newPassword: "new-password1" },
    });
    expect(changeRes.statusCode).toBe(200);

    const oldLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password: "old-password1" },
    });
    expect(oldLogin.statusCode).toBe(401);

    const newLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password: "new-password1" },
    });
    expect(newLogin.statusCode).toBe(200);

    await app.close();
  });

  it("rejects the wrong current password without changing anything", async () => {
    const app = await buildApp();
    const email = uniqueEmail();
    const registerRes = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email, password: "old-password1", displayName: "Change Password Test" },
    });
    const { token } = registerRes.json();

    const changeRes = await app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      headers: { authorization: `Bearer ${token}` },
      payload: { currentPassword: "totally-wrong", newPassword: "new-password1" },
    });
    expect(changeRes.statusCode).toBe(401);

    const stillWorks = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password: "old-password1" },
    });
    expect(stillWorks.statusCode).toBe(200);

    await app.close();
  });

  it("keeps the current session alive but revokes every other session", async () => {
    const app = await buildApp();
    const email = uniqueEmail();
    const registerRes = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email, password: "old-password1", displayName: "Change Password Test" },
    });
    const { token } = registerRes.json();
    const currentCookie = registerRes.cookies.find((c) => c.name === REFRESH_COOKIE_NAME)!.value;

    const otherLoginRes = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password: "old-password1" },
    });
    const otherCookie = otherLoginRes.cookies.find((c) => c.name === REFRESH_COOKIE_NAME)!.value;

    await app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      headers: { authorization: `Bearer ${token}` },
      cookies: { [REFRESH_COOKIE_NAME]: currentCookie },
      payload: { currentPassword: "old-password1", newPassword: "new-password1" },
    });

    const currentRefresh = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { [REFRESH_COOKIE_NAME]: currentCookie },
    });
    expect(currentRefresh.statusCode).toBe(200);

    const otherRefresh = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { [REFRESH_COOKIE_NAME]: otherCookie },
    });
    expect(otherRefresh.statusCode).toBe(401);

    await app.close();
  });

  it("requires authentication", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      payload: { currentPassword: "x", newPassword: "new-password1" },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("rejects a new password under 8 characters", async () => {
    const app = await buildApp();
    const email = uniqueEmail();
    const registerRes = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email, password: "old-password1", displayName: "Change Password Test" },
    });
    const { token } = registerRes.json();

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      headers: { authorization: `Bearer ${token}` },
      payload: { currentPassword: "old-password1", newPassword: "short" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
