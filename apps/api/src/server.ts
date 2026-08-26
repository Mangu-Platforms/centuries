import { buildApp } from "./app.js";
import { config } from "./config.js";
import { disconnect } from "./db.js";
import { startSyncScheduler, stopSyncScheduler } from "./lib/syncScheduler.js";

async function main(): Promise<void> {
  const app = await buildApp();

  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down...`);
    stopSyncScheduler();
    await app.close();
    await disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info(`NEXUS API listening on http://localhost:${config.port}`);
    startSyncScheduler(app.log);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
