# NEXUS — Campaign Log

This is the living constitution + session log for the 1242-hour autonomous
build campaign. The full charter is appended to `AGENTS.md`. Read this file
first, every session, before touching code.

## Operating loop (every session)

1. Re-read this file (especially the last entry's "Next step").
2. Open `docs/BACKLOG.md`, pick the single highest-priority `TODO` item that
   is unblocked. Flip it to `IN PROGRESS`.
3. Write a failing test or a checklist first.
4. Implement the smallest slice that makes it pass.
5. `npm run lint && npm test && npm run build` — all three green, no
   exceptions.
6. Confirm the demo account (`demo@nexus.app` / `password123`) still logs in
   and demo connectors still work with zero third-party keys.
7. Commit in small, reviewable commits. Push to
   `claude/nexus-production-build-s6p5hz`. Open the draft PR if none exists
   yet for this branch, otherwise it updates automatically.
8. Flip the backlog item to `DONE` (or `WAITING-ON-HUMAN` / `BLOCKED` with a
   one-line reason) in `docs/BACKLOG.md`.
9. Append a new entry below in **reverse-chronological order** (newest on
   top) with: date, session summary, item id, files touched, commands run +
   results, blockers, and the exact next command for the next session.

## Hard stops (see AGENTS.md for full list)

Never: commit a real secret · call a live social API with fabricated tokens ·
delete demo connectors · rewrite Fastify→Nest or Next→Vite · store OAuth
tokens in plaintext · force-push to main · burn 4+ hours on a slice with no
test or visible UI change.

---

## Session log

### 2026-08-25 — Session 1 (Phase A: foundation, complete)

**Summary:** First session of the 1242-hour campaign. Verified the repo
matched the charter's "current state" description exactly (demo connectors,
JWT auth, unified feed, composer all working; no docs/, no CI, no encrypted
credential storage, no connector registry). Ran the full first-actions
checklist — install/db:setup/lint/test/build all green before any change —
then shipped all of Phase A (A1–A7) as one mergeable slice.

**What shipped:**
- `docs/CAMPAIGN.md` (this file), `docs/BACKLOG.md`, `docs/BRD.md`
  (reconstructed from in-code requirement IDs: FD01/02/04/06, CP02, NF03,
  NF16, DS03, §5.5, §5.6, §8 — original BRD v1.0 source not recovered),
  `docs/ARCHITECTURE.md`.
- Full charter appended to `AGENTS.md` (Cursor Cloud notes untouched) plus
  an "operational notes" section on how this charter actually executes
  across many bounded sessions rather than one 1242h run.
- `.github/workflows/ci.yml` — installs, lints (API typecheck + web lint),
  seeds an ephemeral SQLite DB, runs vitest, builds both apps, on every PR
  and on pushes to the repo's current default branch.
- `DEPLOY.md` — the hardcoded `JWT_SECRET` example replaced with
  `openssl rand` generation instructions (`DATA_KEY` generation added
  alongside it); every reference to the leftover
  `autonomous-agent-setup-...` branch name replaced with
  `<your-production-branch>` plus a note that the repo has no `main` yet and
  renaming the default branch is a human/repo-admin action, not something to
  script. `redinc23/centuries` references corrected to
  `Mangu-Platforms/centuries`.
- `apps/api/.env.example` expanded with `DATA_KEY`, gated
  `TWITTER_CLIENT_ID/SECRET`, `META_APP_ID/SECRET`, and `CRON_SECRET` for
  phases C and E, each commented with which phase needs it and that it's
  safe to leave unset (demo mode continues to work).
- `Connection` model gained encrypted-at-rest credential fields
  (`accessTokenEnc`, `refreshTokenEnc`, `tokenExpiresAt`, `appPasswordEnc`,
  `scopes`, `metadata`) and `apps/api/src/lib/crypto.ts` (AES-256-GCM,
  keyed by `DATA_KEY`, dev-only deterministic fallback when unset so local
  dev/tests never break, hard throw in production if `DATA_KEY` is
  missing/malformed).
