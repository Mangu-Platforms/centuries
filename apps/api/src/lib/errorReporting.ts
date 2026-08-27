import type { FastifyBaseLogger } from "fastify";

export interface ErrorReportContext {
  requestId: string;
  method: string;
  url: string;
  statusCode: number;
}

// A single named hook point for "an unhandled error happened" -- today the
// only implementation is structured pino logging (already correlated by
// requestId with the rest of that request's log lines), but no real
// error-tracking service (Sentry, Bugsnag, etc.) has credentials configured
// yet. Wiring one in later is a new branch here selected by an env var (e.g.
// `SENTRY_DSN`), same "ship a fully-working default, gate the real backend
// behind env" split as EmailProvider (Phase B2) and MediaStorage (Phase E3)
// -- callers of reportError() don't need to change.
export function reportError(logger: FastifyBaseLogger, err: unknown, context: ErrorReportContext): void {
  logger.error({ err, ...context }, "Unhandled error");
}
