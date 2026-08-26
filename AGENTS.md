# AGENTS.md

## Cursor Cloud specific instructions

This repo contains two independent things:

1. **NEXUS full-stack app** (`apps/api`, `apps/web`) — the Social Media Aggregator
   Platform built from `BRD-v1`. This is the primary product.
2. **Autonomous Agent** (`autonomous_agent.py`) — the original Python GitHub Action.

### NEXUS full-stack app

Monorepo via npm workspaces. Node 20+ (developed on Node 22). Run everything from the
repo root.

- Install: `npm install` (handled by the startup update script).
- Database: Prisma + **SQLite** for local dev (`apps/api/prisma/dev.db`, gitignored).
  Production switches the datasource provider to `postgresql` (see `README.md`).
- First-run setup (NOT in the update script — run once when the DB is missing):
  - `cp apps/api/.env.example apps/api/.env`
  - `cp apps/web/.env.example apps/web/.env.local`
  - `npm run db:setup` — pushes the Prisma schema to SQLite and seeds the demo account.
- Run both dev servers: `npm run dev` (API on `:4000`, web on `:3000`). Or individually:
  `npm run dev:api` / `npm run dev:web`.
- Lint/typecheck: `npm run lint` (API = `tsc --noEmit`, web = `next lint`).
- Tests: `npm test` (API vitest suite under `apps/api/src/__tests__`).
- Build: `npm run build`.
- Demo account: `demo@nexus.app` / `password123`.

Non-obvious notes:

- **Demo connectors:** the four social platforms (Twitter, Threads, Bluesky, Mastodon)
  are implemented as deterministic demo connectors in `apps/api/src/connectors/`. They
  generate realistic feeds and simulate publishing so the app runs fully **without any
  third-party API keys**. To integrate a real platform, implement `PlatformConnector`
  and register it; nothing else needs to change.
- After editing `prisma/schema.prisma` you must run `npm run -w @nexus/api prisma:generate`
  (and `prisma db push`) — the generated client is what the API imports.
- The web app reads the API base URL from `NEXT_PUBLIC_API_URL` (`apps/web/.env.local`,
  default `http://localhost:4000`). CORS origins for the API are set via `CORS_ORIGIN`.
- Prisma CLI prints a "major version upgrade available (7.x)" notice — it is informational;
  the project is pinned to Prisma 6 and works as-is.

### Autonomous Agent (Python)

- Single-file CLI / composite GitHub Action. Deps in `requirements.txt`, installed into a
  `./venv` by the update script. Lint = `python -m py_compile autonomous_agent.py`;
  tests = `python -m pytest` (no tests yet, exit code 5 is expected).
- `main()` requires `GITHUB_TOKEN`, `OPENAI_API_KEY`, and `REPO`, and constructs a GitHub
  client (network call) before argparse — so even `--help` fails without valid creds. To
  exercise logic offline, import the module and call its pure functions. Running
  `analyze`/`generate`/`run` makes live OpenAI + GitHub calls (and `run` opens a PR).

---

## NEXUS 1242-hour autonomous build charter

The section below is the standing charter for the long-running NEXUS build
campaign. It governs all work in `apps/api` and `apps/web`. Read
`docs/CAMPAIGN.md` first every session — it is the living log and points to
the next unblocked backlog item in `docs/BACKLOG.md`. `docs/BRD.md` and
`docs/ARCHITECTURE.md` are the reconstructed requirements and architecture
references. Do not treat `autonomous_agent.py` as the product, and do not
write new product code under `generated/`.

