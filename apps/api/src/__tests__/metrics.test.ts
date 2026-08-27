import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { disconnect } from "../db.js";
import { __resetMetricsForTests, recordRequest, renderMetrics } from "../lib/metrics.js";

afterAll(async () => {
  await disconnect();
});

describe("lib/metrics", () => {
  beforeEach(() => {
    __resetMetricsForTests();
  });

  it("renders zero counters as valid Prometheus text before any request is recorded", () => {
    const text = renderMetrics();
    expect(text).toContain("# TYPE nexus_process_uptime_seconds gauge");
    expect(text).toContain("nexus_process_uptime_seconds ");
    expect(text).not.toContain("nexus_http_requests_total{");
  });

  it("accumulates count, error count, and duration sum per method+route", () => {
    recordRequest("GET", "/api/feed", 200, 12.5);
    recordRequest("GET", "/api/feed", 200, 7.5);
    recordRequest("GET", "/api/feed", 500, 20);
    recordRequest("POST", "/api/posts", 201, 40);

    const text = renderMetrics();
    expect(text).toContain('nexus_http_requests_total{method="GET",route="/api/feed"} 3');
    expect(text).toContain('nexus_http_request_errors_total{method="GET",route="/api/feed"} 1');
    expect(text).toContain('nexus_http_request_duration_ms_sum{method="GET",route="/api/feed"} 40.000');
    expect(text).toContain('nexus_http_requests_total{method="POST",route="/api/posts"} 1');
    expect(text).toContain('nexus_http_request_errors_total{method="POST",route="/api/posts"} 0');
  });

  it("does not count a 4xx as an error", () => {
    recordRequest("GET", "/api/does-not-exist", 404, 1);
    const text = renderMetrics();
    expect(text).toContain('nexus_http_request_errors_total{method="GET",route="/api/does-not-exist"} 0');
  });
});

describe("GET /metrics", () => {
  beforeEach(() => {
    __resetMetricsForTests();
  });

  it("serves Prometheus-format text and reflects real traffic through the app", async () => {
    const app = await buildApp();
    await app.inject({ method: "GET", url: "/health" });
    await app.inject({ method: "GET", url: "/health" });

    const res = await app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    // The /health calls above are recorded against the route pattern, not
    // included in this response's own body (onResponse fires after the
    // handler returns, so /metrics can't see itself in the same response).
    expect(res.body).toContain('nexus_http_requests_total{method="GET",route="/health"} 2');
    await app.close();
  });

  it("labels an unmatched route as \"unmatched\" instead of the raw requested path", async () => {
    const app = await buildApp();
    await app.inject({ method: "GET", url: "/this-path-does-not-exist-at-all" });

    const res = await app.inject({ method: "GET", url: "/metrics" });
    expect(res.body).toContain('route="unmatched"');
    expect(res.body).not.toContain("this-path-does-not-exist-at-all");
    await app.close();
  });
});
