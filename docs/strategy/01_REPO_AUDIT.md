# 01 — Repo Audit: Deep Dive into `Mangu-Platforms/centuries`

Audited at commit `460223c` (merge of PR #5, "Phase C2: live Mastodon OAuth connector", 2026-08-26). Every claim below traces to a file read directly from the repository.

---

## 1. What this repository actually contains

Two independent things live in one repo:

1. **NEXUS** — the product. A full-stack social media aggregator under `apps/api` (Fastify 5 + Prisma + TypeScript) and `apps/web` (Next.js 14 App Router + Tailwind). This is the primary codebase.
2. **`autonomous_agent.py`** — the original single-file Python GitHub Action (OpenAI + GitHub client; opens PRs into `generated/`). The charter explicitly demotes it: *"Do NOT treat autonomous_agent.py as the product."* It is legacy scaffolding.

The repo is being built by an **autonomous AI build campaign**: commits are authored by "Claude", merged via PRs by Max Oza (`redinc23`), governed by a written 1,242-hour charter in `AGENTS.md`, with a session log (`docs/CAMPAIGN.md`, ~91 KB) and a statused backlog (`docs/BACKLOG.md`). Campaign start: 2026-08-25. This is a genuinely rare artifact — a long-horizon agentic build with checkpoint discipline, and it is working.

## 2. The PRD hunt — found, with a twist

| Document | Role | Status |
|---|---|---|
| `docs/BRD.md` | Business Requirements Document v1.0-r1 | **Found — but it is a reconstruction.** The original "BRD v1.0" cited across the codebase (README, code comments, landing-page footer) was lost; no source copy exists. The current file was reverse-engineered from requirement IDs actually cited in code (`FD01–FD06`, `CP01–CP04`, `NF03`, `NF16`, `DS01–DS04`, §5.5, §5.6, §8), with gaps marked **[inferred]**. It is explicitly declared the living source of truth going forward. |
| `AGENTS.md` (charter section) | The real north star — phases A–G, non-negotiables, "definition of done after 1,242 hours" | Found, authoritative |
| `docs/BACKLOG.md` | Statused work items (TODO / IN PROGRESS / DONE / WAITING-ON-HUMAN / BLOCKED) | Found, current |
| `docs/CAMPAIGN.md` | Session-by-session build log | Found (not fully quoted here; 91 KB) |
| `docs/ARCHITECTURE.md` | System architecture + boundary rationale | Found |
| `README.md`, `DEPLOY.md`, `AGENTS.md` (ops section) | Runbook-lite, deploy notes (Vercel + Railway + Postgres) | Found |

**Implication:** the repo's product definition is a *utility spec* recovered from code. There is no vision document, no market analysis, no business model, no design system spec, no privacy/security policy, no mobile spec. Doc 08 in this pack sequences exactly what to procure.

## 3. Current state, verified against the backlog and commit history

### Shipped and green (Phases A + B complete)
- **A1–A7 Foundation:** docs suite; CI (`.github/workflows/ci.yml`: typecheck, lint, test, build; now + a gated Playwright `e2e` job); DEPLOY.md secret rotation to placeholders; encrypted credential columns on `Connection` (`accessTokenEnc`, `refreshTokenEnc`, `tokenExpiresAt`, `appPasswordEnc`, `scopes`, `metadata`) with AES-256-GCM via server-side `DATA_KEY` (`src/lib/crypto.ts`); connector registry (`src/connectors/registry.ts`) mixing demo + live per platform; request IDs + structured error shape; `/health` and `/ready` (DB-checked).
- **B1–B5 Auth hardening:** 15-minute access JWTs + rotating hashed refresh tokens in an httpOnly cookie with **reuse-after-rotation theft detection** (reuse revokes all sessions); password reset + email verification (hashed single-use purpose-checked tokens; `EmailProvider` interface with console transport); per-IP rate limits + per-account lockout (5 fails → 15-minute lock, checked *before* password compare); session list / per-session revoke / logout-all-others; change password (revokes other sessions, keeps current). A real bug was found and regression-tested during B4: direct revocation was misread as token theft, which would have cascaded "log out this device" into "log out every device."

### Shipped in Phases C–F (out of order where unblocked)
- **C1 Bluesky live connector** (`@atproto/api`, app password) — code complete, unit-tested against real SDK types; **never run against production bsky.social** (parked as C1a, WAITING-ON-HUMAN).
- **C2 Mastodon OAuth** (`masto` SDK; per-instance dynamic app registration; state round-tripped through an AES-256-GCM-encrypted param with 10-min TTL; unauthenticated callback route) — code complete; **never clicked through against a live instance** (C2a, WAITING-ON-HUMAN).
- **D1 Sync worker** — 5-minute `unref()`'d interval started only in `server.ts`; connections self-heal error→active. **D2** stable cursor pagination (`postedAt DESC, id DESC` — with an honest SQLite-vs-Postgres caveat documented in the test). **D3** dedup unique constraint `(userId, platform, externalId)` + upsert importer that refreshes engagement counts but never clobbers local `liked`/`bookmarked`/`isOwn`. **D4** image rendering (MediaGrid: 1/2/3/4-image layouts; demo connector now emits deterministic inline-SVG sample images; verified by headless-browser screenshot).
- **E2 Scheduled sends** — found a real bug: `scheduledAt` was stored but ignored (everything published immediately). Fixed; targets start `pending`; external-cron `POST /internal/tick` with timing-safe `CRON_SECRET` (deliberately not an in-process timer, so a redeploy can't eat a scheduled post). **E6 Idempotency keys** — race-safe (concurrent duplicate hits the unique constraint and returns the winner); composer sends a per-mount UUID. Fixing E6's test surfaced and fixed a repo-wide SQLite parallel-write flake (`fileParallelism: false`).
- **F4 Theme** (verified pre-existing, backlog corrected from stale TODO). **F6 Playwright golden-path smoke** (register → connect demo → feed → compose → history) wired into CI.

### Open (the remaining ~85% of the charter)
C3 (X OAuth PKCE — WAITING-ON-HUMAN: dev app), C4 (Threads/Instagram — WAITING-ON-HUMAN: Meta app), C5 (retries/backoff/circuit breaker), C6 (connection health UI incl. surfacing the API's existing `warning` field — C1b), D4-video, D5 (reply thread drawer), D6 (real search), E3 (media upload pipeline), E4 (per-target status polish), E5 (Instagram 2200 in web `PLATFORM_META`), F1 (real analytics), F2 (mirror likes/bookmarks to platforms), F3 (toasts/optimistic UI/empty-state polish), F5 (landing polish), G1–G6 (Postgres migrations, deploy hardening, observability, security pass, agent upgrade, OPERATOR.md), A6b (error `code` in per-route validation), B2a (real email provider).

## 4. Architecture assessment

**The one decision that makes this codebase valuable:** the `PlatformConnector` seam (`connectors/types.ts`: `fetchTimeline(ctx, limit)` / `publish(ctx, content, mediaUrls)`). All platform-specific code is quarantined behind it; routes, sync worker, and scheduler only ever see the interface; the registry resolves live-if-credentialed, demo otherwise. Adding a sixth network is a one-file change. **Demo connectors are permanent product, not scaffolding** — the app can never "go dark," which is also the growth wedge (try everything with zero credentials).

Other sound calls: fail-fast char-limit validation before any network call; per-target partial-failure reporting (no fake atomicity across networks); `PublishJob`/`PublishTarget` as a durable publishing ledger; provider-agnostic Prisma (SQLite→Postgres); shared helpers extracted at exactly the right moments (`timelineImport.ts`, `publish.ts`) instead of premature abstraction; monorepo via plain npm workspaces per the "no new frameworks" rule.

**Deliberate debts, correctly logged:** `PLATFORMS` (API) and `PLATFORM_META` (web) are hand-synced twins; search is a substring `contains` scan; feed reads only the local `FeedPost` cache; no queue system (cron-tick only); no structured logging/metrics; no migrations (still `db push`); web has one e2e test and zero unit tests.

## 5. Risks and blockers (full register in doc 05)

1. **Human-gated validation** — the two cheapest wins in the entire program (C1a: paste one Bluesky app password; C2a: click one Mastodon consent screen) have been waiting on a human since 2026-08-26. Until then, "live connectors" are correct-by-construction, unproven in production.
2. **Platform dependency** — X API access is paid and volatile; Threads/Instagram require Meta app review. The charter already handles this correctly (env-gated, waiting-state UI, demo fallback), but it is the defining business risk (doc 07 §4).
3. **Brand fragmentation** — Centuries (repo) vs. NEXUS (product) vs. Mangu Platforms (org).
4. **No default branch hygiene resolved** — A3 flagged that the deploy branch was a leftover Cursor branch name and the repo has no `main`; renaming was deliberately left to a human.
5. **Secret history** — DEPLOY.md once contained a hardcoded `JWT_SECRET`; the *documented example* was rotated to a placeholder (A3), but any environment that ever used the leaked value must rotate (assume compromised).
6. **Production is a plan, not a fact** — no deployed environment, no Postgres migration history, no observability (G1–G3 open).

## 6. Verdict

For its stage this is a **top-decile repository**: coherent architecture, security posture years ahead of typical seed code, tests that exist because bugs were actually caught by them, and a written operating system (charter + backlog + campaign log) that lets any agent or human resume cold in minutes. What it lacks is not quality but **scope and articulation of the ambition** — the network layers, the business layers, and the vision documents. Those are exactly what the rest of this pack supplies.
