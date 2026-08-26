import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { runDueScheduledSends } from "../lib/publish.js";

// Phase E2: an external cron (Railway cron, a scheduled GitHub Action, or
// any uptime-style pinger) hits this to fire due scheduled posts, rather
// than an in-process timer (contrast with Phase D1's feed sync, which
// tolerates an in-process setInterval fine since missing a tick there just
// delays a feed refresh). A scheduled *send* firing exactly when the user
// asked matters more, and an external cron keeps working across API
// restarts/redeploys where an in-process timer would reset.

// Dev/test-only fallback so this route is exercisable locally without
// configuring a real secret — mirrors lib/crypto.ts's DATA_KEY pattern.
// Never used in production: resolveCronSecret() returns null there instead
// when CRON_SECRET is unset, which the route turns into a hard 503 rather
// than silently accepting a guessable default. Exported so tests can use
// the exact same value rather than duplicating the string literal.
export const DEV_CRON_SECRET = "nexus-dev-only-cron-secret-do-not-use-in-prod";

function resolveCronSecret(): string | null {
  if (config.cronSecret) return config.cronSecret;
  return config.isProd ? null : DEV_CRON_SECRET;
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual throws on mismatched lengths rather than returning
  // false, and comparing lengths first is not itself a meaningful timing
  // leak (the secret's length isn't the secret).
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export async function internalRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/internal/tick",
    { preHandler: [app.rateLimit({ max: 30, timeWindow: "1 minute" })] },
    async (request, reply) => {
      const expected = resolveCronSecret();
      if (!expected) {
        return reply.code(503).send({ error: "Scheduled sending is not configured (CRON_SECRET unset)" });
      }

      const provided = request.headers["x-cron-secret"];
      if (typeof provided !== "string" || !timingSafeEqualStrings(provided, expected)) {
        return reply.code(401).send({ error: "Invalid or missing cron secret" });
      }

      const result = await runDueScheduledSends();
      return reply.send(result);
    },
  );
}
