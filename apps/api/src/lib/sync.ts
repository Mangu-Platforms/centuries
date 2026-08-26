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
  };

  let remote;
  try {
    remote = await connector.fetchTimeline(ctx, SYNC_FETCH_LIMIT);
  } catch (err) {
    await prisma.connection.update({ where: { id: connection.id }, data: { status: "error" } });
    return { imported: 0, error: err instanceof Error ? err.message : "Sync failed" };
  }

  const { newCount } = await importTimelinePosts({
    userId: connection.userId,
    connectionId: connection.id,
    platform: connection.platform,
    posts: remote,
  });

  if (connection.status === "error") {
    await prisma.connection.update({ where: { id: connection.id }, data: { status: "active" } });
  }

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
    const result = await syncConnection(connection);
    postsImported += result.imported;
    if (result.error) connectionsFailed++;
  }

  return { connectionsSynced: connections.length, postsImported, connectionsFailed };
}
