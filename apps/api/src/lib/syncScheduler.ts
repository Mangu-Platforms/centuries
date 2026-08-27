import { syncAllConnections } from "./sync.js";

// Started only from server.ts (the actual long-running process entry
// point) — never from app.ts/buildApp(), which tests call directly. A
// background timer running during tests would leak across test files and
// fire real (if demo-connector) sync ticks nothing is asserting on.
//
// Phase D7: ticks self-reschedule with jitter (±20% of the base interval)
// instead of a fixed setInterval. Two reasons: multiple processes started
// around the same moment (a deploy rolling several instances, dev + test
// stacks on one machine) drift apart instead of thundering upstream APIs
// in sync forever; and a slow tick delays the next one (the next timer is
// armed only after the current tick finishes) rather than stacking a
// second tick on top of a still-running one.
const SYNC_INTERVAL_MS = 5 * 60 * 1000;
const SYNC_JITTER_RATIO = 0.2;

let timer: NodeJS.Timeout | undefined;
let running = false;

/** Base interval ±jitter, uniformly distributed. Exported for tests. */
export function nextSyncDelayMs(
  baseMs: number = SYNC_INTERVAL_MS,
  jitterRatio: number = SYNC_JITTER_RATIO,
  random: () => number = Math.random,
): number {
  const jitter = baseMs * jitterRatio;
  return Math.round(baseMs - jitter + random() * 2 * jitter);
}

export function startSyncScheduler(logger: { info: (msg: string) => void; error: (obj: unknown, msg: string) => void }): void {
  if (running) return;
  running = true;

  const arm = () => {
    if (!running) return;
    timer = setTimeout(() => {
      void syncAllConnections()
        .then((result) => logger.info(`Sync tick: ${JSON.stringify(result)}`))
        .catch((err) => logger.error({ err }, "Sync tick failed"))
        .finally(arm); // next tick is armed only after this one settles — ticks never overlap
    }, nextSyncDelayMs());
    // Don't hold the process open solely to fire this timer — a graceful
    // shutdown (SIGINT/SIGTERM in server.ts) should still exit promptly.
    timer.unref();
  };
  arm();
}

export function stopSyncScheduler(): void {
  running = false;
  if (timer) clearTimeout(timer);
  timer = undefined;
}
