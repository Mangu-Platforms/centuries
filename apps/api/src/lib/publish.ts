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
/**
 * How long a "publishing" claim may sit untouched before the tick treats
 * it as a crashed attempt, and how old an unscheduled job's "pending"
 * target must be before the tick sweeps it up as a strand. Far above any
 * real attempt duration (per-attempt timeout is 10s).
 */
const STALE_CLAIM_MS = 10 * 60 * 1000;

export async function runDueScheduledSends(): Promise<ScheduledSendResult> {
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS);

  // Recovery sweep #1 (E7 review): a target stranded in "publishing" means
  // a process died between the claim and the outcome. The connector MAY
  // have published before the crash, so it must never be silently
  // re-attempted — flip it to a visible failure that tells the user to
  // check the platform before retrying. updatedAt is bumped by the claim
  // itself, so an actively publishing target is never this old.
  await prisma.publishTarget.updateMany({
    where: { status: "publishing", updatedAt: { lte: staleBefore } },
    data: {
      status: "failed",
      error: "Interrupted mid-publish — check the platform for the post before retrying",
    },
  });

  const dueJobs = await prisma.publishJob.findMany({
    where: {
      OR: [
        { scheduledAt: { lte: new Date() } },
        // Recovery sweep #2: an unscheduled job normally publishes inline,
        // so an old "pending" target on one is a strand (e.g. a crash
        // between the retry route's re-arm and its attempt). Safe to
        // publish: a pending target provably never reached a connector —
        // the pending→publishing claim always precedes the call.
        { scheduledAt: null, createdAt: { lte: staleBefore } },
      ],
      targets: { some: { status: "pending" } },
    },
    include: { targets: { where: { status: "pending" } } },
  });

  let targetsPublished = 0;
  let targetsFailed = 0;

  for (const job of dueJobs) {
    const connections = await prisma.connection.findMany({ where: { userId: job.userId } });
    const byPlatform = new Map(connections.map((c) => [c.platform, c]));
    const byId = new Map(connections.map((c) => [c.id, c]));
    const mediaUrls = JSON.parse(job.mediaUrls) as string[];

    for (const target of job.targets) {
      const platform = target.platform as PlatformId;
      // Pin to the exact connection chosen at compose time (E7 review): a
      // platform can have several connected accounts, and re-resolving by
      // platform could silently publish through a different one. Fall back
      // to platform resolution only for legacy rows with no pin.
      const connection = target.connectionId ? byId.get(target.connectionId) : byPlatform.get(platform);
      if (!connection) {
        await prisma.publishTarget.update({
          where: { id: target.id },
          data: {
            status: "failed",
            error: target.connectionId
              ? `The ${platform} connection this post was composed for has been removed`
              : `No ${platform} connection found at send time`,
          },
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
      else if (outcome.status === "failed") targetsFailed++;
      // "skipped": another caller (a concurrent retry or overlapping tick)
      // holds the claim — neither published nor failed by THIS tick.
    }
  }

  return { jobsProcessed: dueJobs.length, targetsPublished, targetsFailed };
}

export interface PublishAttemptResult {
  /** "skipped" = another caller already holds this target's publish claim. */
  status: "success" | "failed" | "skipped";
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

  // Atomic publish claim: exactly one caller may attempt a pending target.
  // Without this, a user-initiated retry (E7, which re-arms a failed
  // target as "pending") racing an /internal/tick firing on the same
  // (past-scheduledAt) job — or two overlapping ticks — would each call
  // the connector and double-post. The guarded updateMany makes the
  // loser's claim match zero rows; it reports "skipped" and touches
  // nothing. (A crash between claim and outcome leaves the target visibly
  // "publishing" — never silently double-posted; E14's live status view
  // is where operator-grade recovery for that rare window belongs.)
  const claim = await prisma.publishTarget.updateMany({
    where: { id: targetId, status: "pending" },
    data: { status: "publishing" },
  });
  if (claim.count === 0) {
    return { status: "skipped", externalId: "", error: "", latencyMs: 0 };
  }

  // The failure-recording catch wraps ONLY the connector call: once the
  // platform has accepted the post, nothing may relabel this target as
  // "failed" — a failed label on a live post invites the user's retry to
  // genuinely double-post (E7 review). Bookkeeping errors after a
  // successful publish are absorbed instead.
  let res;
  try {
    const hasCredentials = Boolean(connection.appPasswordEnc || connection.accessTokenEnc);
    res = await getConnector(platform, hasCredentials).publish(
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
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await prisma.publishTarget.update({ where: { id: targetId }, data: { status: "failed", error: message } });
    return { status: "failed", externalId: "", error: message, latencyMs: 0 };
  }

  try {
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
  } catch {
    // e.g. an externalId collision in the local feed cache — the post is
    // live on the platform regardless; report it as the success it is.
    // If even the status update failed, the row stays "publishing" and the
    // tick's stale-claim sweep surfaces it as check-before-retry.
  }

  return { status: "success", externalId: res.externalId, error: "", latencyMs: res.latencyMs };
}
