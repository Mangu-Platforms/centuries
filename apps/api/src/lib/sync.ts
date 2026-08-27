import { prisma } from "../db.js";
import { isPlatform } from "../config.js";
import { getConnector } from "../connectors/registry.js";
import { decryptSecret } from "./crypto.js";
import { importTimelinePosts } from "./timelineImport.js";
import type { Connection } from "@prisma/client";

// Periodic feed sync (Phase D1): pulls each connection's timeline again on a
// cadence, rather than only ever once at connect time. Reuses the same
// dedup-aware import path as the initial fetch (lib/timelineImport.ts), so a
// tick that re-fetches unchanged posts just refreshes their engagement
// counts instead of duplicating them.

const SYNC_FETCH_LIMIT = 20;

/**
 * Syncs one connection: fetches its timeline via whichever connector it
 * resolves to (demo or live, same rule as connect-time) and imports it.
 * A connection already in "error" status is retried too, so a transient
 * failure (network blip, momentarily rate-limited) can self-heal on the
 * next tick without the user having to reconnect — a fetch that succeeds
 * flips status back to "active".
 */
export async function syncConnection(connection: Connection): Promise<{ imported: number; error?: string }> {
  if (!isPlatform(connection.platform)) return { imported: 0 };

  const hasCredentials = Boolean(connection.appPasswordEnc || connection.accessTokenEnc);
  const connector = getConnector(connection.platform, hasCredentials);
  const ctx = {
    handle: connection.handle,
    instance: connection.instance || undefined,
    appPassword: connection.appPasswordEnc ? decryptSecret(connection.appPasswordEnc) : undefined,
    accessToken: connection.accessTokenEnc ? decryptSecret(connection.accessTokenEnc) : undefined,
    connectionId: connection.id,
  };

  // Both health stamps below use updateMany guarded on the updatedAt value
  // read at tick start, for two reasons: (a) updateMany returns count 0
  // instead of throwing when the row was deleted mid-fetch (a thrown P2025
  // would abort the whole tick for every remaining connection), and (b) a
  // slow tick that raced a concurrent reconnect — which bumps updatedAt —
  // must not clobber the reconnect's newer credential/health state with a
  // stale verdict. A skipped stamp self-corrects on the next tick.
  let remote;
  try {
    remote = await connector.fetchTimeline(ctx, SYNC_FETCH_LIMIT);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    await prisma.connection.updateMany({
      where: { id: connection.id, updatedAt: connection.updatedAt },
      data: { status: "error", lastError: message },
    });
    return { imported: 0, error: message };
  }

  const { newCount } = await importTimelinePosts({
    userId: connection.userId,
    connectionId: connection.id,
    platform: connection.platform,
    posts: remote,
  });

  // Stamp the health fields (Phase C6) on every successful sync; this also
  // self-heals a connection that was in "error" from a previous failure.
  await prisma.connection.updateMany({
    where: { id: connection.id, updatedAt: connection.updatedAt },
    data: { status: "active", lastSyncedAt: new Date(), lastError: "" },
  });

  return { imported: newCount };
}

export interface SyncAllResult {
  connectionsSynced: number;
  postsImported: number;
  connectionsFailed: number;
}

/** Syncs every connection across every user, sequentially. Called on a timer (lib/syncScheduler.ts) or on demand. */
export async function syncAllConnections(): Promise<SyncAllResult> {
  const connections = await prisma.connection.findMany({ where: { status: { in: ["active", "error"] } } });

  let postsImported = 0;
  let connectionsFailed = 0;
  for (const connection of connections) {
    try {
      const result = await syncConnection(connection);
      postsImported += result.imported;
      if (result.error) connectionsFailed++;
    } catch {
      // One connection's unexpected failure (e.g. its row or user deleted
      // mid-tick) must never abort the rest of the tick.
      connectionsFailed++;
    }
  }

  return { connectionsSynced: connections.length, postsImported, connectionsFailed };
}
