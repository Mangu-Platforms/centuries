# NEXUS — Architecture

## Overview

```
apps/web  (Next.js 14 App Router)  --HTTP-->  apps/api  (Fastify 5)  -->  Prisma  -->  SQLite (dev) / Postgres (prod)
```

Two npm workspaces under one repo (`apps/api`, `apps/web`), driven from the
root `package.json`. No separate monorepo tool (Turborepo/Nx) — plain
workspaces, per the build charter's "no new frameworks" rule.

## apps/api (Fastify 5 + Prisma + TypeScript)

- `src/server.ts` — process entry point; calls `buildApp()` and listens.
- `src/app.ts` — builds the Fastify instance: CORS, JWT auth plugin, route
  registration, `/health`, `/api/platforms`.
- `src/config.ts` — env-driven config + the `PLATFORMS` map (id → name,
  color, char limit, auth model). This is the single source of truth for
  platform metadata on the API side.
- `src/db.ts` — shared Prisma client singleton.
- `src/plugins/auth.ts` — registers `@fastify/jwt`, decorates `authenticate`
  preHandler.
- `src/routes/*.ts` — one file per resource: `auth`, `connections`, `feed`,
  `posts`, `dashboard`. Routes talk to Prisma directly and to connectors via
  `connectors/registry.ts` (Phase A5) — never fetch/publish logic inline in a
  route handler.
- `src/connectors/types.ts` — the `PlatformConnector` integration seam:
  `fetchTimeline(ctx, limit)` and `publish(ctx, content, mediaUrls)`. Every
  platform, demo or live, implements this interface.
- `src/connectors/demo.ts` — deterministic, dependency-free demo connectors
  for all four (soon five) platforms. Used whenever a platform has no live
  credentials configured, so the product never goes dark.
- `src/connectors/registry.ts` (Phase A5) — resolves a `PlatformConnector`
  per platform: live implementation if configured, demo otherwise.
- `src/lib/crypto.ts` (Phase A4) — AES-256-GCM encrypt/decrypt for connection
  credentials at rest, keyed by the server-side `DATA_KEY` env var.
- `src/lib/resilience.ts` (Phase C5) — `wrapConnector()` decorator the
  registry applies to live connectors: retries with backoff + jitter for
  provably transient failures, 429 handling (publish: never retried on a
  network failure, once on 429), a per-connection circuit breaker, and the
  `refreshCredentials` hook that persists rotated tokens encrypted. Demo
  connectors are never wrapped.
- `prisma/schema.prisma` — `User`, `Connection`, `FeedPost`, `PublishJob`,
  `PublishTarget`. SQLite locally, Postgres in production (Phase G1); no
  raw SQL, so the schema stays provider-agnostic.
- `src/__tests__/*.test.ts` — vitest. One suite per connector/auth/publish
  concern; expand this file set, don't grow a single mega-file.

## apps/web (Next.js 14 App Router + Tailwind)

- `app/` — route segments: `/` (landing), `/login`, `/register`,
  `/dashboard`, `/dashboard/feed`, `/dashboard/connections`,
  `/dashboard/settings`.
- `components/Composer.tsx` — cross-post composer (platform picker, char
  limit preview, publish).
- `components/PostCard.tsx` — a single feed post (like/bookmark, platform
  glyph).
- `lib/api.ts` — thin fetch wrapper against `NEXT_PUBLIC_API_URL`.
- `lib/auth.tsx` — client-side auth context (JWT in memory/localStorage).
- `lib/platforms.tsx` — brand colors, icons, and `PLATFORM_META` (name,
  color, char limit, auth label) — the web-side mirror of the API's
  `PLATFORMS` map. Keep the two in sync by hand until a shared package is
  worth the complexity (not yet — two small maps don't justify a new
  workspace package).

## Request flow: cross-post publish

1. `POST /api/posts` (web `Composer.tsx` → `lib/api.ts`).
2. Zod validation, then per-platform char-limit check against `config.ts`
   `PLATFORMS` (fail fast, no network calls if any platform is over limit).
3. One `PublishJob` row created; then, per selected platform: resolve a
   connector via the registry, call `.publish()`, record a `PublishTarget`
   row (`success`/`failed`, `latencyMs`, `error`), and on success append a
   `FeedPost` row with `isOwn: true`.
4. Response returns per-platform results so the UI can show partial
   success/failure without rolling back the whole post.

## Request flow: connect a platform

1. `POST /api/connections` (handle, optional instance, optional credential).
2. `Connection` row created (Phase A4: credential encrypted via
   `lib/crypto.ts` before storage, never stored plaintext).
3. Registry-resolved connector's `fetchTimeline()` runs once immediately so
   the feed isn't empty; results become `FeedPost` rows.
4. Phase D1 replaces "fetch once at connect time" with a recurring sync
   worker so the feed stays current without a live API call on every
   `/api/feed` request.

## Environments

- **Local dev**: SQLite file DB (`apps/api/prisma/dev.db`, gitignored),
  both servers run via `npm run dev` (API `:4000`, web `:3000`).
- **Production target**: web on Vercel, API on Railway (or equivalent),
  Postgres for the database. See `DEPLOY.md`.

## Why these boundaries

- The `PlatformConnector` interface is the only place platform-specific
  fetch/publish code is allowed to live. Routes, the registry, and the sync
  worker (once it exists) only ever call `.fetchTimeline()` / `.publish()`
  against that interface — this is what makes "add a fifth platform" a
  connector-file-sized change instead of a routes-wide change (see
  `OPERATOR.md`, Phase G6).
- Demo connectors are permanent, not scaffolding to delete once live
  connectors exist — they're the "no credentials configured" fallback path
  for every platform, forever (per the charter's non-negotiable rules).
