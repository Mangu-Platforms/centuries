# 10 — Full Stack Code (Procured) + List of Skills

## 1. Where the full stack code is
The complete, working full-stack codebase already exists and is procured by:
```bash
git clone https://github.com/Mangu-Platforms/centuries.git
cd centuries && npm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
npm run db:setup      # Prisma push (SQLite) + seed demo account
npm run dev           # API :4000, web :3000  →  demo@nexus.app / password123
```
Audited head: commit `460223c` (PR #5 merged 2026-08-26).

## 2. Complete code inventory (what you own today)
```
apps/api/                        Fastify 5 + Prisma + TypeScript (REST API)
  src/server.ts                  entrypoint; starts sync scheduler after listen
  src/app.ts                     buildApp(): CORS, JWT, routes, /health, /ready, /api/platforms,
                                 request IDs, global error envelope, live-connector registration
  src/config.ts                  env config + PLATFORMS map (id→name/color/charLimit/auth) — API source of truth
  src/db.ts                      Prisma client singleton
  src/seed.ts                    demo account + demo timelines
  src/plugins/auth.ts            @fastify/jwt + authenticate preHandler
  src/routes/
    auth.ts                      register/login/me(PATCH)/refresh/logout/change-password + lockout
    accountRecovery.ts           password-reset request/confirm; email verify request/callback
    sessions.ts                  session list / revoke one / logout-all-others
    connections.ts               CRUD + initial timeline import + graceful bad-credential warning
    mastodonAuth.ts              per-instance OAuth register + callback (encrypted state, 10-min TTL)
    feed.ts                      unified feed (cursor/platform/search/bookmarked) + like/bookmark
    posts.ts                     cross-post (limits, idempotency, scheduledAt) + history
    dashboard.ts                 overview stats
    internal.ts                  POST /internal/tick (CRON_SECRET, timing-safe) scheduled sends
  src/connectors/
    types.ts                     PlatformConnector { fetchTimeline, publish }  ← THE SEAM
    registry.ts                  demo-vs-live resolution; registerLiveConnector()
    demo.ts                      deterministic demo connectors (incl. SVG avatars + sample images)
    bluesky.ts                   live AT Protocol connector (@atproto/api, app password)
    mastodon.ts                  live Mastodon connector (masto SDK)
  src/lib/
    crypto.ts                    AES-256-GCM encrypt/decrypt (DATA_KEY)
    refreshTokens.ts             rotation, reuse-detection, session queries
    verificationTokens.ts        hashed single-use purpose-checked tokens
    loginLockout.ts              per-account lockout
    email.ts                     EmailProvider interface + ConsoleEmailProvider
    timelineImport.ts            dedup-aware upsert importer (connect-time + sync share it)
    sync.ts / syncScheduler.ts   periodic feed sync + 5-min unref'd interval
    publish.ts                   attemptPublish + runDueScheduledSends (immediate & tick share it)
  src/__tests__/                 vitest: connectors, auth, refresh, sessions, recovery,
                                 change-password, feed, posts, tick, sync, idempotency
  prisma/schema.prisma           User, RefreshToken, VerificationToken, Connection,
                                 FeedPost, PublishJob, PublishTarget
  vitest.config.ts               fileParallelism:false (SQLite lock-flake fix)

apps/web/                        Next.js 14 App Router + Tailwind
  app/  page.tsx (landing) · login · register · forgot-password · reset-password
        dashboard/{layout,page} · dashboard/feed · dashboard/connections · dashboard/settings
  components/Composer.tsx        modal composer (targets, char rings, results, idempotency UUID)
  components/PostCard.tsx        post + like/bookmark + MediaGrid (1/2/3/4 image layouts)
  lib/api.ts                     fetch wrapper; credentials:include; shared single-flight 401→refresh retry
  lib/auth.tsx                   auth context; theme class toggling; session restore via refresh cookie
  lib/platforms.tsx              PLATFORM_META + glyphs — web mirror of PLATFORMS
  e2e/smoke.spec.ts + playwright.config.ts   golden path against real demo stack

.github/workflows/ci.yml         typecheck + lint + test + build, then gated Playwright e2e job
docs/  BRD.md · ARCHITECTURE.md · BACKLOG.md · CAMPAIGN.md
AGENTS.md (charter) · README.md · DEPLOY.md · railway.json
autonomous_agent.py              legacy Python GitHub Action (explicitly not the product)
```

## 3. Stack — current, and the future-state additions
| Layer | Today (pinned, working) | Enterprise future state adds |
|---|---|---|
| Frontend | Next.js 14 App Router, React 18, TS, Tailwind | Design-token system; TanStack Query; command palette; deck layout |
| Backend | Fastify 5, Node 20+, TS, Zod | Public OpenAPI; SSE for live target status; webhooks |
| Data | Prisma 6; SQLite dev → Postgres 15 prod | Real migrations (G1); partitioning; rollup tables; `tsvector` search (→ Meilisearch if needed) |
| Auth | @fastify/jwt, bcrypt 12, rotating refresh cookies | Passkeys/2FA; OAuth login; SAML/OIDC + SCIM (enterprise) |
| Connectors | @atproto/api (Bluesky), masto (Mastodon), demo engine | twitter-api-sdk (X, PKCE), Meta Graph (Threads/IG), community SDK |
| Jobs | 5-min sync interval + external-cron `/internal/tick` | Redis + BullMQ (per-connection queues, backoff, DLQ) |
| Media | — (E3 next) | S3-compatible storage, sharp processing, EXIF strip, alt-text pipeline |
| Email | Console provider | Resend/Postmark provider (B2a) |
| Observability | request IDs; /health /ready | pino structured logs, OpenTelemetry, Sentry, metrics + SLO dashboards (G3) |
| Testing | vitest suites + Playwright smoke in CI | connector contract tests on recorded fixtures; load tests; a11y tests |
| Deploy | Vercel (web) + Railway (API) documented | Preview deploys, IaC, multi-region, self-hosted Docker edition |
| Mobile | — | React Native/Expo, share-sheet extension, push |
| AI | — | provider-abstracted assist endpoints w/ per-plan quotas |

## 4. List of skills

### 4a. Engineering skill matrix (human or agent — everything below is demonstrably in use or next-required)
TypeScript (strict) · Node 20 · Fastify plugin architecture · Prisma schema design & provider-agnostic querying · SQLite→Postgres migration craft · REST API design + Zod validation + error-envelope discipline · AuthN/AuthZ: JWT lifecycles, refresh rotation & theft detection, bcrypt, lockout, rate limiting · Applied crypto: AES-256-GCM, key management, timing-safe comparison · OAuth 2.0 + PKCE, dynamic client registration, encrypted state params · AT Protocol / ActivityPub API literacy · Idempotency & concurrency control (unique-constraint races, single-flight refresh) · Background processing: cron-tick design, interval hygiene, later BullMQ/Redis · React 18 + Next.js App Router + Tailwind · Accessibility (WCAG: keyboard, labels, focus, contrast) · Testing: vitest, Playwright, contract tests, flake forensics · CI/CD (GitHub Actions), npm workspaces · Object storage + image pipelines · Observability (pino, OTel, Sentry, SLOs) · Security engineering (threat modeling, CSP, secret rotation) · Mobile (React Native/Expo) · Data/analytics rollups · Technical writing (the repo's own docs prove the bar).

### 4b. Non-engineering skills the enterprise path requires
Product management (PRD v2, roadmap discipline) · Product design (design system, Figma) · UX research · Brand & positioning · Growth/community (Bluesky + fediverse native) · Pricing & finance modeling · Legal/compliance (privacy, platform policy, SOC 2) · Support operations · Trust & safety policy · Partnerships (platform developer relations).

### 4c. Agentic-build skills (the meta-layer that is actually producing this product)
Charter authoring (phases, non-negotiables, hard stops) · Backlog state discipline (TODO/DONE/WAITING-ON-HUMAN) · Session log writing ("brief a stranger") · Checkpoint + cold-resume protocol · Evidence-based completion (tests + screenshots, never "should work") · Stall detection and honest blocker escalation · Human-unlock batching. In this workspace these map to the installed skills: `relentless-plan-to-production` (the endurance operating model this pack was produced under), `prosper-orchestrator`, `frontend-design` (used for the UI prototype), plus the document/production skills (`docx`/`pdf`/`xlsx`/`pptx`) for future formal deliverables.

## 5. Minimal team to reach enterprise state
One product founder (you: vision, brand, human unlocks, taste) + the agentic pipeline for engineering throughput + first hires in order: product designer (mo 1–2), growth/community operator (mo 2–3), support/T&S operator (~1k users), enterprise/compliance lead (mo 9+). The commit history argues the engineering seat is already occupied.
