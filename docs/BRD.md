# NEXUS — Business Requirements Document (reconstructed) v1.0-r1

> **Provenance note.** The original `BRD v1.0` referenced throughout the codebase
> (README, code comments, the landing page footer) is not present in this repository
> and no source copy has surfaced. This document reconstructs it from every
> requirement ID and section reference actually cited in code
> (`FD01`, `FD02`, `FD04`, `FD06`, `CP02`, `NF03`, `NF16`, `DS03`, §5.5, §5.6, §8) plus
> the behavior those code paths implement today. IDs that are cited but whose
> neighbors are not (e.g. `FD03`, `FD05`) are filled in from the shipped behavior
> and marked **[inferred]**. Treat this as the living source of truth going
> forward — update it in the same PR whenever behavior changes. Do not wait for
> the original document to reappear.

## 1. Product summary

NEXUS is a unified social media aggregator. A single account lets a user view a
chronological feed merged from multiple connected platforms, engage with posts,
and cross-post one message to several platforms at once with per-platform limit
enforcement and per-target success/failure reporting.

## 2. Supported platforms (§8 — Platform Integration Specs)

| Platform | Auth model | Character limit | Status |
| --- | --- | --- | --- |
| Twitter / X | OAuth 2.0 (PKCE) | 280 | Demo connector shipped; live connector planned (Phase C3) |
| Threads | Instagram OAuth | 500 | Demo connector shipped; live connector planned (Phase C4) |
| Bluesky | App password (AT Protocol) | 300 | Demo connector shipped; live connector planned (Phase C1) |
| Mastodon | OAuth 2.0, user-supplied instance | 500 | Demo connector shipped; live connector planned (Phase C2) |
| Instagram | Instagram Graph API | 2200 (caption) | **[inferred]** Not yet a connector target; added to scope by the 1242h build charter |

Character limits are enforced server-side at publish time and are the single
source of truth (`apps/api/src/config.ts` `PLATFORMS`, mirrored in
`apps/web/lib/platforms.tsx` `PLATFORM_META` for the composer preview).

## 3. Functional requirements

### 3.1 Feed (FD — "Feed Discovery")

- **FD01** — Unified feed: posts from every connected platform are merged into
  one chronological list, newest first.
- **FD02** — Cursor-based pagination: the feed is paginated by opaque cursor
  (post id), not offset, so it stays stable as new posts arrive.
- **FD03** **[inferred]** — Engagement actions (like, bookmark) are available
  per post and persist across sessions.
- **FD04** — Platform filter: the feed can be scoped to a single platform or
  "all".
- **FD05** **[inferred]** — Bookmark filter: the feed can be scoped to
  bookmarked posts only.
- **FD06** — Search: the feed can be filtered by a text query against post
  content.

Implemented in `apps/api/src/routes/feed.ts`. Today search is a `contains`
substring match (Phase D6 upgrades this to something that isn't a naive
substring scan). Today `/api/feed` queries live connectors' cached rows in
`FeedPost`, populated at connection time and cross-post time — there is no
background sync worker yet (Phase D1).

### 3.2 Cross-posting (CP — "Cross-Post"), §5.5

- **CP01** **[inferred]** — A user composes one message and selects any subset
  of their connected platforms to publish to.
- **CP02** — Per-platform character limits are validated before publish; a
  post that exceeds any selected platform's limit is rejected with a
  platform-specific error before any network call is made.
- **CP03** **[inferred]** — Partial failure reporting: each selected platform
  is published independently; a failure on one platform does not block or roll
  back the others, and results are reported per platform
  (`status`, `externalId`, `error`, `latencyMs`).
- **CP04** **[inferred]** — A user's own cross-posts appear in their unified
  feed (`FeedPost.isOwn = true`).

Implemented in `apps/api/src/routes/posts.ts`. `PublishJob` /
`PublishTarget` already model scheduled sends (`scheduledAt`) but nothing
consumes that field yet — there is no scheduler worker (Phase E2).

### 3.3 Dashboard, §5.6

- Overview of connected platforms, aggregate engagement (likes/reposts/replies
  summed across the feed), publish job count, and cross-post success rate.
  Implemented in `apps/api/src/routes/dashboard.ts`. Numbers are currently
  computed from demo-connector data; Phase F1 makes every number reflect live
  connector activity (latency percentiles, real success/failure counts).

### 3.4 Connections

- CRUD over platform connections: connect (handle + optional instance +
  optional credential), list, disconnect. Connecting triggers an initial
  timeline import so the feed is non-empty immediately.
  Implemented in `apps/api/src/routes/connections.ts`. `Connection` does not
  yet persist encrypted OAuth/app-password credentials (Phase A4 adds this);
  today `credential` is accepted but discarded outside demo mode.

### 3.5 Authentication

- Email + password registration and login, JWT bearer tokens (7‑day expiry
  today), `GET/PATCH /api/auth/me` for profile + theme.
  Refresh tokens, email verification, and password reset are **not yet
  implemented** (Phase B1–B2).

## 4. Non-functional requirements (NF)

- **NF03** — Publish latency target: under 3 seconds per platform target.
  Demo connectors simulate this; live connectors must meet it or surface a
  clear timeout/error rather than hanging the request (Phase C5: retries,
  429 backoff, circuit breaker).
- **NF16** — Passwords are hashed with bcrypt at cost factor 12. No plaintext
  password or platform credential may ever be persisted or logged. OAuth
  tokens and app passwords must be encrypted at rest (Phase A4).
- **NF-availability [inferred]** — One dead/erroring platform connector must
  never make `/api/feed` or `/api/dashboard` fail entirely for the other
  connected platforms.
- **NF-accessibility [inferred]** — Every new UI surface ships with keyboard
  operability, labels, visible focus rings, and sufficient contrast.
- **NF-secrets [inferred]** — No secret (JWT signing key, OAuth client secret,
  app password, DATA_KEY) is ever committed to the repository; all are
  supplied via environment variables and documented in `.env.example`.

## 5. Data requirements (DS — "Data Storage")

- **DS01 [inferred]** — `User`: account, profile, theme.
- **DS02 [inferred]** — `Connection`: one row per (user, platform, handle),
  plus per-connection health (`status`, and Phase C6's `lastError` /
  `lastSyncedAt`).
- **DS03** — `PublishJob` + `PublishTarget`: every publish attempt (immediate
  or scheduled) is recorded with one job and one target row per platform,
  giving durable publishing history (`GET /api/posts/history`).
- **DS04 [inferred]** — `FeedPost`: the local cache of remote posts that
  backs the unified feed; deduplicated by `(platform, externalId)` once Phase
  D3 lands (schema already has the fields; the unique constraint is a
  Phase D3 migration).

## 6. Out of scope for v1

- Direct messaging across platforms.
- Cross-platform analytics beyond what §5.6 / Phase F1 defines.
- Multi-account (more than one login per platform per user) — the schema's
  `@@unique([userId, platform, handle])` allows multiple handles per platform
  per user already, but no UI distinguishes "primary" vs. "secondary" handles.

## 7. Change log

- v1.0-r1 (this document): reconstructed from code by the 1242-hour NEXUS
  build charter, first session. Original BRD v1.0 source not recovered.
