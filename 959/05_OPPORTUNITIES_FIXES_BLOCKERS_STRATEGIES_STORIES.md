# 05 — End-to-End: Opportunities · Fixes · Blockers · Strategies · Build Recommendations · User Stories

## A. BLOCKERS (things that stop progress today, ranked by cheapness to clear)
1. **C1a — Bluesky live validation.** One human pastes one app password from a test account. ~10 minutes. Unlocks the first *real* network.
2. **C2a — Mastodon live validation.** One human clicks through one OAuth consent screen on any public instance. ~10 minutes. No developer registration needed (NEXUS self-registers per instance).
3. **B2a — Email provider.** Create a Resend/Postmark account, set env vars, implement one `EmailProvider`. ~1 hour. Unlocks real password reset + verification.
4. **C3 — X developer app.** Apply for API access; pricing tier decision required (see doc 07). Days-to-weeks, money.
5. **C4 — Meta developer app** (Threads + Instagram). App review process. Weeks.
6. **No production environment.** Railway + Vercel + Postgres not provisioned; G1 migrations not written. ~1–2 days once decided.
7. **Branding unresolved** (Centuries vs NEXUS vs Mangu) — blocks domain, app-store names, legal docs.
8. **Repo default branch** never renamed to `main` (deliberately left to a human in A3).

## B. FIXES (defects & debts, priority order)
1. Rotate any environment that ever used the historical hardcoded `JWT_SECRET` from old DEPLOY.md (docs fixed; live secrets must be assumed burned).
2. **C1b:** surface the connections API `warning` field in the UI — silent live-credential failures are invisible today.
3. Disconnect has no confirmation dialog (one accidental tap deletes a connection + its OAuth grant).
4. Lockout (423 + `retryAfterSeconds`) has no countdown UI on `/login`.
5. **A6b:** per-route validation errors still return legacy `{error}` without `code`/`requestId`.
6. `PLATFORMS` (api) ↔ `PLATFORM_META` (web) hand-sync — add a CI drift check (script compares JSON) before it bites; Instagram (E5) must land in both.
7. D6: search is a substring scan on the current page's query — misleading at scale.
8. No web unit tests (only the e2e smoke); no tests for `lib/auth.tsx` refresh race logic.
9. `FeedPost.mediaUrls` is a JSON string column — fine for SQLite, migrate to `Json`/`text[]` in the G1 Postgres migration.
10. Sync interval is a fixed constant; add jitter so all connections don't sync in the same instant at scale.
11. Feed images render remote URLs directly — add a media proxy/allowlist before live connectors ship widely (privacy: no user-IP leakage to third-party CDNs; safety: strip EXIF on upload path).
12. No CSP/security headers yet (G4); CORS should pin exact origins in prod.
13. `autonomous_agent.py` constructs a GitHub client before argparse — `--help` fails without creds (fix only if G5 is ever reached; product first).

## C. OPPORTUNITIES (highest leverage, roughly ordered)
1. **Demo mode as growth engine** — the zero-credential full-product demo is a marketing weapon no incumbent has: put it on the landing page, unauthenticated.
2. **Protocol-first wedge** — Bluesky + Mastodon need no gatekeeper approval; ship live there this week while X/Meta queue.
3. **The Braid (identity)** — one public profile that braids all handles (`nexus.app/@you`) = shareable artifact = viral loop.
4. **Alt-text-by-default media** — accessibility as brand, and genuinely better posts.
5. **Per-target retry** — turn partial failure (already reported) into one-tap recovery; nobody does this well.
6. **Planner + queue slots** — the single most-paid-for feature in the category; the API half (E2) already works.
7. **Lenses/deck mode** — the Tweetdeck-shaped hole in the market since its paywalling.
8. **Open-core + self-host** — trust play for the fediverse audience; enterprise on-prem later.
9. **Connector SDK/marketplace** — let the community add LinkedIn/Farcaster/Nostr/RSS; the seam already exists.
10. **AI repurposing** (long-form → per-platform variants) — high willingness-to-pay, clean fit to the variants model.
11. **The agentic build itself is a story** — "an AI is building this in public under a 1,242-hour charter" is press.