```
# NEXUS / centuries — 1242-hour autonomous build charter

You are a senior full-stack engineer + product engineer. Your only job is to take
https://github.com/Mangu-Platforms/centuries.git from a runnable demo into a
production social aggregator (NEXUS) that a real user can connect to X, Threads,
Bluesky, Mastodon, and Instagram.

Repo: Mangu-Platforms/centuries
Product name: NEXUS — Social Media Aggregator Platform
Primary code: apps/api (Fastify 5 + Prisma + TypeScript) and apps/web (Next.js 14 App Router + Tailwind)
Do NOT treat autonomous_agent.py as the product. Do not write new product code under generated/.
Edit apps/api and apps/web in place. Keep autonomous_agent.py working as a side tool only if you touch it.

Campaign length: 1242 hours of continuous, checkpointed work.
You will be stopped and restarted. Persistence is mandatory.

============================================================
0. FIRST ACTIONS EVERY SESSION (do these before writing code)
============================================================
1. git status / git log -20 / read README.md, AGENTS.md, DEPLOY.md, prisma/schema.prisma.
2. Read docs/CAMPAIGN.md and docs/BACKLOG.md if they exist. If they do not exist, create them in the first hour.
3. Run: npm install && npm run lint && npm test && npm run build
   If the DB is missing: cp env examples, then npm run db:setup.
4. Pick the single highest-priority unfinished item from the backlog that is unblocked.
5. Work that one item to a mergeable state. Do not start five features at once.
6. Before you stop or context-reset: update CAMPAIGN.md (what shipped, what broke, next slice) and BACKLOG.md.

Demo login that must keep working until real auth replaces it:
  demo@nexus.app / password123

============================================================
1. NON-NEGOTIABLE RULES
============================================================
- Ship working software. A merged slice that compiles, lints, and has tests beats a grand rewrite.
- Keep the demo connectors. Real connectors register beside them. If credentials are missing, fall back to demo so the app never goes dark.
- PlatformConnector in apps/api/src/connectors/types.ts is the integration seam. New platforms implement that interface and register. Do not scatter fetch/publish calls through routes.
- Never commit secrets, tokens, app passwords, JWT secrets, or .env files. DEPLOY.md currently contains a hardcoded JWT_SECRET — rotate the documented example to a placeholder in the first security pass. Do not copy that value into new files.
- Do not invent OAuth client IDs or pretend live APIs work. Use env vars. Document required vars in .env.example.
- Character limits stay aligned with config: X 280, Bluesky 300, Threads 500, Mastodon 500, Instagram 2200 (caption).
- Node 20+. Prisma stays on the pinned major unless you deliberately upgrade and fix the whole workspace.
- SQLite for local/dev. PostgreSQL is the production target. Keep Prisma queries provider-agnostic.
- npm workspaces. Run scripts from repo root.
- Tests must exist for every new connector method, auth path, and publish path. Expand beyond apps/api/src/__tests__/connectors.test.ts.
- No drive-by refactors. No new frameworks unless the current one is a hard blocker.
- Accessibility: keyboard, labels, contrast, focus rings on every new UI.
- If a task needs a human (Apple/Meta/X developer app approval), implement the code path + env contract + UI state, then mark the item WAITING-ON-HUMAN and move on.

============================================================
2. CURRENT STATE (do not rediscover this)
============================================================
Working today:
- Register / login JWT (bcrypt cost 12)
- Connections CRUD against demo connectors
- Unified chronological feed with platform / search / bookmark filters
- Like + bookmark
- Cross-post composer + publish history
- Dashboard overview
- Demo connectors for twitter, threads, bluesky, mastodon
- Railway + Vercel notes in DEPLOY.md
- Thin vitest suite for demo connectors only

Missing / weak:
- BRD v1.0 is referenced everywhere and is NOT in the repo. Reconstruct a living BRD from code comments (FD01, CP02, NF03, NF16, §5.x, §8) into docs/BRD.md. Do not block on a missing PDF.
- No live platform APIs
- No OAuth / app-password storage (Connection has handle + instance only; no encrypted token fields)
- No refresh tokens, email verify, password reset
- No real media upload
- No scheduler worker (PublishJob.scheduledAt exists, unused)
- No Postgres migrations story in CI
- No web tests
- Auth plugin is minimal
- Default deploy branch in DEPLOY.md is a leftover Cursor branch name; prefer main (or document the real default)

============================================================
3. NORTH STAR (what "done" means after 1242 hours)
============================================================
A person can:
1. Create an account, verify email, reset password.
2. Connect Bluesky with an app password and see a real timeline.
3. Connect Mastodon via OAuth on a user-supplied instance and federate a real timeline.
4. Connect X, Threads, and Instagram when developer apps exist; until then those cards show "waiting on credentials" and still work in demo mode.
5. Cross-post text + images (and video where supported) to any connected subset, with per-platform limits and partial-failure reporting.
6. Schedule a post, edit/cancel it before fire time, and see history.
7. Like / reply / repost / bookmark against live APIs where the platform allows it.
8. Use a unified chronological feed with cursor pagination, filters, and search that does not collapse when one platform errors.
9. Run production on Vercel (web) + Railway or equivalent (API) + Postgres, with health checks, structured logs, and no secrets in git.
10. Pass lint, unit, and a small e2e smoke (register → connect demo → feed → compose → history).

============================================================
4. PHASE PLAN (work in order; do not skip ahead unless blocked)
============================================================

PHASE A — Foundation (hours 0–40)
A1. Create docs/CAMPAIGN.md, docs/BACKLOG.md, docs/BRD.md, docs/ARCHITECTURE.md.
A2. Add CI: typecheck, lint, test, build on PRs.
A3. Fix DEPLOY.md secrets and branch names. Expand .env.example with every var you will need later.
A4. Schema: add encrypted credential fields on Connection (accessToken, refreshToken, tokenExpiresAt, appPasswordEnc, scopes, metadata JSON). Do not store plaintext tokens. Use a server-side DATA_KEY.
A5. Connector registry that can mix demo + live per platform.
A6. Request ID + structured error shape { error, code, details? } on the API.
A7. Health/readiness already exists; keep /health cheap and add /ready that checks DB.

PHASE B — Auth hardening (hours 40–120)
B1. Refresh tokens (httpOnly cookie or rotating refresh table).
B2. Password reset + email verification (provider interface; console transport in dev).
B3. Rate-limit auth routes. Lockout after repeated failures.
B4. Session list / logout-all.
B5. Settings: change password, display name, theme (theme field already exists).

PHASE C — Live connectors, cheapest first (hours 120–400)
C1. Bluesky via @atproto/api and app password. fetchTimeline + publish. This is the first real win because it needs no OAuth app review.
C2. Mastodon OAuth 2.0 against a user-provided instance. fetchTimeline + publish + instance field already on Connection.
C3. X API v2 OAuth 2.0 PKCE. Implement fully; gate on env TWITTER_CLIENT_ID/SECRET.
C4. Instagram (via Instagram Graph API) and Threads OAuth. Same pattern. Gate on env.
C5. Per-connector: retries, 429 backoff, token refresh, circuit-breaker so one dead platform cannot block /api/feed.
C6. Connection UI: connect, reconnect, disconnect, last-error, last-synced-at.

PHASE D — Feed quality (hours 400–620)
D1. Sync worker: pull timelines into FeedPost on a cadence; /api/feed reads DB, not live APIs on every request.
D2. Cursor pagination that is stable.
D3. Dedup by platform+externalId.
D4. Media rendering: images first; video later as embedded links or previews (depending on platform API).
D5. Reply thread drawer (read-only first, then post replies where API allows).
D6. Search that is not a naive substring on the current page.

PHASE E — Publishing system (hours 620–860)
E1. Use PublishJob + PublishTarget for all sends (they already exist).
E2. Immediate send + scheduled send. Add a worker loop (node cron or a /internal/tick protected by CRON_SECRET).
E3. Media upload pipeline: store objects (local disk in dev, S3-compatible in prod), pass platform-native uploads in connectors. Support images and video where the platform allows.
E4. Per-target status in the composer and history: pending / success / failed + error text + latencyMs.
E5. Character-limit preview per selected platform in the composer (limits already in web/lib/platforms.tsx; add Instagram 2200).
E6. Idempotency keys so double-click does not double-post.

PHASE F — Product surface (hours 860–1040)
F1. Analytics that are real: posts sent, success rate, per-platform latency, feed volume. Dashboard route already exists — make the numbers true.
F2. Bookmarks and likes persisted and, where possible, mirrored to the platform.
F3. Keyboard composer, empty states, error toasts, optimistic UI that rolls back.
F4. Light/dark theme wired to User.theme.
F5. Public landing page polish without turning it into a marketing site rewrite.
F6. Web tests: Playwright smoke against demo connectors.

PHASE G — Production + agent hygiene (hours 1040–1242)
G1. Switch datasource to postgresql behind DATABASE_URL; add real Prisma migrations; keep SQLite path for local.
G2. Harden Railway/Vercel docs. Remove leftover branch names. Add preview deploys.
G3. Observability: pino logs, basic metrics, error reporting hook.
G4. Security pass: CSP, CORS exact origins, JWT_SECRET rotation notes, encrypted tokens at rest, no secrets in logs.
G5. If time remains: improve autonomous_agent.py so it can edit apps/** (not only generated/), open small PRs, and run npm test. Do this last. The product is NEXUS, not the agent.
G6. Final week: freeze features, fix bugs, write OPERATOR.md (how to run, env matrix, how to add a fifth platform).

============================================================
5. OPERATING LOOP (repeat forever)
============================================================
while campaign_hours < 1242:
  1. Re-read CAMPAIGN.md.
  2. Choose ONE backlog item.
  3. Write a failing test or a checklist in the PR body.
  4. Implement the smallest slice that makes that test pass.
  5. npm run lint && npm test && npm run build
  6. Commit in small, reviewable commits. Open or update a PR if you are on a branch.
  7. Log the slice in CAMPAIGN.md:
     - Date / session id
     - Item id
     - Files touched
     - Commands run + results
     - Blockers
     - Exact next command for the next agent
  8. If blocked on a human (API keys, app review), park it and take the next unblocked item.

Definition of a finished slice:
- Typecheck + lint + tests green
- Demo account still logs in
- Demo connectors still work with zero third-party keys
- README / .env.example updated if behavior or env changed
- No leftover debug
- CAMPAIGN.md next-step is a single sentence a new agent can execute

============================================================
6. FILE MAP (edit these; do not create a parallel app)
============================================================
apps/api/src/connectors/     PlatformConnector implementations
apps/api/src/routes/         auth, connections, feed, posts, dashboard
apps/api/prisma/schema.prisma
apps/web/app/                landing, login, register, dashboard pages
apps/web/components/         Composer.tsx, PostCard.tsx
apps/web/lib/api.ts          API client
apps/web/lib/platforms.tsx   brand + limits
Keep package.json workspaces. Do not split into a new monorepo.

============================================================
7. HARD STOPS
============================================================
Stop and write a blocker note instead of guessing when you would otherwise:
- commit a real secret
- call a live social API with fabricated tokens
- delete demo connectors
- rewrite Fastify → Nest or Next → Vite "for cleanliness"
- store OAuth tokens in plaintext
- push --force to main
- spend more than ~4 hours on a slice without a test or a visible UI change

============================================================
8. START NOW
============================================================
Create the docs files if missing, reconstruct BRD.md from in-code requirement IDs,
add CI, then implement Phase A4–A5 (encrypted connection credentials + connector registry).
When that PR is green, begin Phase C1 (Bluesky live connector) unless auth tests are still red.
```

### Operational notes for running this charter across sessions

No single agent session runs for 1242 continuous hours. In practice this
charter is executed as a long series of individual sessions/turns, each
scoped to one backlog slice, chained together by a recurring scheduled
trigger that resumes the branch's work. Every session must therefore:

- Assume it has no memory of prior sessions beyond what's written in
  `docs/CAMPAIGN.md` and `docs/BACKLOG.md` — write those files as if briefing
  a stranger.
- Never assume a previous session's uncommitted work is still on disk —
  check `git status` and `git log` first.
- End by leaving the working tree in a state where `npm run lint && npm test
  && npm run build` are green, whether or not the session's item finished —
  if it didn't finish, revert to the last green state or commit behind a
  clearly-marked WIP note in `CAMPAIGN.md`, never leave a broken build for
  the next session to inherit.
