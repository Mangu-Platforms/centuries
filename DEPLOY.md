# NEXUS — Deployment Guide

Architecture: Next.js web on **Vercel** · Fastify API on **Railway** (SQLite on a volume for now; Postgres later).

Everything below was verified locally against the exact build/start commands Railway will run.

**Branch note:** this repo's default branch is currently
`autonomous-agent-setup-6249396920522474145` (a leftover name from initial
scaffolding) — there is no `main` branch yet. Point Railway/Vercel's
"production branch" setting at whatever branch your team has actually
designated as production (check the repo's default branch in GitHub
settings before deploying; rename it there if you want `main` instead —
that's a repo-admin action, not something to script). The examples below use
the current default branch name; substitute your real one.

## Step 1 — Commit the deploy config

Two files changed in this repo:

- `railway.json` (new) — build, start, and healthcheck config for the API
- `apps/api/package.json` — moved `prisma` from devDependencies to dependencies (the start command runs `prisma db push` at boot, when the volume is first mounted, so the CLI must exist at runtime)

```bash
git add railway.json apps/api/package.json package-lock.json
git commit -m "Add Railway deploy config for API"
git push origin <your-production-branch>
```

## Step 2 — Deploy the API to Railway

1. Go to https://railway.app → New Project → **Deploy from GitHub repo** → pick `Mangu-Platforms/centuries`, branch `<your-production-branch>`.
2. Railway auto-detects `railway.json`. No build settings needed.
3. **Add a volume**: service → right-click / Settings → Volumes → mount at `/data`. This is where SQLite lives — without it, your database resets on every deploy.
4. **Set environment variables** on the service:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | `file:/data/nexus.db` |
   | `JWT_SECRET` | *(generate your own — never reuse an example value)* |
   | `DATA_KEY` | *(generate your own — see below)* |
   | `CORS_ORIGIN` | *(set after Step 3 — your Vercel URL)* |

   Generate `JWT_SECRET` and `DATA_KEY` locally, e.g.:
   ```bash
   openssl rand -base64 48   # JWT_SECRET
   openssl rand -hex 32      # DATA_KEY (must be 32 bytes / 64 hex chars for AES-256-GCM)
   ```
   Never commit these values anywhere, including in this doc. Rotate
   immediately if a value is ever pasted into a commit, issue, or chat log.

5. Settings → Networking → **Generate Domain**. Note the URL (e.g. `https://nexus-api-production.up.railway.app`).
6. Verify: `curl https://YOUR-RAILWAY-URL/health` → `{"status":"ok",...}`

Optional — seed the demo account (demo@nexus.app / password123):
```bash
railway run npm run seed -w @nexus/api
```
Or just register a fresh account through the UI once the web app is live.

## Step 3 — Deploy the web app to Vercel

1. https://vercel.com/new → import `Mangu-Platforms/centuries`.
2. **Root Directory**: `apps/web` (important — it's a monorepo).
3. Framework preset: Next.js (auto-detected). Production branch: `<your-production-branch>` (Settings → Git — set explicitly, since the repo has no `main`).
4. Environment variable:

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | `https://YOUR-RAILWAY-URL` (no trailing slash) |

5. Deploy. Note your Vercel URL.

## Step 4 — Close the CORS loop

Back in Railway, set `CORS_ORIGIN` to your Vercel URL (e.g. `https://nexus-web.vercel.app`) and redeploy the service. Multiple origins are comma-separated if you add a custom domain later.

## Step 5 — Smoke test

1. Open the Vercel URL → landing page loads
2. Register a new account → should land on the dashboard
3. Dashboard → Connections → connect a platform (demo connectors, no keys needed)
4. Feed populates, like/bookmark work
5. Composer → cross-post → check publishing history

## Later: graduating from SQLite

Postgres support (Phase G1) already exists on this branch — you don't need
to hand-edit the schema. `apps/api/prisma/schema.prisma` (SQLite) stays the
single source of truth for every model; `apps/api/prisma/schema.production.prisma`
is a **generated** file (`npm run -w @nexus/api db:generate-prod-schema`)
that's identical except for the datasource, so the two can never drift
apart. Tracked migrations for Postgres live in `apps/api/prisma/migrations/`.

When you're ready for Postgres (Supabase, Railway's own, or any Postgres 15+):

1. Provision a Postgres database and get its connection string.
2. Set `DATABASE_URL` on the Railway service to that connection string
   (instead of `file:/data/nexus.db`).
3. Change the service's **start command** from `prisma db push && node dist/server.js`
   (or whatever `railway.json` currently runs) to:
   ```
   npm run -w @nexus/api db:migrate:deploy && node apps/api/dist/server.js
   ```
   `db:migrate:deploy` regenerates `schema.production.prisma` from
   `schema.prisma` (so it can never be stale) and then runs
   `prisma migrate deploy` — applies every pending tracked migration,
   idempotently, the same command every deploy. Unlike `db push`, this
   keeps a real migration history instead of silently diffing the live
   schema on every boot.
4. Redeploy. The volume can then be removed — Postgres is durable storage,
   unlike SQLite-on-a-volume.

**Authoring a new migration** (only needed when you change a model in
`schema.prisma`): with a real Postgres reachable locally (e.g. `docker run
-p 5432:5432 -e POSTGRES_PASSWORD=dev postgres:16`), run
`DATABASE_URL=postgresql://... npm run -w @nexus/api db:migrate:dev` —
this regenerates the production schema, diffs it against the target
database, and writes a new timestamped folder under
`apps/api/prisma/migrations/`. Commit the new migration folder alongside
the `schema.prisma` change that prompted it. Verified end-to-end in this
session against a real local PostgreSQL 16 instance: generated the initial
migration, applied it via `migrate deploy` to a fresh empty database, and
ran the full 127-test suite (and a live server smoke test — login, feed,
analytics, like) against it with no code changes needed anywhere outside
`prisma/`.

## Next after deploy (from the handoff doc)

1. **Bluesky connector first** — app-password auth via `@atproto/api`, no OAuth app approval needed. Implement `PlatformConnector` in `apps/api/src/connectors/`
2. Twitter/Mastodon/Threads OAuth (each needs a developer app)
3. Auth hardening: email verification, password reset, refresh tokens
