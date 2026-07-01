# NEXUS — Deployment Guide

Architecture: Next.js web on **Vercel** · Fastify API on **Railway** (SQLite on a volume for now; Postgres later).

Everything below was verified locally against the exact build/start commands Railway will run.

## Step 1 — Commit the deploy config

Two files changed in this repo:

- `railway.json` (new) — build, start, and healthcheck config for the API
- `apps/api/package.json` — moved `prisma` from devDependencies to dependencies (the start command runs `prisma db push` at boot, when the volume is first mounted, so the CLI must exist at runtime)

```bash
git add railway.json apps/api/package.json package-lock.json
git commit -m "Add Railway deploy config for API"
git push origin autonomous-agent-setup-6249396920522474145
```

## Step 2 — Deploy the API to Railway

1. Go to https://railway.app → New Project → **Deploy from GitHub repo** → pick `redinc23/centuries`, branch `autonomous-agent-setup-6249396920522474145`.
2. Railway auto-detects `railway.json`. No build settings needed.
3. **Add a volume**: service → right-click / Settings → Volumes → mount at `/data`. This is where SQLite lives — without it, your database resets on every deploy.
4. **Set environment variables** on the service:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | `file:/data/nexus.db` |
   | `JWT_SECRET` | `DWbAjucZk+Onn9XzSMWohCo4TDL5Yw/zlhdh4Uz0fcExDqwKQHQSaefM+WDuyq9X` (or generate your own) |
   | `CORS_ORIGIN` | *(set after Step 3 — your Vercel URL)* |

5. Settings → Networking → **Generate Domain**. Note the URL (e.g. `https://nexus-api-production.up.railway.app`).
6. Verify: `curl https://YOUR-RAILWAY-URL/health` → `{"status":"ok",...}`

Optional — seed the demo account (demo@nexus.app / password123):
```bash
railway run npm run seed -w @nexus/api
```
Or just register a fresh account through the UI once the web app is live.

## Step 3 — Deploy the web app to Vercel

1. https://vercel.com/new → import `redinc23/centuries`.
2. **Root Directory**: `apps/web` (important — it's a monorepo).
3. Framework preset: Next.js (auto-detected). Production branch: `autonomous-agent-setup-6249396920522474145` (Settings → Git, since it's not `main`).
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

When you're ready for Postgres (Supabase or Railway's own):
1. `apps/api/prisma/schema.prisma` → change `provider = "sqlite"` to `provider = "postgresql"`
2. Set `DATABASE_URL` to the Postgres connection string
3. Run `npm run -w @nexus/api prisma:generate`, commit, redeploy
4. The volume can then be removed

## Next after deploy (from the handoff doc)

1. **Bluesky connector first** — app-password auth via `@atproto/api`, no OAuth app approval needed. Implement `PlatformConnector` in `apps/api/src/connectors/`
2. Twitter/Mastodon/Threads OAuth (each needs a developer app)
3. Auth hardening: email verification, password reset, refresh tokens
