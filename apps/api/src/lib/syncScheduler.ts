import { syncAllConnections } from "./sync.js";

// Started only from server.ts (the actual long-running process entry
// point) — never from app.ts/buildApp(), which tests call directly. A
// background timer running during tests would leak across test files and
// fire real (if demo-connector) sync ticks nothing is asserting on.
const SYNC_INTERVAL_MS = 5 * 60 * 1000;

let timer: NodeJS.Timeout | undefined;

export function startSyncScheduler(logger: { info: (msg: string) => void; error: (obj: unknown, msg: string) => void }): void {
  if (timer) return;
  timer = setInterval(() => {
    void syncAllConnections()
      .then((result) => logger.info(`Sync tick: ${JSON.stringify(result)}`))
      .catch((err) => logger.error({ err }, "Sync tick failed"));
  }, SYNC_INTERVAL_MS);
  // Don't hold the process open solely to fire this timer — a graceful
  // shutdown (SIGINT/SIGTERM in server.ts) should still exit promptly.
  timer.unref();
}

export function stopSyncScheduler(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}
