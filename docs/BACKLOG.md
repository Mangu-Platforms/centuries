# NEXUS — Backlog

Source of truth for "what's next." Every item has a stable ID (`PHASE + number`,
e.g. `A4`) matching the phase plan in `AGENTS.md` / the build charter. Status is
one of `TODO`, `IN PROGRESS`, `DONE`, `WAITING-ON-HUMAN`, `BLOCKED`. When you
pick up an item, flip it to `IN PROGRESS` and leave your session's date next to
it; when you finish, flip it to `DONE` and log the slice in `CAMPAIGN.md`.

Pick the single highest-priority `TODO` item that is unblocked. Do not start
multiple items at once.

## Phase A — Foundation

| ID | Item | Status | Notes |
| --- | --- | --- | --- |
| A1 | docs/CAMPAIGN.md, BACKLOG.md, BRD.md, ARCHITECTURE.md | DONE (2026-08-25) | This file + siblings |
| A2 | CI: typecheck, lint, test, build on PRs | DONE (2026-08-25) | `.github/workflows/ci.yml` |
| A3 | Fix DEPLOY.md secrets + branch name; expand .env.example | DONE (2026-08-25) | Rotated `JWT_SECRET` example to a placeholder + `openssl rand` instructions; branch refs now say "your production branch" instead of the leftover Cursor name (repo has no `main` yet — flagged for a human to rename if desired, not scripted); `.env.example` documents `DATA_KEY`, gated OAuth vars, `CRON_SECRET` |
| A4 | Encrypted credential fields on Connection + DATA_KEY | DONE (2026-08-25) | `accessTokenEnc`, `refreshTokenEnc`, `tokenExpiresAt`, `appPasswordEnc`, `scopes`, `metadata` on `Connection`; `src/lib/crypto.ts` AES-256-GCM via `DATA_KEY`, dev-only deterministic fallback when unset (throws in prod if unset/invalid) |
| A5 | Connector registry (demo + live per platform) | DONE (2026-08-25) | `src/connectors/registry.ts`; `getConnector(platform, hasCredentials)` resolves live if registered+credentialed, else demo; `registerLiveConnector()` is the seam Phase C uses; routes/seed updated to import from the registry instead of `demo.ts` directly |
| A6 | Request ID + structured `{ error, code, details? }` shape | DONE (2026-08-25) | `genReqId` (uuid) + `x-request-id` header; global `setErrorHandler`/`setNotFoundHandler` in `app.ts`. Scope note: only uncaught/framework-level errors (404s, malformed JSON, thrown exceptions) got the new shape this slice — existing per-route Zod validation still returns its original `{ error }` shape. Propagating `code` through every route's validation responses is a good follow-up item, not done here (kept the slice small per the 4-hour-without-a-test-or-UI-change rule) |
| A7 | `/ready` endpoint (DB check) | DONE (2026-08-25) | `GET /ready` runs `SELECT 1`; `/health` untouched (still free) |

### Follow-up spun out of this session (not yet in a phase slot)

