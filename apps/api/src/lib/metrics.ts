interface RouteMetric {
  count: number;
  errorCount: number;
  totalDurationMs: number;
}

const routeMetrics = new Map<string, RouteMetric>();
const startedAt = Date.now();

function keyFor(method: string, route: string): string {
  return `${method} ${route}`;
}

export function recordRequest(method: string, route: string, statusCode: number, durationMs: number): void {
  const key = keyFor(method, route);
  const existing = routeMetrics.get(key) ?? { count: 0, errorCount: 0, totalDurationMs: 0 };
  existing.count += 1;
  existing.totalDurationMs += durationMs;
  if (statusCode >= 500) existing.errorCount += 1;
  routeMetrics.set(key, existing);
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// Hand-rolled Prometheus text exposition format
// (https://prometheus.io/docs/instrumenting/exposition_formats/) rather than
// pulling in prom-client: this app tracks exactly three counters per route,
// not the histograms/gauges/percentiles a full metrics library exists for --
// a dependency for that would be solving a bigger problem than this app has.
export function renderMetrics(): string {
  const lines: string[] = [
    "# HELP nexus_process_uptime_seconds Seconds since the process started.",
    "# TYPE nexus_process_uptime_seconds gauge",
    `nexus_process_uptime_seconds ${((Date.now() - startedAt) / 1000).toFixed(3)}`,
    "# HELP nexus_http_requests_total Total HTTP requests handled, by method and route.",
    "# TYPE nexus_http_requests_total counter",
    "# HELP nexus_http_request_errors_total Total HTTP requests that responded with a 5xx status, by method and route.",
    "# TYPE nexus_http_request_errors_total counter",
    "# HELP nexus_http_request_duration_ms_sum Sum of response times in milliseconds, by method and route.",
    "# TYPE nexus_http_request_duration_ms_sum counter",
  ];

  for (const [key, metric] of routeMetrics) {
    const [method, ...routeParts] = key.split(" ");
    const route = routeParts.join(" ");
    const labels = `method="${escapeLabel(method)}",route="${escapeLabel(route)}"`;
    lines.push(`nexus_http_requests_total{${labels}} ${metric.count}`);
    lines.push(`nexus_http_request_errors_total{${labels}} ${metric.errorCount}`);
    lines.push(`nexus_http_request_duration_ms_sum{${labels}} ${metric.totalDurationMs.toFixed(3)}`);
  }

  return lines.join("\n") + "\n";
}

// Test-only: the counters above live at module scope (one process = one set
// of counters, same reasoning as the sync scheduler's module-level state),
// so tests that assert on specific values need to reset between runs.
export function __resetMetricsForTests(): void {
  routeMetrics.clear();
}