- `apps/api/src/connectors/registry.ts` — `getConnector(platform,
  hasCredentials)` picks a live connector if one has been registered for
  that platform *and* the specific connection has credentials, else falls
  back to the demo connector. `registerLiveConnector()` is the seam Phase C
  will call into one platform at a time; nothing registers yet. Routes
  (`connections.ts`, `posts.ts`) and `seed.ts` now import from the registry
  instead of `connectors/demo.ts` directly, per the charter's "don't scatter
  connector calls" rule.
- `connections.ts` now encrypts a posted app-password credential into
  `appPasswordEnc` for app-password platforms (Bluesky today) before
  storage, decrypts it back out only when handing it to a connector, and
  never returns any `*Enc` field to the client (`publicConnection()`
  serializer). OAuth-platform credentials are still accepted-but-unused,
  same as before, until Phase B/C's real OAuth exchange exists.
- `apps/api/src/app.ts` — request IDs (`genReqId` via `crypto.randomUUID()`,
  echoed as `x-request-id`), a global `setErrorHandler` and
  `setNotFoundHandler` returning `{ error, code, requestId, details? }`, and
  `GET /ready` (checks the DB with `SELECT 1`; `/health` stays untouched and
  free).
- New tests: `crypto.test.ts` (5), `registry.test.ts` (4), `app.test.ts` (5)
  — 19 new/total assertions on top of the existing 5 in
  `connectors.test.ts`. Vitest suite is now 4 files / 19 tests, all green.

**Commands run (all green):**
- `npm install` — 559 packages. `npm audit` flags 22 pre-existing
  vulnerabilities in transitive deps (3 critical, 16 high, 3 moderate) —
  not introduced this session, not addressed here; worth a dedicated
  `npm audit fix` pass as a future backlog item if any are actually
  reachable (most look like dev-tooling transitive deps).
- `npm run db:setup` — SQLite created/pushed with the new `Connection`
  columns, demo user + 4 connections + 32 feed posts seeded.
- `npm run lint` — API `tsc --noEmit` clean, web `next lint` clean.
- `npm test` — 19/19 vitest tests green across 4 files.
- `npm run build` — API + web both build clean.
- Manual smoke test against a locally running API
  (`npx tsx src/server.ts`): `/health`, `/ready`, demo login, `GET
  /api/connections` (verified `appPasswordEnc`/`accessTokenEnc` are absent
  from the response), `GET /api/feed`, `POST /api/posts` cross-post to
  bluesky+mastodon (both succeeded via demo connectors), `POST
  /api/connections` with a Bluesky app-password credential (verified via a
  direct Prisma query that the stored `appPasswordEnc` is 68 bytes of
  ciphertext and does **not** contain the plaintext credential), `GET
  /api/does-not-exist` (confirmed `{error, code, requestId}` shape), and the
  `x-request-id` response header. DB reset to a clean seed afterward.

**Blockers:** None. Nothing in this slice needed a human (that's C3/C4).

**Files touched:** `docs/CAMPAIGN.md`, `docs/BACKLOG.md`, `docs/BRD.md`,
`docs/ARCHITECTURE.md`, `AGENTS.md`, `DEPLOY.md`,
`.github/workflows/ci.yml`, `apps/api/.env.example`,
`apps/api/prisma/schema.prisma`, `apps/api/src/config.ts`,
`apps/api/src/lib/crypto.ts` (new), `apps/api/src/connectors/registry.ts`
(new), `apps/api/src/connectors/types.ts`, `apps/api/src/routes/connections.ts`,
`apps/api/src/routes/posts.ts`, `apps/api/src/seed.ts`, `apps/api/src/app.ts`,
`apps/api/src/__tests__/crypto.test.ts` (new),
`apps/api/src/__tests__/registry.test.ts` (new),
`apps/api/src/__tests__/app.test.ts` (new).

**Next step for the next session:** Read `docs/BACKLOG.md` — Phase A is
fully DONE. Start Phase C1: implement a live Bluesky connector
(`@atproto/api`, app-password auth) in `apps/api/src/connectors/bluesky.ts`,
call `registerLiveConnector("bluesky", ...)` from it, and wire it into
`app.ts` (or a connectors index) so it's registered at boot. C1 needs no
OAuth app review — only a Bluesky test account's app password, which is the
one human input still owed per the charter (park with a WAITING-ON-HUMAN
note in `docs/BACKLOG.md` if that credential isn't available yet and take
`B1`–`B3` instead, which need no external credentials).
