import bcrypt from "bcryptjs";
import { prisma } from "./db.js";
import { PLATFORM_IDS, type PlatformId } from "./config.js";
import { getConnector } from "./connectors/registry.js";

// Seeds a ready-to-explore demo account:
//   email:    demo@nexus.app
//   password: password123
const DEMO_EMAIL = "demo@nexus.app";
const DEMO_PASSWORD = "password123";

// Typed against PlatformId (not just `string`) so adding a new platform to
// PLATFORMS without a matching entry here is a compile error, not a
// runtime crash on the `handle` field — found the hard way while adding
// Instagram (Phase E5).
const DEMO_HANDLES: Record<PlatformId, string> = {
  twitter: "@birdman",
  threads: "@birdman",
  bluesky: "@birdman.bsky.social",
  mastodon: "@birdman@mastodon.social",
  instagram: "@birdman",
};

async function main(): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (existing) {
    await prisma.user.delete({ where: { id: existing.id } });
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const user = await prisma.user.create({
    data: {
      email: DEMO_EMAIL,
      passwordHash,
      displayName: "Birdman",
      bio: "Building the unified social experience.",
    },
  });

  for (const platform of PLATFORM_IDS) {
    const handle = DEMO_HANDLES[platform];
    const connection = await prisma.connection.create({
      // lastSyncedAt: the seed itself performs the initial fetch below, so
      // the demo account starts with honest health data instead of "never".
      data: { userId: user.id, platform, handle, displayName: handle, status: "active", lastSyncedAt: new Date() },
    });
    const remote = await getConnector(platform).fetchTimeline({ handle }, 8);
    await prisma.feedPost.createMany({
      data: remote.map((p) => ({
        userId: user.id,
        connectionId: connection.id,
        platform,
        externalId: p.externalId,
        authorHandle: p.authorHandle,
        authorName: p.authorName,
        authorAvatar: p.authorAvatar,
        content: p.content,
        mediaUrls: JSON.stringify(p.mediaUrls),
        likeCount: p.likeCount,
        repostCount: p.repostCount,
        replyCount: p.replyCount,
        postedAt: p.postedAt,
      })),
    });
  }

  const feedCount = await prisma.feedPost.count({ where: { userId: user.id } });
  console.log(`Seeded demo user ${DEMO_EMAIL} (password: ${DEMO_PASSWORD})`);
  console.log(`  - ${PLATFORM_IDS.length} platform connections`);
  console.log(`  - ${feedCount} aggregated feed posts`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
