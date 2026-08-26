import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { disconnect } from "../db.js";

afterAll(async () => {
  await disconnect();
});

describe("API surface: health, readiness, request id, error shape", () => {
  it("GET /health responds cheaply without touching the DB", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok" });
    await app.close();
  });

  it("GET /ready checks the DB and reports ready", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ready" });
    await app.close();
  });

  it("attaches a request id to every response", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.headers["x-request-id"]).toBeTruthy();
    await app.close();
  });

  it("returns a structured { error, code, requestId } shape for unknown routes", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/does-not-exist" });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body).toMatchObject({ error: "Not found", code: "NOT_FOUND" });
    expect(typeof body.requestId).toBe("string");
    expect(body.requestId.length).toBeGreaterThan(0);
    await app.close();
  });

  it("returns a structured error shape for malformed JSON bodies", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      payload: "{not valid json",
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body).toHaveProperty("error");
    expect(body).toHaveProperty("code");
    expect(body).toHaveProperty("requestId");
    await app.close();
  });
});