## D. STRATEGIES (the plays)
1. **Sequence:** Validate live (C1a/C2a) → C5/C6 resilience + health UI → E3/E4 media + status → F1 real analytics → G1–G4 production → launch to Bluesky/Mastodon communities → Planner/Lenses → X/Meta connectors when approved → mobile → teams → enterprise.
2. **Positioning:** "Every network. One voice." Two-way client (read + write), not a scheduler.
3. **Pricing (initial hypothesis):** Free = 2 connections, 10 scheduled posts; Pro $12/mo = unlimited connections, planner, analytics, AI quota; Team $29/seat = approvals, workspaces; Enterprise = SSO/SCIM/self-host/SLA. Undercut Buffer/Hootsuite meaningfully.
4. **Risk hedge:** never let X/Meta be load-bearing for the value prop; open protocols are the foundation, gated giants are accelerants.
5. **Trust as moat:** encrypted-at-rest credentials, no plaintext ever, export-your-data, self-host option — say it loudly, prove it in docs.
6. **Keep the charter operating system** — the backlog/campaign discipline is why velocity is high; scale it (parallel agents per phase, human unblocks batched weekly).

## E. BUILD RECOMMENDATIONS (next 10 slices, in order — each one PR-sized)
1. C6+C1b: connection health (schema `lastSyncedAt`/`lastError`, sync writes them, UI card states, reconnect, disconnect confirm).
2. C5: retry w/ exponential backoff + jitter, 429 respect, per-connection circuit breaker (open after N fails, half-open probe), token-refresh hook.
3. E4: per-target pending→result UI + `POST /api/posts/:id/retry` (failed targets only).
4. Schedule popover in composer + Planner v0 (list view of upcoming, cancel/edit while pending).
5. E3: media pipeline (storage driver, `MediaAsset`, connector `uploadMedia`, composer rail w/ alt text) — images only.
6. E5: Instagram in `PLATFORM_META` + variants groundwork (`contentOverride`).
7. F1: real analytics (rollup table + latency percentiles + volume sparkline).
8. F3: toast system + optimistic rollback pattern applied to like/bookmark/publish.
9. G1: Postgres migrations + CI job running them against a service container.
10. G3+G4: pino structured logs w/ requestId, Sentry hook, CSP + exact CORS.

## F. USER STORIES (epics → stories with acceptance criteria)
**Epic 1 — Connect with confidence**
- As a Bluesky user, I connect with an app password and see my real timeline within 10 s, so I trust NEXUS with my account. *AC: live fetch succeeds; bad password shows the warning inline; credential stored encrypted only.*
- As a Mastodon user on any instance, I approve NEXUS on my own server and return connected. *AC: dynamic app registration; state tamper-proof; banner shows imported count.*
- As any user, when a connection breaks, I see when it last synced and why it failed, and can reconnect in one flow. *AC: lastError/lastSyncedAt visible; reconnect re-prompts credential; feed keeps serving other platforms.*

**Epic 2 — One post, everywhere**
- As a creator, I write once and publish to a chosen subset, seeing each network's limit as I type. *AC: shipped; per-pill countdown; server rejects over-limit pre-network.*
- As a creator, if one network fails, the others still post and I can retry just the failure. *AC: per-target results; retry endpoint re-attempts failed only; idempotent.*
- As a creator, I attach images with alt text and each platform receives native uploads. *AC: E3; alt text prompted; per-platform media rules enforced.*
- As a creator, I tailor the wording per platform without rewriting from scratch. *AC: variants tab; base content inherited; per-variant limits.*

**Epic 3 — Own my time**
- As a busy person, I schedule a post and trust it fires even if servers restart. *AC: shipped API (external cron); UI picker; visible in Planner; cancel/edit while pending.*
- As a marketer, I fill queue slots and NEXUS spaces my content automatically. *AC: per-platform slot config; next-slot default in composer.*

**Epic 4 — Read everything, miss nothing**
- As a reader, I scroll one chronological feed across all networks with no duplicates and no gaps. *AC: shipped (D1–D3); one platform erroring never empties the feed.*
- As a reader, I open a post and read its whole thread, replying where the network allows. *AC: D5; capability-gated reply.*
- As a power user, I save Lenses and arrange them as columns. *AC: persisted filters; deck layout; keyboard nav.*

**Epic 5 — Know what worked**
- As a creator, I see per-network success rates, latency, and my best-performing posts, with export. *AC: F1 + post-level table + CSV.*

**Epic 6 — Enterprise-ready**
- As a team lead, drafts route through approval before publishing, and every action is audited. *AC: role model; approval states on PublishJob; audit log.*
- As an IT admin, my org signs in with SSO and provisions via SCIM. *AC: SAML/OIDC; SCIM; session policies.*

**Epic 7 — Leave freely (trust)**
- As any user, I export everything and delete my account, and revoking NEXUS on a platform is honored immediately. *AC: JSON export; cascade delete; token invalidation handling.*
