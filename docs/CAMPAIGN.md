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
7. **Before pushing**, check whether the branch's PR is still open
   (`list_pull_requests` filtered to this branch). A human can merge it out
   from under you mid-session — this actually happened in session 2 (see
   below): PR #4 got merged at its then-current head while Phase C2 work was
   still in flight on the same branch, so those commits landed on a branch
   whose PR was already closed. If that's the state you find:
   fetch the new default branch, `git rebase --onto origin/<default> <old-PR-head> claude/nexus-production-build-s6p5hz`
   to replay your unmerged commits onto the new base (never discard them),
   re-run the full verification suite from that rebased state (not just
   trust the pre-rebase run), `git push --force-with-lease`, and open a new
   PR — the old one is finished and can't be reused. Then commit in small,
   reviewable commits and push to `claude/nexus-production-build-s6p5hz`.
   Open the draft PR if none exists yet for this branch, otherwise it
   updates automatically.
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

### 2026-08-26 — Session 2, addendum 2: CodeQL findings on PR #5, fixed

CodeQL ran on PR #5's push and flagged 3 high-severity findings, all in new
C2 code — verified each, fixed, tested, replied on the review threads, and
resolved them:

1. **Double-unescaping / incomplete sanitization** (`connectors/mastodon.ts`,
   `stripHtml()`): entities were decoded *after* tags were stripped, so a
   toot literally containing escaped `<script>` text (Mastodon
   entity-escapes any literal `<`/`>` a user types) would survive the
   tag-strip pass, then get unescaped back into literal, unstripped
   `<script>` text in `RemotePost.content`. Not currently exploitable (the
   web UI renders `content` as React text, which always escapes), but a
   real defect and a footgun for any future consumer. Fixed by decoding
   first, then stripping — the function's output can no longer contain a
   literal `<`/`>` at all. Regression test added with the exact payload.
