# NEXUS — Social Media Aggregator Platform

A unified web application that connects multiple social networks (**Twitter/X, Threads,
Bluesky, Mastodon**) into a single streamlined interface. View an aggregated chronological
feed, engage with posts, and cross-post to every platform with one click.

Built from the Business Requirements Document (`BRD v1.0`).

> This repository also contains the original Python **Autonomous Agent** GitHub Action
> (`autonomous_agent.py`). The full-stack app lives under `apps/`.

## Stack

| Layer    | Technology |
| -------- | ---------- |
| Frontend | Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS |
| Backend  | Fastify 5, Node.js 20+, TypeScript |
| Database | Prisma ORM — SQLite for local dev, PostgreSQL for production |
| Auth     | JWT (`@fastify/jwt`) + bcrypt password hashing (cost 12) |

The four platform integrations are abstracted behind a `PlatformConnector` interface
(`apps/api/src/connectors/`). The shipped **demo connectors** generate realistic feeds and
simulate publishing so the product runs fully without third-party API credentials. Swap in
real implementations (see BRD §8 for endpoints/limits) without touching the rest of the app.

## Project layout

```
apps/
  api/   Fastify + Prisma backend (REST API)
  web/   Next.js 14 + Tailwind frontend
autonomous_agent.py   Original Python GitHub Action (unchanged)
```

## Quick start

```bash
# 1. Install all workspace dependencies
npm install

# 2. Configure environment
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local

# 3. Create the dev database (SQLite) and seed a demo account
npm run db:setup        # prisma db push + seed

# 4. Run both servers (API on :4000, web on :3000)
npm run dev
```

Open http://localhost:3000.

**Demo login:** `demo@nexus.app` / `password123`

## Scripts (run from repo root)

| Command | Description |
| ------- | ----------- |
| `npm run dev` | Run API + web concurrently |
| `npm run dev:api` / `npm run dev:web` | Run a single service |
| `npm run build` | Build both apps |
| `npm run lint` | Typecheck API + lint web |
| `npm test` | Run API (vitest) tests |
| `npm run db:setup` | Push Prisma schema to SQLite + seed demo data |
| `npm run seed` | Re-seed the demo account |

## Key API endpoints

| Method | Path | Description |
| ------ | ---- | ----------- |
| `POST` | `/api/auth/register` / `/api/auth/login` | Auth, returns JWT |
| `GET`  | `/api/feed` | Unified paginated feed (filter by `platform`, `search`, `bookmarked`) |
| `POST` | `/api/feed/:id/like` / `/bookmark` | Engage with a post |
| `GET`/`POST`/`DELETE` | `/api/connections` | Manage platform connections |
| `POST` | `/api/posts` | Cross-post to selected platforms |
| `GET`  | `/api/posts/history` | Publishing history |
| `GET`  | `/api/dashboard` | Overview + analytics |

## Switching to PostgreSQL (production)

1. In `apps/api/prisma/schema.prisma`, set the datasource `provider = "postgresql"`.
2. Point `DATABASE_URL` at your Postgres 15 instance.
3. Run `npx prisma migrate deploy` (or `db push`).

The application code is database-agnostic; no query changes are required.
