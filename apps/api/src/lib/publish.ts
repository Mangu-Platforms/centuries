import { prisma } from "../db.js";
import { getConnector } from "../connectors/registry.js";
import { decryptSecret } from "./crypto.js";
import type { PlatformId } from "../config.js";
import type { Connection } from "@prisma/client";

// Shared by both the immediate-publish path (routes/posts.ts) and the
// scheduled-send worker (routes/internal.ts, Phase E2) — publishing to one
// platform means the same thing whether it happens now or later: resolve
// the connector, attempt the send, and record the outcome on the
// already-created PublishTarget row (never a new one — see below).

export interface ScheduledSendResult {
  jobsProcessed: number;
  targetsPublished: number;
  targetsFailed: number;
}

/**
 * Publishes every due (scheduledAt in the past) job's still-pending
 * targets. Called by POST /internal/tick (routes/internal.ts, Phase E2),
 * typically from an external cron. Re-resolves each user's connections at
 * send time rather than trusting anything cached from when the post was
 * scheduled — the user may have reconnected (or disconnected) a platform
 * in between.
 */
export async function runDueScheduledSends(): Promise<ScheduledSendResult> {
  const dueJobs = await prisma.publishJob.findMany({
    where: { scheduledAt: { lte: new Date() }, targets: { some: { status: "pending" } } },
    include: { targets: { where: { status: "pending" } } },
  });

  let targetsPublished = 0;
  let targetsFailed = 0;

  for (const job of dueJobs) {
    const platforms = job.targets.map((t) => t.platform as PlatformId);
    const connections = await prisma.connection.findMany({
      where: { userId: job.userId, platform: { in: platforms } },
    });
    const byPlatform = new Map(connections.map((c) => [c.platform, c]));
    const mediaUrls = JSON.parse(job.mediaUrls) as string[];

    for (const target of job.targets) {
      const platform = target.platform as PlatformId;
      const connection = byPlatform.get(platform);
      if (!connection) {
        await prisma.publishTarget.update({
          where: { id: target.id },
          data: { status: "failed", error: `No ${platform} connection found at send time` },
        });
        targetsFailed++;
        continue;
      }

      const outcome = await attemptPublish({
        targetId: target.id,
        userId: job.userId,
        connection,
        platform,
        content: job.content,
        mediaUrls,
      });
      if (outcome.status === "success") targetsPublished++;
      else targetsFailed++;
    }
  }

  return { jobsProcessed: dueJobs.length, targetsPublished, targetsFailed };
}

export interface PublishAttemptResult {
  status: "success" | "failed";
  externalId: string;
  error: string;
  latencyMs: number;
}

/**
 * Attempts to publish content to one platform and records the outcome on
 * an existing PublishTarget row (created up front as "pending" by the
 * caller, whether it's about to be attempted immediately or later by the
 * tick worker — see routes/posts.ts). On success, also mirrors the post
 * into the user's own feed. Never throws: a connector failure is recorded
 * as a "failed" target, not an unhandled rejection.
 */
export async function attemptPublish(params: {
  targetId: string;
  userId: string;
  connection: Connection;
  platform: PlatformId;
  content: string;
  mediaUrls: string[];
}): Promise<PublishAttemptResult> {
  const { targetId, userId, connection, platform, content, mediaUrls } = params;

  try {
    const hasCredentials = Boolean(connection.appPasswordEnc || connection.accessTokenEnc);
    const res = await getConnector(platform, hasCredentials).publish(
      {
        handle: connection.handle,
        instance: connection.instance,
        appPassword: connection.appPasswordEnc ? decryptSecret(connection.appPasswordEnc) : undefined,
        accessToken: connection.accessTokenEnc ? decryptSecret(connection.accessTokenEnc) : undefined,
        connectionId: connection.id,
      },
      content,
      mediaUrls,
    );

    await prisma.publishTarget.update({
      where: { id: targetId },
      data: { status: "success", externalId: res.externalId, latencyMs: res.latencyMs },
    });
    // Surface the user's own post in the unified feed.
    await prisma.feedPost.create({
      data: {
        userId,
        connectionId: connection.id,
        platform,
        externalId: res.externalId,
        authorHandle: connection.handle,
        authorName: connection.displayName || connection.handle,
        authorAvatar: "",
        content,
        mediaUrls: JSON.stringify(mediaUrls),
        isOwn: true,
        postedAt: new Date(),
      },
    });

    return { status: "success", externalId: res.externalId, error: "", latencyMs: res.latencyMs };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await prisma.publishTarget.update({ where: { id: targetId }, data: { status: "failed", error: message } });
    return { status: "failed", externalId: "", error: message, latencyMs: 0 };
  }
}
