import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { config, PLATFORMS } from "./config.js";
import { registerAuth } from "./plugins/auth.js";
import { authRoutes } from "./routes/auth.js";
import { connectionRoutes } from "./routes/connections.js";
import { feedRoutes } from "./routes/feed.js";
import { postRoutes } from "./routes/posts.js";
import { dashboardRoutes } from "./routes/dashboard.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.isProd
      ? true
      : { transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } } },
  });

  await app.register(cors, { origin: config.corsOrigin, credentials: true });
  await registerAuth(app);

  app.get("/health", async () => ({ status: "ok", uptime: process.uptime() }));
  app.get("/api/platforms", async () => ({ platforms: Object.values(PLATFORMS) }));

  await app.register(authRoutes);
  await app.register(connectionRoutes);
  await app.register(feedRoutes);
  await app.register(postRoutes);
  await app.register(dashboardRoutes);

  return app;
}