| ID | Item | Status | Notes |
| --- | --- | --- | --- |
| A6b | Propagate `code` through every route's manual validation error responses | TODO | Currently only the global handler (404, malformed body, uncaught throw) returns `code`/`requestId`; per-route `{error}` responses (register/login/connections/posts validation) don't yet. Low priority polish, not a correctness gap. |
| C1a | Real end-to-end validation of the Bluesky connector against production bsky.social | WAITING-ON-HUMAN | The connector is unit-tested against the real `@atproto/api` types/shapes but has never been run against a live account — needs a human to supply a real Bluesky app password for a test account (same credential the charter's "first human work" section calls for). Until then, treat C1 as "code complete, live-unverified." |
| C1b | Surface `connections.ts`'s new `warning` field in the web connect UI | TODO | Backend now returns `{ connection, importedPosts, warning? }` when a live credential is rejected (connection kept with `status: "error"`); `apps/web/app/dashboard/connections/page.tsx` doesn't read `warning` yet. Natural to fold into C6 (connect/reconnect/disconnect, last-error UI) rather than a one-off. |
| C2a | Real end-to-end validation of the Mastodon OAuth flow against a live instance | WAITING-ON-HUMAN | Register/callback/connector are unit- and route-tested with a mocked `masto` SDK, but the actual browser redirect dance (register → authorize on a real instance → approve → callback) has never run against a real Mastodon server. Needs a human to click through it once against a real (even freshly-created) account on any public instance — no developer app approval required, just a few clicks. |
| C2b | Mastodon media upload, reply/repost, per-connection sync cadence | TODO | Same E3/D1 scope as Bluesky — not connector-specific, tracked at the phase level already. |

## Phase B — Auth hardening

| ID | Item | Status | Notes |
| --- | --- | --- | --- |
| B1 | Refresh tokens | DONE (2026-08-26) | Access tokens now 15m JWTs (was 7d). New `RefreshToken` table (hashed, rotating, reuse-detection) backs a `nexus_refresh` httpOnly cookie scoped to `/api/auth` (`SameSite=None; Secure` in prod for the cross-origin Vercel/Railway split, `Lax` in dev). `POST /api/auth/refresh` rotates the cookie + mints a new access token; reuse of an already-rotated token revokes *all* of that user's sessions, not just the reused one. `POST /api/auth/logout` revokes the presented token. Web: `lib/api.ts`'s `request()` now sends `credentials: "include"` and silently retries a single 401 through `tryRefresh()` (a shared in-flight promise, so concurrent 401s across components don't race two refreshes against the same rotating cookie); `lib/auth.tsx`'s `refresh()` always calls `api.me()` on mount (no more "skip if no local token" guard), so a session survives a fresh tab / reload with no access token in memory as long as the refresh cookie is valid; `logout()` is now async and calls `api.logout()` before clearing local state. 10 new API tests (`refreshTokens.test.ts`) cover cookie flags/TTL, rotation, reuse-detection (incl. revoking a second, independent session), expiry, and logout. No new env vars — cookie `secure`/`sameSite` derive from existing `config.isProd`. |
| B2 | Password reset + email verification | TODO | Provider interface, console transport in dev |
| B3 | Rate-limit auth routes + lockout | TODO | `@fastify/rate-limit` |
| B4 | Session list / logout-all | TODO | Unblocked now that B1 is done — `RefreshToken` already has `userAgent`/`ipAddress` per row for a session-list UI; "logout all" is `revokeAllForUser()` in `lib/refreshTokens.ts`, already written and used by the reuse-detection path, just needs a route |
| B5 | Settings: change password, display name, theme | TODO | Theme field exists; wire UI |

## Phase C — Live connectors

| ID | Item | Status | Notes |
| --- | --- | --- | --- |
| C1 | Bluesky live connector (`@atproto/api`, app password) | DONE (2026-08-26) | `src/connectors/bluesky.ts`; registered via `registerLiveConnector`, imported once in `app.ts`. fetchTimeline + publish (text-only; images are Phase E3), stateless login-per-call. Real `@atproto/api` types verified against the installed package (`Agent`/`AtpAgent` classes, `getTimeline`/`post` signatures, `FeedViewPost`/`PostView`/image-embed shapes) — not guessed from memory. Unit-tested with a mocked `AtpAgent` (no live network calls made anywhere in this repo or by me during development — no Bluesky test account credential was available or used). `connections.ts`'s initial-fetch now catches a rejected live credential gracefully (connection kept, `status: "error"`, `warning` in the response) instead of 500ing. **End-to-end validation against the real Bluesky API still needs a human to supply a real test account app password** — the code is correct by construction against the SDK's types and documented shapes, but has not been run against production bsky.social. |
| C2 | Mastodon OAuth 2.0 (user-supplied instance) | DONE (2026-08-26) | `src/connectors/mastodon.ts` (via the `masto` npm package — a maintained, typed Mastodon API client, same reasoning as `@atproto/api` for Bluesky) + `src/routes/mastodonAuth.ts` (`POST /api/connections/mastodon/register` dynamically registers a per-instance OAuth app and returns an `authorizeUrl`; `GET /api/connections/mastodon/callback`, unauthenticated by design since the instance redirects the browser, exchanges the code and creates the connection). No new DB table for pending OAuth attempts — the flow's state (userId, instance, dynamically-issued client id/secret, issuedAt) round-trips through the instance in an AES-256-GCM-encrypted `state` param using the same `DATA_KEY` as stored credentials, with a 10-minute TTL. Extracted `src/lib/timelineImport.ts` (shared with `connections.ts`) so the "fetch initial timeline, catch a bad credential gracefully" logic from C1 isn't duplicated. Web UI wired: `dashboard/connections` has a real OAuth connect flow for Mastodon (instance field → redirect → back with a success/error banner). Real masto SDK types verified against the installed package before writing any code. Unit + route-level tests only (mocked `masto`, no live network call); **real end-to-end validation against a live instance still needs a human** — parked as `C2a`. |
| C3 | X API v2 OAuth 2.0 PKCE | WAITING-ON-HUMAN | Needs `TWITTER_CLIENT_ID`/`SECRET`; implement code path + env contract + UI state now, gate on env |
| C4 | Instagram + Threads OAuth | WAITING-ON-HUMAN | Needs Meta developer app |
| C5 | Retries, 429 backoff, token refresh, circuit breaker | TODO | Depends on C1/C2 existing |
| C6 | Connection UI: connect/reconnect/disconnect, last-error, last-synced-at | TODO | Depends on A4 |

## Phase D — Feed quality

| ID | Item | Status | Notes |
| --- | --- | --- | --- |
| D1 | Sync worker (pull timelines on a cadence) | TODO | `/api/feed` reads DB only |
| D2 | Stable cursor pagination | TODO | Mostly done; verify under concurrent writes |
| D3 | Dedup by `(platform, externalId)` | TODO | Add unique constraint + migration |
| D4 | Media rendering (images, then video) | TODO | |
| D5 | Reply thread drawer | TODO | Read-only first |
| D6 | Non-naive search | TODO | Replace `contains` scan |

## Phase E — Publishing system

| ID | Item | Status | Notes |
| --- | --- | --- | --- |
| E1 | Route all sends through PublishJob/PublishTarget | DONE | Already true for immediate sends |
| E2 | Scheduled send worker | TODO | Node cron or `/internal/tick` + `CRON_SECRET` |
| E3 | Media upload pipeline (local disk dev, S3-compatible prod) | TODO | |
| E4 | Per-target status in composer/history UI | TODO | API already returns it; wire UI polish |
| E5 | Char-limit preview per platform incl. Instagram 2200 | TODO | Add Instagram to `PLATFORM_META` |
| E6 | Idempotency keys | TODO | Prevent double-post on double-click |

## Phase F — Product surface

| ID | Item | Status | Notes |
| --- | --- | --- | --- |
| F1 | Real analytics (success rate, latency, feed volume) | TODO | Depends on live connectors existing |
| F2 | Bookmarks/likes mirrored to platform where possible | TODO | |
| F3 | Empty states, error toasts, optimistic UI w/ rollback | TODO | |
| F4 | Light/dark theme wired to `User.theme` | TODO | |
| F5 | Landing page polish | TODO | No marketing rewrite |
| F6 | Playwright smoke test | TODO | register → connect demo → feed → compose → history |

## Phase G — Production + agent hygiene

| ID | Item | Status | Notes |
| --- | --- | --- | --- |
| G1 | Postgres datasource + real migrations | TODO | Keep SQLite path for local |
| G2 | Harden Railway/Vercel docs, preview deploys | TODO | |
| G3 | Observability: pino logs, metrics, error reporting hook | TODO | |
| G4 | Security pass: CSP, exact CORS origins, secret hygiene | TODO | |
| G5 | Improve autonomous_agent.py to edit apps/**, open PRs | TODO | Last priority — product is NEXUS, not the agent |
| G6 | OPERATOR.md | TODO | How to run, env matrix, add a fifth platform |

## Parked / WAITING-ON-HUMAN

- **C1a (Bluesky live validation)** — code-complete, unit-tested against real
  SDK types, never run against a live account. Needs a Bluesky app password
  for a test account.
- **C2a (Mastodon live validation)** — code-complete, unit- and route-tested
  against a mocked SDK, never clicked through against a real instance. Needs
  a human to run the actual OAuth redirect once against any public instance
  — no developer app registration required (NEXUS registers its own
  per-instance), just a few clicks through the consent screen.
- **C3 (X/Twitter)** — needs a Twitter developer app (`TWITTER_CLIENT_ID`,
  `TWITTER_CLIENT_SECRET`). Code path, env contract, and "waiting on
  credentials" UI state should exist regardless.
- **C4 (Instagram/Threads)** — needs a Meta developer app.
- Updated human actions still owed (per the charter): a Bluesky app password
  for a test account (C1a) and clicking through the Mastodon OAuth flow once
  (C2a) are both now unblocked and low-effort; X/Threads/Instagram developer
  apps (C3/C4) remain the higher-effort asks.