2. **Missing rate limiting** (`routes/mastodonAuth.ts`, both handlers):
   neither the register nor callback endpoint had any rate limiting.
   Verified true — no rate limiting exists anywhere in the codebase yet
   (Phase B3 is the tracked item for auth-routes-wide limiting). Added
   `@fastify/rate-limit` scoped narrowly to just these two new routes
   (`global: false`, so nothing else is affected) rather than widening into
   B3's territory: register at 5/min (before the auth check, since it
   triggers a real outbound call regardless of token validity), callback at
   10/min (its only guard, since it's deliberately unauthenticated).
   Regression tests confirm the limit actually trips.

Commands: `npm test` 46/46, `npm run lint`, `npm run build` all green after
the fixes. Pushed as `6f8779e` (sanitization) and `296ad1e` (rate limit).
Replied on all three CodeQL review threads referencing the fix commits and
resolved them.

**Next step:** same as before — Phase B (auth hardening) is next. Watch
PR #5 for CI going green on `296ad1e` and for any further review activity
before considering this slice fully closed out.

### 2026-08-26 — Session 2, addendum: PR #4 merged mid-flight, branch restarted, PR #5 opened

**What happened:** While Phase C2 (Mastodon OAuth) was still being built on
`claude/nexus-production-build-s6p5hz`, @redinc23 marked
[PR #4](https://github.com/Mangu-Platforms/centuries/pull/4) ready for
review and merged it directly — capturing only what was on the branch at
that moment (Phase A + C1, head `6db9f3c`). This session kept working and
pushed 5 more commits (Phase C2) to the same branch afterward, which never
became part of that merge — they were orphaned relative to the now-closed
PR. Caught this via the queued `pull_request.ready_for_review` /
`pull_request.closed` GitHub webhook notifications (delivery was delayed;
by the time they were read, several more commits and a PR description
update had already happened).

**What I did about it**, per the git-operations rule for a merged
designated-branch PR:
1. Fetched the new default branch tip (`e0878cc`, the merge commit) and
   confirmed `6db9f3c` (PR #4's merged head) is its ancestor.
2. `git rebase --onto origin/autonomous-agent-setup-6249396920522474145
   6db9f3c claude/nexus-production-build-s6p5hz` — replayed the 5 unmerged
   Phase C2 commits onto the new base. Clean rebase, no conflicts (expected:
   the merge commit's tree matches `6db9f3c`'s tree exactly since nothing
   else landed on the default branch in between).
3. Re-ran the **full** verification suite from the rebased state — fresh
   `npm install`, `db:setup`, `lint`, `test` (43/43), `build` — rather than
   trusting the pre-rebase run, since a rebase can in principle change
   what's actually being tested even when the diff looks identical.
4. `git push --force-with-lease origin claude/nexus-production-build-s6p5hz`
   — safe here per the git-operations rule (rebasing kept commits onto a
   new base, not discarding history).
5. Opened [PR #5](https://github.com/Mangu-Platforms/centuries/pull/5) for
   the rebased branch (PR #4 is closed/merged and can't be reused) with a
   summary explaining the split, and subscribed to its activity.
6. Corrected PR #4's title/description — it had briefly (and incorrectly)
   claimed Phase C2 was included, since GitHub still allows editing a
   merged PR's body after the fact and that edit happened before this
   session read the merge notification. Fixed it to describe only what
   actually merged (Phase A + C1), with a note pointing to PR #5.
7. Added a step to this file's own "Operating loop" above (step 7) so a
   future session checks for this situation *before* pushing, not after.

**Files touched:** none beyond the rebase itself (no content changes — the
5 commits' diffs are identical to what they were before rebasing, only
their base commit changed) plus this `CAMPAIGN.md` entry and the operating
loop amendment.

**Next step for the next session:** Read `docs/BACKLOG.md` — same as
before this addendum: Phase B (auth hardening) is next, unblocked. Also
worth a periodic check on PR #5's review state, the same way this happened
to PR #4 — a human may merge it directly at any point, so re-check
`list_pull_requests` for this branch before pushing further work, not just
at the start of a session.

### 2026-08-26 — Session 2 continued (Phase C2: Mastodon OAuth)

**Summary:** Same session as C1 above, continued after confirming PR #4 was
green on the C1 commit. Picked Phase C2 next per the backlog order — Mastodon
also needs no pre-registered developer app (NEXUS registers a per-instance
OAuth app dynamically), so it's unblocked without any human input.

**What shipped:**
- Before writing any connector code, checked for a maintained Mastodon API
  client on npm rather than hand-rolling raw fetch calls against Mastodon's
  REST API (same reasoning as choosing `@atproto/api` for Bluesky). Found
  `masto` (actively maintained, fully typed). Installed it and read its
  actual `.d.ts` files — `AppsResource.create`, `TokenResource.create`,
  `TimelinesHomeResource.list`, `StatusesResource.create`, the `Status`/
  `Account`/`MediaAttachment` entity shapes — before writing any mapping
  code, same rigor as C1. `tsc --noEmit` passed clean on the first attempt
  for both new files.
- `apps/api/src/lib/timelineImport.ts` (new) — extracted the "fetch a
  connector's initial timeline, store it, catch a bad credential gracefully"
  logic C1 added inline in `connections.ts` into a shared helper, since C2
  needed the exact same logic from a second call site (the OAuth callback).
  `connections.ts` now calls it too — net simplification, not just added
  code.
- `apps/api/src/connectors/mastodon.ts` — `PlatformConnector` via `masto`.
  `fetchTimeline` strips Mastodon's HTML-encoded `status.content` down to
  plain text (the web UI renders `FeedPost.content` as plain text, so this
  has to happen here, not at render time), normalizes local accounts' bare
  `acct` to a fully-qualified `@user@instance` handle, and extracts image
  URLs from media attachments (video deferred, matching Phase D4's "images
  first" plan). `publish` is text-only for now, matching the Bluesky/demo
  precedent. Self-registers via `registerLiveConnector("mastodon", ...)`.
- `apps/api/src/routes/mastodonAuth.ts` (new) — the OAuth 2.0
  authorization-code flow:
  - `POST /api/connections/mastodon/register` (authenticated): dynamically
    registers a NEXUS OAuth app on the user-supplied instance
    (`POST /api/v1/apps`), then returns an `authorizeUrl` for the browser to
    navigate to.
  - `GET /api/connections/mastodon/callback` (deliberately **not**
    authenticated — the instance redirects the user's *browser* here, which
    can't carry a Bearer header): exchanges the authorization code for an
    access token, calls `verify_credentials` to get the real handle, creates
    the `Connection` (token encrypted via the existing `lib/crypto.ts`),
    imports the initial timeline via the new shared helper, and redirects
    back to the web app with a success or error query param.
  - The interesting design point: rather than adding a new "pending OAuth
    attempt" DB table to bridge the register→callback gap, the state that
    bridges them (user id, instance, the dynamically-issued client
    id/secret, an issue timestamp) is JSON-encoded and encrypted with the
    same `DATA_KEY`-backed AES-256-GCM as stored credentials, then carried
    round-trip through the instance in the standard OAuth `state` param. No
    schema change needed for this whole feature. A 10-minute TTL bounds a
    stale/replayed state.
- `apps/web`: `lib/api.ts` gained `mastodonRegister(instance)`.
  `dashboard/connections/page.tsx` now has a real, working Mastodon connect
  flow — enter an instance, get redirected to it, approve, land back with a
  success or error banner (read from the callback's query params, then
  stripped from the URL). Had to wrap the page in a `<Suspense>` boundary
  because `useSearchParams()` requires one for static prerendering in
  Next.js 14 App Router — verified the production build still statically
  prerenders `/dashboard/connections` after the change (`npm run build`
  confirmed, page still shows `○ (Static)`).
- Tests: `mastodon.test.ts` (8) — connector mapping/HTML-stripping/handle
  normalization/missing-credential refusal/publish, mocked `masto`.
  `mastodonAuth.test.ts` (8) — both routes end-to-end via `app.inject`:
  register's `authorizeUrl` shape and state opacity (asserted the raw client
  secret never appears in the JSON response outside the encrypted state
  blob), an unreachable-instance 400, register requires auth, callback happy
  path (asserts the DB connection + encrypted token + imported feed posts),
  tampered state, **expired state** (real 10-minute TTL check using an
  actual past timestamp, not mocked time), instance-rejects-code, and
  confirmed the callback route itself needs no Authorization header. **No
  live network call to any Mastodon instance was made anywhere in this
  session** — every test mocks `masto`; manual verification used only the
  zero-credential demo path.

**Commands run (all green):**
- `npm install masto` (added `masto@^8.0.0`).
- `npx tsc --noEmit -p apps/api/tsconfig.json` — clean on the first attempt,
  twice (once after the connector, once after the routes).
- `npx vitest run` — **43/43** tests green across 8 files (16 new: 8 in
  `mastodon.test.ts`, 8 in `mastodonAuth.test.ts`).
- `npm run lint -w @nexus/web && npm run build -w @nexus/web` — clean;
  confirmed `/dashboard/connections` still prerenders statically after
  adding `useSearchParams`.
- `npm run lint && npm test && npm run build` (root, full) — all green
  (see next entry for the exact final numbers after docs were added).

**Blockers:** None for shipping the code. `C2a` (real end-to-end validation
against a live instance) is parked `WAITING-ON-HUMAN` — genuinely low effort
this time (click through a consent screen on any public instance, no
developer app approval needed). One connectivity note: during the manual
smoke test, `POST /api/connections/mastodon/register` was called against
the real `mastodon.social` (anonymous, credential-free app registration —
not a user login or a fabricated token, the same "register my OAuth app"
step any real client does) to see how the error handling behaves against a
genuine failure rather than a mock. It failed with a network/encoding error
— this sandbox's outbound network is proxied and blocks arbitrary domains
(same restriction hit earlier fetching Mastodon's own docs), not a bug in
the code: the failure was caught and returned as a clean `400` exactly as
designed and unit-tested. This does **not** count as C2a validation — it
confirms the error path works, not that the happy path does against a real
instance.

**Files touched (this sub-slice):** `apps/api/package.json`,
`package-lock.json` (via `npm install masto`), `apps/api/src/config.ts`
(`apiPublicUrl`, `webAppUrl`), `apps/api/src/lib/timelineImport.ts` (new),
`apps/api/src/routes/connections.ts` (refactored to use the new helper),
`apps/api/src/connectors/mastodon.ts` (new),
`apps/api/src/routes/mastodonAuth.ts` (new), `apps/api/src/app.ts`,
`apps/api/.env.example`, `apps/web/lib/api.ts`,
`apps/web/app/dashboard/connections/page.tsx`,
`apps/api/src/__tests__/mastodon.test.ts` (new),
`apps/api/src/__tests__/mastodonAuth.test.ts` (new), `docs/BACKLOG.md`.

**Next step for the next session:** Read `docs/BACKLOG.md` — C1 and C2 are
both DONE (code-complete, live-unverified; C1a/C2a parked for a human).
Take **B1–B3** next (refresh tokens, password reset/email verification,
auth rate-limiting) — none need external credentials, and Phase B has been
untouched since before Phase A. Alternatively, if a human has supplied a
Bluesky app password or clicked through the Mastodon OAuth flow by then, do
that validation pass (`C1a`/`C2a`) first — quick, and it either confirms
Phase C's approach is solid before C3/C4 lean on the same pattern, or
surfaces a real bug while it's still cheap to fix.

### 2026-08-26 — Session 2 (Phase C1: live Bluesky connector)

**Summary:** First firing of the recurring campaign trigger (self-bind,
every 4 hours). Confirmed the branch head matched this session's own prior
work (no external changes since Session 1) via `git fetch` + `status` +
`log` before touching anything. Picked Phase C1 — the first live connector
— since it needs no OAuth developer app, only a user-supplied Bluesky app
password at connect time.

**What shipped:**
- `apps/api/src/connectors/bluesky.ts` — a `PlatformConnector` implementation
  using `@atproto/api`. Stateless by design: every `fetchTimeline`/`publish`
  call logs in fresh with `AtpAgent` rather than caching a session (session
  caching + retry/backoff is Phase C5, not this slice). Before writing any
  code, verified the actual installed package's `.d.ts` files (not memory)
  for `AtpAgent`'s constructor/login signature, `Agent.getTimeline`/`.post`,
  and the `FeedViewPost`/`PostView`/image-embed response shapes — confirmed
  via `npx tsc --noEmit` against the real types with zero errors on the
  first pass.
- Self-registers via `registerLiveConnector("bluesky", ...)` (the seam
  `registry.ts` defines); wired into the running app with one side-effect
  import (`import "./connectors/bluesky.js"`) in `app.ts` — the pattern each
  future live connector (C2–C4) will repeat.
- Images are read from the timeline (`app.bsky.embed.images#view` →
  `fullsize` URLs) but publish is text-only for now — matches the *existing*
  demo connectors' behavior (they already discard `mediaUrls` on publish),
  so this isn't a regression; real media upload is Phase E3.
- `routes/connections.ts`: the initial-timeline-fetch on connect is now
  wrapped in try/catch. A rejected live credential (wrong app password, a
  network error) no longer 500s the connect request — the connection is
  kept with `status: "error"` and the response carries a `warning` string,
  so a bad credential is a handled outcome the user can see and retry, not
  a crash. This closes a real gap the live connector just exposed: before
  C1, `fetchTimeline` could never throw (demo connectors don't), so this
  code path was previously unreachable.
- Tests: `bluesky.test.ts` (6) unit-tests the connector against a **mocked**
  `AtpAgent` (`vi.hoisted` + `vi.mock("@atproto/api", ...)`) — response
  mapping, `@`-stripping on login, avatar fallback, missing-credential
  refusal (asserts the mock constructor is never even called), and publish.
  `connections.test.ts` (2, new file) exercises the real `POST
  /api/connections` route end-to-end via `app.inject` with the same mock,
  covering both the success path (imports posts, no warning) and the
  rejected-credential path (201 with `warning`, connection status
  `"error"`, no 500). **No live network call to Bluesky was made anywhere
  in this session** — every test and every manual check used either the
  mock or the zero-credential demo path.
- `.env.example`: documented optional `BLUESKY_SERVICE_URL` override.

**Commands run (all green):**
- `npm install` (added `@atproto/api@^0.20.41`).
- `npx tsc --noEmit -p apps/api/tsconfig.json` — clean against the real
  `@atproto/api` types on the first pass.
- `npm test -w @nexus/api` — **27/27** vitest tests green across 6 files (8
  new: 6 in `bluesky.test.ts`, 2 in `connections.test.ts`).
- `npm run lint && npm test && npm run build` (root) — all green.
- Manual smoke test against a locally running API: demo login still works;
  the seeded demo Bluesky connection (no stored credential) still resolves
  to the **demo** connector for both feed and cross-post — confirmed by the
  cross-post's `externalId` still being in the demo format
  (`bluesky-post-<timestamp>`), not an AT-URI — proving a live connector
  existing in the registry does not change behavior for any connection that
  has no credentials. DB reset to a clean seed afterward; test-created
  users cleaned up via each test's own `afterEach`.

**Blockers:** None for shipping the code. `C1a` (real end-to-end validation
against production `bsky.social`) is parked `WAITING-ON-HUMAN` in
`docs/BACKLOG.md` — needs a human-supplied Bluesky app password for a test
account, per the charter's "first human work" list. `C1b` (surface the new
`warning` field in the web connect UI) is parked as a `C6` follow-up.

**Files touched:** `apps/api/package.json`, `apps/api/package-lock.json`
(via `npm install`), `apps/api/src/connectors/bluesky.ts` (new),
`apps/api/src/app.ts`, `apps/api/src/routes/connections.ts`,
`apps/api/.env.example`, `apps/api/src/__tests__/bluesky.test.ts` (new),
`apps/api/src/__tests__/connections.test.ts` (new), `docs/BACKLOG.md`.

**Next step for the next session:** Read `docs/BACKLOG.md` — C1 is DONE
(code-complete, live-unverified). Take **C2** (Mastodon OAuth 2.0 against a
user-supplied instance) next, since it also needs no pre-registered
developer app (NEXUS registers a per-instance OAuth app dynamically). If a
human has supplied a real Bluesky app password by then, do `C1a` (real
end-to-end validation) first — it's a quick, high-value confidence check
before building the next connector on the same pattern.

### 2026-08-25 — Session 1 addendum: CI fix

PR #4's first CI run (`build-and-test`) failed on `npm run lint`: dozens of
TS errors (`Prisma.FeedPostWhereInput` missing, `Connection` fields typed as
`{}`, implicit `any`s) that did **not** reproduce locally. Root cause: CI ran
`npm run lint` immediately after `npm ci`, before the "Set up dev database"
step — but `npm ci` only installs the `@prisma/client` package skeleton; the
actual generated model types come from `prisma generate` (which `db:setup`'s
`prisma db push` runs as a side effect). Locally this never surfaced because
`db:setup` had already been run earlier in the session, well before lint.
Reproduced by deleting `node_modules/.prisma` and re-running `tsc` (same
error signature), fixed by moving the DB-setup step before lint in
`.github/workflows/ci.yml`, and re-verified by running the corrected step
order end-to-end from a clean DB/generated-client state. Pushed as
`0975f24`. **Confirmed green** on the next push (`cb81286`): `build-and-test`
(`conclusion: success`), plus CodeQL and the JS/TS + Python analyze checks,
all passed. PR #4 is fully green and mergeable as of this addendum.

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
