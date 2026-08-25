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

## Phase B — Auth hardening

| ID | Item | Status | Notes |
| --- | --- | --- | --- |
| B1 | Refresh tokens | TODO | httpOnly cookie or rotating refresh table |
| B2 | Password reset + email verification | TODO | Provider interface, console transport in dev |
| B3 | Rate-limit auth routes + lockout | TODO | `@fastify/rate-limit` |
| B4 | Session list / logout-all | TODO | Needs B1 first |
| B5 | Settings: change password, display name, theme | TODO | Theme field exists; wire UI |

## Phase C — Live connectors

| ID | Item | Status | Notes |
| --- | --- | --- | --- |
| C1 | Bluesky live connector (`@atproto/api`, app password) | TODO | No OAuth review needed — do this first |
| C2 | Mastodon OAuth 2.0 (user-supplied instance) | TODO | |
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

- **C3 (X/Twitter)** — needs a Twitter developer app (`TWITTER_CLIENT_ID`,
  `TWITTER_CLIENT_SECRET`). Code path, env contract, and "waiting on
  credentials" UI state should exist regardless.
- **C4 (Instagram/Threads)** — needs a Meta developer app.
- First human actions still owed (per the charter): a Bluesky app password for
  a test account, a Mastodon test instance + OAuth app registration, then
  X/Threads/Instagram developer apps when ready.
