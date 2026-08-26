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

### 2026-08-26 — Session 3 continued a fifth time (Phase D1 + D3: periodic sync worker + dedup)

**Summary:** Phase B (auth hardening) finished this session; checked PR #5
was still green/mergeable/no unresolved review threads before continuing
(it was — CodeQL, build-and-test, both Analyze jobs all `success`,
`mergeable_state: "clean"`, all 5 review threads already resolved from the
earlier CodeQL fix). No way from inside this sandbox to check whether a
human has supplied any outstanding Phase C credentials (that's the actual
deployment's env, not this dev container's), so moved to Phase D per the
backlog's own next-step note. Picked **D1** (a sync worker — today
`fetchTimeline` only ever runs once, at connect time, so a feed never
updates after that) — but D1 without dedup would insert duplicate posts on
every tick, so **D3** (dedup by `(platform, externalId)`) came first as its
prerequisite, in the same slice.

**What shipped:**
- **D3 — schema**: `@@unique([userId, platform, externalId])` on
  `FeedPost`. Before applying it, actually checked the dev DB for existing
  duplicates with a raw `GROUP BY ... HAVING COUNT(*) > 1` query (found
  none) rather than assuming `prisma db push`'s generic data-loss warning
  didn't apply — then applied with `--accept-data-loss` once confirmed
  safe.
- **D3 — dedup helper**: `lib/timelineImport.ts` gained
  `importTimelinePosts()`, extracted from the existing initial-import
  logic and now upsert-based: a new `externalId` inserts, an existing one
  gets `content`/`authorName`/`authorAvatar`/engagement counts refreshed
  but never `liked`/`bookmarked`/`isOwn` (those are local user state with
  no remote source of truth to overwrite them from). Runs upserts
  sequentially rather than via a Prisma `createMany({skipDuplicates})`
  batch — SQLite doesn't support `skipDuplicates` at all, and sequential
  upserts behave identically across SQLite (dev/test) and Postgres (prod)
  rather than depending on provider-specific batch semantics.
  `importInitialTimeline` is now a thin wrapper: fetch (with its existing
  try/catch → `status: "error"` + warning on failure), then call the new
  shared helper.
- **D1 — sync engine**: `lib/sync.ts` (new). `syncConnection()` resolves
  the connector exactly the way connect-time does (demo vs. live,
  credential-gated — a demo connection stays on the demo connector
  forever, unchanged behavior), fetches, imports via the dedup helper, and
  manages `Connection.status`: a fetch failure flips it to `"error"`; a
  connection already in `"error"` is retried on the next tick too (bounded
  self-healing — a transient network blip or momentary rate limit doesn't
  require the user to manually reconnect), flipping back to `"active"` on
  success. `syncAllConnections()` runs it across every connection
  sequentially and aggregates `{connectionsSynced, postsImported,
  connectionsFailed}`.
- **D1 — scheduler**: `lib/syncScheduler.ts` — a plain `setInterval` (5
  minutes, a fixed constant, same precedent as B1's token TTLs rather than
  a new env var), `.unref()`'d so it never blocks a graceful shutdown.
  Started from `server.ts` only, right after `app.listen()` succeeds, and
  stopped in the SIGINT/SIGTERM handler — deliberately **not** started
  from `app.ts`/`buildApp()`, which every test calls directly, so no test
  run ever spawns a background timer or triggers an unawaited sync tick
  outside what it's asserting on.
- **Tests**: `apps/api/src/__tests__/sync.test.ts` (new, 5 tests) — a
  controllable fake connector (registered via the existing
  `registerLiveConnector`/`__resetRegistryForTests` test seam from
  `registry.test.ts`) proves: a second sync only counts genuinely new
  posts, not re-fetched ones; engagement counts refresh on re-sync while
  `liked`/`bookmarked` survive untouched; a failing connector flips status
  to `"error"` and a subsequently-succeeding one flips it back to
  `"active"`; `syncAllConnections` aggregates correctly across a mix of
  succeeding and failing connections. A fifth test uses the **real** demo
  connector (no fake) to prove the whole path also dedupes correctly
  end-to-end without any mocking.

**Commands run (all green):**
- `apps/api`: `npx tsc --noEmit` clean. `npx vitest run` — **91/91** across
  14 files (5 new).
- Root: `npm run lint` (API typecheck + `next lint`) clean. `npm run build`
  — API clean; web clean (unaffected by this API-only slice, all 10 routes
  still prerender).
- Manual smoke test: confirmed `demo@nexus.app` still logs in. Rather than
  waiting out the real 5-minute scheduler interval, invoked
  `syncAllConnections()` directly against the live dev DB (not the test
  DB) via a scratch script — `connectionsSynced: 4` (the demo user's 4
  seeded connections), `postsImported: 0` both on a first and immediate
  second call (correct: the demo connector's output is deterministic per
  platform+handle, so nothing "new" ever appears from it — periodic
  syncing only matters for live connectors receiving genuinely new remote
  posts), `feedPost` count unchanged across both calls (80 before and
  after, twice), and every connection's `status` confirmed still
  `"active"` afterward — proving the sync path doesn't accidentally break
  demo connections it touches. Scratch script and its output deleted
  afterward; dev server stopped.

**Blockers:** None. No new env vars.

**Files touched:** `apps/api/prisma/schema.prisma`,
`apps/api/src/lib/timelineImport.ts`, `apps/api/src/lib/sync.ts` (new),
`apps/api/src/lib/syncScheduler.ts` (new), `apps/api/src/server.ts`,
`apps/api/src/__tests__/sync.test.ts` (new), `docs/BACKLOG.md`.

**Next step for the next session:** Read `docs/BACKLOG.md` — D1 and D3 are
DONE. **D2** (stable cursor pagination) is marked "mostly done, verify
under concurrent writes" — worth a dedicated look now that D1 means the
feed can genuinely change *while* a client is paginating through it, which
wasn't possible before this session (the feed was static after connect).
**D4** (media rendering) and **D6** (non-naive search, replacing the
`contains` scan) are the other unstarted Phase D items and don't depend on
D1/D3. As always, check the Parked/WAITING-ON-HUMAN section in
`docs/BACKLOG.md` for any credentials a human may have supplied since the
last check.

### 2026-08-26 — Session 3 continued a fourth time (Phase B5: change password — Phase B complete)

**Summary:** Same session as B1–B4 above. B5 was the last Phase B item;
display name/bio/theme were already wired from before this session, so the
only real gap was letting a logged-in user change their password directly
(without going through B2's email-reset flow).

**What shipped:**
- **`POST /api/auth/change-password`** (authenticated, rate-limited 10/min,
  in `routes/auth.ts`): verifies `currentPassword` via `bcrypt.compare`
  before touching anything, updates `passwordHash` (cost 12, same as
  register), then calls B4's `revokeAllForUserExcept` — keeping the session
  making the request alive (the user just proved they control it) while
  signing out every other session, same reasoning as B2's password-reset
  flow. This is the third route this session to reuse B4's session
  primitives (`findActiveSessionIdByRawToken` to identify "this session",
  `revokeAllForUserExcept` to keep it alive while clearing the rest) rather
  than reimplementing that logic a third time.
- **Web:** a "Change password" card in `/dashboard/settings` (current /
  new / confirm-new fields, client-side length + match checks before
  hitting the API); `lib/api.ts` gained `changePassword()`.
- **Tests:** `apps/api/src/__tests__/changePassword.test.ts` (new, 5
  tests) — happy path end-to-end (old password stops working, new one
  works), wrong current password rejected without changing anything, the
  keep-current-revoke-others behavior (reusing the same pattern proven in
  B4's own tests), auth required, new password under 8 characters rejected.

**Commands run (all green):**
- `apps/api`: `npx tsc --noEmit` clean. `npx vitest run` — **86/86** across
  13 files (5 new).
- Root: `npm run lint` (API typecheck + `next lint`) clean. `npm run build`
  — API clean; web clean, all 10 routes still prerender.
- Manual smoke test against a locally running API: `demo@nexus.app`
  unaffected; registered a throwaway account, confirmed a wrong current
  password is rejected (401) and the real password still works afterward,
  then changed it with the correct current password and confirmed the old
  password stopped working while the new one logged in. Deleted the
  throwaway account and stopped the dev server afterward.

**Blockers:** None. **Phase B (auth hardening) is now fully complete — B1
through B5 all `DONE`.**

**Files touched:** `apps/api/src/routes/auth.ts`,
`apps/api/src/__tests__/changePassword.test.ts` (new), `apps/web/lib/api.ts`,
`apps/web/app/dashboard/settings/page.tsx`, `docs/BACKLOG.md`.

**Next step for the next session:** Read `docs/BACKLOG.md` — Phase B is
fully complete. Check the Parked/WAITING-ON-HUMAN section for whether a
human has supplied any outstanding credentials (Twitter/Meta developer
apps for C3/C4, a Bluesky app password for C1a, clicked through Mastodon's
OAuth for C2a, or an email provider for B2a). If not — and there's no way
for a session running inside this sandbox to check the actual production
deployment's env vars, only what a human explicitly reports — **Phase D
(feed quality)** is the natural next phase: D1 (a real sync worker; today
Bluesky/Mastodon only fetch on connect, never on a cadence) is the biggest
gap now that Phase C's two shipped connectors exist for it to matter.

### 2026-08-26 — Session 3 continued a third time (Phase B4: session list + logout-all, and a real bug caught by smoke testing)

**Summary:** Same session as B1/B2/B3 above, continued straight through. B4
was the last item in Phase B and was already fully unblocked — B1 left
`userAgent`/`ipAddress` on every `RefreshToken` row specifically for this,
and B3 gave the codebase a settings-page precedent for "account security"
UI.

**What shipped:**
- **`lib/refreshTokens.ts`** gained four functions: `listActiveSessions`
  (not-revoked, not-expired, newest first), `findActiveSessionIdByRawToken`
  (resolves which session a raw cookie value belongs to — used to mark
  "this device" without ever trusting a client-supplied session id),
  `revokeSession` (ownership-scoped single revoke), `revokeAllForUserExcept`
  ("log out all other devices", keeping one alive).
- **`apps/api/src/routes/sessions.ts`** (new): `GET /api/auth/sessions`,
  `DELETE /api/auth/sessions/:id`, `POST /api/auth/sessions/logout-all`. All
  three authenticated; "current" is determined server-side from the
  request's own refresh cookie, never from anything the client sends, so a
  user can't spoof which row is "this device."
- **Web:** `/dashboard/settings` gained an "Active sessions" card — device
  (`userAgent`)/IP/date per row, a "This device" badge, a per-row "Log out"
  button (hidden for the current row), and a "Log out all other sessions"
  button (hidden when there's nothing else to log out). `lib/api.ts` gained
  `sessions()`/`revokeSession()`/`logoutAllOtherSessions()`; `lib/types.ts`
  gained `SessionInfo`.
- **A real bug, caught by the manual smoke test, not by any unit test**:
  after revoking one device's session via the new UI and then simulating
  that device's next natural background refresh attempt (its browser still
  holds the now-stale cookie — nothing tells it to clear it, since the
  revocation happened from a *different* device), the *current* session
  also got logged out. Traced it to B1's reuse-detection in
  `rotateRefreshToken`: it treated presenting *any* already-revoked token as
  a theft signal and revoked every session for the user, without
  distinguishing *how* the token got revoked. That distinction matters: a
  token revoked by **rotation** (`replacedByHash` set) being replayed really
  is a stolen-cookie signal — a legitimate client only ever moves forward.
  A token revoked **directly** — by logout, by this session's own
  per-session revoke or logout-all, or by a B2 password reset — being
  presented again is just "this session was intentionally ended elsewhere,"
  not theft. The old code conflated the two, which meant B4's entire
  premise (log out *this one* device, keep the rest alive) would silently
  self-defeat the next time the logged-out device tried to refresh. Fixed
  by checking `replacedByHash` before treating a revoked-token replay as
  reuse; a direct revocation now correctly reports plain `invalid` and
  touches nothing else. This also quietly improves B2's password-reset
  path and B1's own logout, which had the same latent conflation — they
  just hadn't been exercised in a way that surfaced it, since a browser
  normally clears its own cookie on its own logout. Re-verified against the
  live dev server (not just the test suite) that the exact broken sequence
  now behaves correctly.
- **Tests:** `apps/api/src/__tests__/sessions.test.ts` (new, 8 tests) —
  lists current session correctly (with and without a second login, with
  and without the refresh cookie present), revokes one session by id and
  confirms it can no longer refresh, refuses to revoke another user's
  session (404, not leaking whether it exists), logout-all revokes every
  other session but keeps the current one refreshable, auth required on
  all three endpoints, and — the one that specifically regression-tests the
  bug above — revoking one device's session and then presenting *that*
  device's stale cookie must reject only that device, not cascade.

**Commands run (all green):**
- `apps/api`: `npx tsc --noEmit` clean. `npx vitest run` — **81/81** across
  12 files (8 new).
- Root: `npm run lint` (API typecheck + `next lint`) clean. `npm run build`
  — API clean; web clean, all 10 routes still prerender.
- Manual smoke test against a locally running API — this is the pass that
  actually caught the bug above, which none of the automated tests written
  before it exercised: demo login unaffected throughout; registered a
  throwaway account, logged in a "second device" (custom `User-Agent`),
  confirmed the session list correctly showed two rows with exactly one
  marked current; revoked the non-current one via `DELETE`, confirmed its
  cookie 401s on refresh — first attempt showed the current session's
  cookie *also* went dead afterward (the bug); applied the fix; re-ran the
  identical sequence against the (auto-reloaded, `tsx watch`) dev server
  and confirmed the current session's cookie now still works after the
  other one is revoked and later presented stale. Also re-verified
  logout-all (three sessions, keep-current) end-to-end. Deleted all
  throwaway accounts and stopped the dev server afterward — no data left
  behind.

**Blockers:** None. Phase B (auth hardening) is now fully complete — B1
through B4 all `DONE`. No new env vars.

**Files touched:** `apps/api/src/lib/refreshTokens.ts`,
`apps/api/src/routes/sessions.ts` (new), `apps/api/src/app.ts`,
`apps/api/src/__tests__/sessions.test.ts` (new), `docs/BACKLOG.md`.

**Next step for the next session:** Read `docs/BACKLOG.md` — Phase B is
complete. `B5` (settings: change password while authenticated — display
name/theme are already wired from before this session) is the one
remaining Phase B item but is low priority polish, not a security gap.
Better next moves: check whether a human has supplied any of the
outstanding Phase C credentials (Twitter/Meta developer apps, a Bluesky
app password for `C1a`, or clicking through Mastodon's OAuth flow for
`C2a`) — if not, Phase D (feed quality: a real sync worker, dedup, media
rendering) is the natural next phase, since Phase C's two shipped
connectors (Bluesky, Mastodon) currently only fetch on connect, not on a
cadence.

### 2026-08-26 — Session 3 continued again (Phase B2: password reset + email verification)

**Summary:** Same session as B1/B3 above, continued straight through per the
B3 entry's own "next step" note. Picked B2 — the only remaining Phase B item
that needs no external credentials to ship, since the charter calls for a
provider interface with a console transport in dev rather than a real email
service.

**What shipped:**
- **`apps/api/src/lib/email.ts`** (new) — `EmailProvider` interface,
  `ConsoleEmailProvider` (the only implementation today: logs the message to
  server output). `sendEmail()` is the call-site API; `setEmailProvider()`
  is the swap seam both tests and a future real provider use. No real
  provider credentials exist yet (no SMTP/Resend/etc.), so this gets the
  same "ship the code path, gate the real thing" treatment as the X/
  Instagram connectors in Phase C — parked as `B2a`.
- **`apps/api/src/lib/verificationTokens.ts`** (new) — hashed, single-use,
  purpose-checked tokens, the same hashing rationale as `refreshTokens.ts`
  (high-entropy random value, not a user secret, so SHA-256 not bcrypt).
  One `VerificationToken` Prisma model backs both flows rather than two
  near-identical ones; `purpose` (`"password_reset"` | `"email_verify"`) is
  checked on every consume, so a reset token can't be replayed against the
  verify endpoint even though the hash alone is already globally unique —
  verified by a dedicated test.
- **`apps/api/src/routes/accountRecovery.ts`** (new), registered in
  `app.ts`:
  - `POST /api/auth/password-reset/request` — always responds `200 {ok:
    true}` whether or not the email is registered (no enumeration); only
    sends an email when it is. 30-minute token TTL.
  - `POST /api/auth/password-reset/confirm` — consumes the token, updates
    `passwordHash` (bcrypt cost 12, same as register), and — the one design
    decision worth calling out — calls `revokeAllForUser()` (from B1) and
    `clearLockout()` (from B3) on success. A password reset has to
    invalidate every existing session (a stolen refresh token from before
    the reset must stop working) and clear any lockout (the credential that
    caused it no longer exists), so this slice directly reuses both of the
    last two sessions' work rather than duplicating either.
  - `POST /api/auth/email/verify/request` — authenticated; a no-op
    (`{ok:true, alreadyVerified:true}`, sends nothing) if already verified,
    so spamming "resend" can't spam the inbox. 24-hour token TTL.
  - `GET /api/auth/email/verify` — deliberately unauthenticated, same
    reasoning as the Mastodon OAuth callback (`routes/mastodonAuth.ts`): a
    link clicked from an email can't carry a Bearer header, so the token in
    the query string is the only credential this route trusts. Redirects to
    `/dashboard/settings` with `emailVerified=1` or `emailVerifyError=...`.
  - All four routes rate-limited per IP via the same `app.rateLimit()`
    preHandler pattern established in B3.
  - `publicUser()` (in `routes/auth.ts`) now includes `emailVerifiedAt`, so
    every auth response (register/login/refresh/me) carries verification
    status without an extra round trip.
- **Web:** `lib/api.ts` gained `requestPasswordReset`, `confirmPasswordReset`,
  `requestEmailVerification`; `lib/types.ts`'s `User` gained
  `emailVerifiedAt`. New `/forgot-password` (email → "check your inbox",
  worded to match the backend's non-enumerating response) and
  `/reset-password` (reads `?token=` via `useSearchParams`, wrapped in
  `<Suspense>` per the same Next 14 static-prerendering requirement C2 hit)
  pages. `/login` gained a "Forgot password?" link and (also now behind
  `<Suspense>`, since it reads `?reset=1`) a post-reset success banner.
  `/dashboard/settings` gained an "Email verification" row — status badge,
  a "Resend email" button when unverified, and handling for the
  `?emailVerified=1` / `?emailVerifyError=...` redirect params from the
  verify-link callback (calls the existing `refresh()` from B1's
  `auth.tsx` so the badge updates immediately without a manual reload).
- **Tests:** `apps/api/src/__tests__/accountRecovery.test.ts` (new, 11
  tests) — password reset: happy path end-to-end (old password stops
  working, new one works), non-enumeration (unregistered email still 200,
  sends nothing), invalid token, reuse-of-consumed-token, session +
  lockout state actually clears on success, rate-limit trip. Email
  verification: happy path end-to-end (register → request → click link →
  `/me` reflects it), already-verified no-op sends nothing, requires auth
  to request, invalid/missing token redirects cleanly (not a 500), and the
  cross-purpose-replay rejection mentioned above.

**Commands run (all green):**
- `apps/api`: `npx tsc --noEmit` clean. `npx vitest run` — **73/73** across
  11 files (11 new).
- Root: `npm run lint` (API typecheck + `next lint`) clean. `npm run build`
  — API clean; web clean, all 10 routes now prerender (2 new:
  `/forgot-password`, `/reset-password`).
- Manual smoke test against a locally running API: confirmed
  `demo@nexus.app`/`password123` still logs in normally; registered a
  throwaway account, requested a password reset, read the actual reset
  link out of the console-transport log output (not mocked — the real
  `ConsoleEmailProvider` path), confirmed the old password stopped working
  and the new one logged in after confirming the reset; requested email
  verification with that new session's access token, read the verify link
  out of the log the same way, confirmed the `GET` redirected to
  `/dashboard/settings?emailVerified=1` and `/api/auth/me` now reflects a
  non-null `emailVerifiedAt`. Deleted the throwaway account and stopped the
  dev server afterward — no data left behind.

**Blockers:** None for shipping the code. `B2a` (wire a real email
provider) is parked `WAITING-ON-HUMAN` in `docs/BACKLOG.md` — genuinely low
effort once credentials exist (one new `EmailProvider` implementation, no
route changes). No new required env vars — `.env.example` documents this
with a comment rather than a var, since there's nothing to set until a real
provider is chosen.

**Files touched:** `apps/api/prisma/schema.prisma`, `apps/api/src/lib/email.ts`
(new), `apps/api/src/lib/verificationTokens.ts` (new),
`apps/api/src/routes/accountRecovery.ts` (new), `apps/api/src/routes/auth.ts`,
`apps/api/src/app.ts`, `apps/api/.env.example`,
`apps/api/src/__tests__/accountRecovery.test.ts` (new), `apps/web/lib/api.ts`,
`apps/web/lib/types.ts`, `apps/web/app/login/page.tsx`,
`apps/web/app/forgot-password/page.tsx` (new),
`apps/web/app/reset-password/page.tsx` (new),
`apps/web/app/dashboard/settings/page.tsx`, `docs/BACKLOG.md`.

**Next step for the next session:** Read `docs/BACKLOG.md` — B1, B2, and B3
are all DONE; Phase B has one item left, **B4** (session list / logout-all),
now fully unblocked (B1 shipped `revokeAllForUser()` and per-token
`userAgent`/`ipAddress`, B3 added the lockout/session-security context a
settings page would sit next to). After B4, Phase B is complete and C3/C4
(X, Instagram/Threads) are the only remaining `WAITING-ON-HUMAN` items
before Phase D (feed quality) becomes the natural next phase — check
`docs/BACKLOG.md`'s Parked section for whether a human has supplied any of
the outstanding credentials (Twitter/Meta developer apps, Bluesky app
password, or an email provider for B2a) before starting Phase D from
scratch.

### 2026-08-26 — Session 3 continued (Phase B3: rate limiting + account lockout)

**Summary:** Same session as B1 above, continued straight through per the
"B2 or B3 next, either order" note — picked B3 since `@fastify/rate-limit`
is already a dependency and the exact preHandler pattern was already proven
on the Mastodon OAuth routes from the CodeQL fix in Session 2, making it a
fast, low-risk slice.

**What shipped:**
- **Per-IP rate limiting** on all three unauthenticated-entry auth routes,
  using the same `{ preHandler: [app.rateLimit({...})] }` pattern as
  `routes/mastodonAuth.ts`: `POST /api/auth/register` 5/min (spam account
  creation), `/login` 10/min, `/refresh` 20/min (higher — legitimate use
  fires this on every 401 across possibly several open tabs via the web
  app's silent-refresh mechanism from B1, so it needs more headroom than a
  login-brute-force budget).
- **Per-account lockout** (`apps/api/src/lib/loginLockout.ts`, new) — the
  part per-IP rate limiting can't cover: an attacker spreading guesses
  across many IPs against one account. `User` gained `failedLoginAttempts`
  (`Int @default(0)`) and `lockedUntil` (`DateTime?`). `checkLockout()` is a
  pure read; `recordFailedLogin()` increments and locks for 15 minutes once
  the count hits 5; `clearLockout()` resets both fields on a successful
  login. Wired into `POST /api/auth/login` so the lockout check runs
  *before* the password comparison — a locked account rejects even the
  correct password with `423 { error, retryAfterSeconds }`, not just wrong
  ones, otherwise an attacker could distinguish "wrong password" from
  "locked" by trying the real password last. A login for an email with no
  account is left as a plain `401` (nothing to lock, and no different from
  today's existing behavior — doesn't change the "don't leak which emails
  exist" property login already had).
- **Tests:** `apps/api/src/__tests__/auth.test.ts` (new, 6 tests) — lockout
  after 5 failed attempts rejects even a correct 6th password; a correct
  login before the threshold clears the counter instead of ever locking;
  a nonexistent-email login stays a plain 401; rate-limit trips confirmed
  on register (6th of 6 rapid calls), login (11th of 11), and refresh (21st
  of 21) — mirroring the exact assertion style already used for the
  Mastodon OAuth rate-limit tests.

**Commands run (all green):**
- `apps/api`: `npx tsc --noEmit` clean. `npx vitest run` — **62/62** across
  10 files (6 new).
- Root: `npm run lint` (API typecheck + `next lint`) clean, `npm run build`
  clean (API + web, all 8 web routes still prerender).
- Manual smoke test against a locally running API: confirmed
  `demo@nexus.app`/`password123` still logs in normally (untouched by any
  of this — 0 failed attempts on that account); registered a throwaway
  test account, sent 5 failed logins (each a plain 401), then a 6th with
  the *correct* password and confirmed it came back `423` with a
  `retryAfterSeconds` of 900 (15 minutes) as designed. Deleted the
  throwaway account and stopped the dev server afterward — no data left
  behind.

**Blockers:** None. No new env vars — the lockout thresholds are fixed
constants (5 attempts / 15 minutes), not configurable via `.env`, consistent
with how the refresh token TTLs in B1 are also fixed constants rather than
env-driven.

**Files touched:** `apps/api/prisma/schema.prisma`,
`apps/api/src/lib/loginLockout.ts` (new), `apps/api/src/routes/auth.ts`,
`apps/api/src/__tests__/auth.test.ts` (new), `docs/BACKLOG.md`.

**Next step for the next session:** Read `docs/BACKLOG.md` — B1 and B3 are
both DONE. Take **B2** (password reset + email verification, provider
interface with a console transport in dev — no real email provider needed
to ship the code path) next; **B4** (session list / logout-all) is also
unblocked now but reads better once B2 exists, since a session-list UI
naturally sits next to other account-security settings. Neither needs
external credentials.

### 2026-08-26 — Session 3 (Phase B1: rotating refresh tokens)

**Summary:** Picked B1 next per the previous session's "next step" — auth
hardening, no external credentials needed. Access tokens were previously
JWTs valid for 7 days with no revocation mechanism; an XSS bug or a leaked
token would grant a week of access with no way to cut it off short of
rotating `JWT_SECRET` (which logs out every user, not just the affected
one).

**What shipped:**
- **Schema:** new `RefreshToken` model (`apps/api/prisma/schema.prisma`) —
  `tokenHash` (SHA-256 of the raw token, unique), `expiresAt`, `revokedAt`,
  `replacedByHash` (set when rotated, so a reuse of an already-rotated token
  is a detectable signal), `userAgent`/`ipAddress` (unused yet, laid in for
  Phase B4's session-list UI), `onDelete: Cascade` from `User`. SHA-256 (not
  bcrypt) is correct here: refresh tokens are 32 random bytes, not a
  user-chosen secret, so there's no low-entropy dictionary to slow down.
- **`apps/api/src/lib/refreshTokens.ts`** (new) — `issueRefreshToken()`,
  `rotateRefreshToken()` (returns a discriminated union: `ok` / `invalid` /
  `expired` / `reused`), `revokeRefreshToken()`, `revokeAllForUser()`. On
  `reused`, every one of that user's active tokens is revoked, not just the
  replayed one — reuse of a rotated-away token means the *original* token
  leaked (stolen cookie, replayed request), so every session it could have
  spawned is suspect.
- **`apps/api/src/routes/auth.ts`** — access token TTL dropped from 7d to
  15m. Register/login now call a shared `issueSession()` that mints the
  access token *and* sets the refresh cookie. New `POST /api/auth/refresh`
  (rotates the cookie, mints a fresh access token) and `POST
  /api/auth/logout` (revokes the presented token, clears the cookie;
  intentionally not behind `app.authenticate` — a user with an already-
  expired access token still needs to be able to end their session, and the
  route only ever acts on the cookie's own token). Cookie flags:
  `httpOnly`, `path=/api/auth` (never sent to any other route),
  `sameSite=None; secure` in prod (Vercel web + Railway API is cross-origin
  by design, per `DEPLOY.md`), `sameSite=Lax` in dev (no HTTPS locally).
- **`apps/api/src/app.ts`** — registered `@fastify/cookie` (no `secret`
  option: the cookie's value is itself a high-entropy opaque token, so it
  doesn't need a second signature the way session data would).
- **Web (`apps/web/lib/api.ts`, `lib/auth.tsx`):** `request()` now sends
  `credentials: "include"` on every call and, on a 401 (except login's own
  wrong-password 401), transparently calls a new `tryRefresh()` and retries
  the original request once. Concurrent 401s share one in-flight refresh
  promise rather than each firing their own — the refresh token rotates on
  use, so two independent refresh calls racing on the same stale cookie
  would make the second one look like a token replay and revoke the user's
  own session. `auth.tsx`'s `refresh()` callback no longer skips `api.me()`
  when there's no local access token in `localStorage`; it always calls
  `api.me()`, letting the request layer's silent refresh restore a session
  from the httpOnly cookie alone (a fresh tab, or a tab reopened after the
  15-minute access token expired while the app was closed, no longer forces
  a re-login). `logout()` is now `async`, calls the new `api.logout()`
  endpoint before clearing local state (best-effort — local state clears
  either way even if the network call fails).
- **Tests:** `apps/api/src/__tests__/refreshTokens.test.ts` (new, 10 tests)
  — cookie shape/flags/TTL on register and login, rotation issues a new
  cookie value, the rotated access token works on a protected route,
  rejects no-cookie/garbage-cookie/expired-token refresh attempts, reuse of
  an already-rotated token is rejected *and* revokes a second, independent
  session for the same user (simulating a second device), logout revokes
  the token so a subsequent refresh 401s, logout with no cookie is a
  harmless no-op.

**Commands run (all green):**
- `apps/api`: `npx tsc --noEmit` clean. `npm test` — **56/56** vitest tests
  across 9 files (10 new).
- `apps/web`: `npx tsc --noEmit` clean. `npm run lint` (`next lint`) clean.
  `npm run build` — clean production build, all 8 routes still prerender
  (including the ones using `useSearchParams`, unaffected by this change).
- Manual smoke test against a locally running API (`npm run dev`,
  `prisma db push` confirmed already in sync): logged in as
  `demo@nexus.app`/`password123` via `curl` with a cookie jar — confirmed
  the `nexus_refresh` cookie is set `HttpOnly; Path=/api/auth; SameSite=Lax`
  (dev, correctly not `Secure`/`None` without HTTPS); called `/api/auth/
  refresh` and confirmed the cookie's *value* changed (true rotation) and
  the returned access token worked against `/api/auth/me`; called
  `/api/auth/logout` and confirmed a subsequent `/api/auth/refresh` with the
  same (now-revoked) cookie correctly 401s. (One artifact from this manual
  test, not a bug: the login and refresh calls landed in the same wall-clock
  second, so the two access-token JWTs came out byte-identical — expected
  JWT determinism, same header+payload+secret always signs the same way at
  1-second `iat` granularity; the refresh *cookie*, which is what actually
  carries the security property here, did change value both times.) Dev
  server stopped and scratch cookie/log files cleaned up afterward; no
  stored data left behind.

**Blockers:** None. No new env vars needed — the cookie's `secure`/
`sameSite` derive from the existing `config.isProd`, already set correctly
per-environment.

**Files touched:** `apps/api/prisma/schema.prisma`,
`apps/api/src/lib/refreshTokens.ts` (new), `apps/api/src/routes/auth.ts`,
`apps/api/src/app.ts`, `apps/api/package.json`, `package-lock.json` (via
`npm install @fastify/cookie`), `apps/web/lib/api.ts`,
`apps/web/lib/auth.tsx`, `apps/api/src/__tests__/refreshTokens.test.ts`
(new), `docs/BACKLOG.md`.

**Next step for the next session:** Read `docs/BACKLOG.md` — B1 is DONE.
Take **B2** (password reset + email verification, console transport in dev)
or **B3** (rate-limit auth routes + lockout — `@fastify/rate-limit` is
already a dependency and already used narrowly on the Mastodon OAuth
routes, so B3 is mostly "apply the same pattern to `/api/auth/register`,
`/login`, `/refresh`") next, in either order — neither needs external
credentials. B4 (session list / logout-all) is also now unblocked since B1
shipped `revokeAllForUser()` and per-token `userAgent`/`ipAddress`, but a
session-list *UI* probably reads better after B3's lockout semantics exist,
so do it after B2/B3 rather than immediately.

### 2026-08-26 — Session 2, addendum 2: CodeQL findings on PR #5, fixed (took two attempts)

CodeQL ran on PR #5's push and flagged 3 high-severity findings, all in new
C2 code:

1. **Double-unescaping / incomplete sanitization** (`connectors/mastodon.ts`,
   `stripHtml()`, 2 alerts): entities were decoded *after* tags were
   stripped, so a toot literally containing escaped `<script>` text
   (Mastodon entity-escapes any literal `<`/`>` a user types) would survive
   the tag-strip pass, then get unescaped back into literal, unstripped
   `<script>` text in `RemotePost.content`.
2. **Missing rate limiting** (`routes/mastodonAuth.ts`, both handlers, 1
   alert): neither the register nor callback endpoint had any rate
   limiting. Verified true — no rate limiting exists anywhere in the
   codebase yet (Phase B3 is the tracked item for auth-routes-wide
   limiting). Fixed correctly on the first attempt: added
   `@fastify/rate-limit` scoped narrowly to just these two new routes
   (`global: false`, so nothing else is affected) — register at 5/min
   (before the auth check, since it triggers a real outbound call
   regardless of token validity), callback at 10/min (its only guard,
   since it's deliberately unauthenticated). Regression tests confirm the
   limit actually trips. Pushed as `296ad1e`, stayed fixed.

**First attempt at (1) was wrong.** Reordered the same hand-rolled
`.replace()` chain (decode before strip instead of after) and pushed as
`6f8779e`. Tests passed, so I resolved those two review threads — but
CodeQL re-ran on the next push and flagged the *same two findings again*,
just at the new line numbers. Reordering a regex chain doesn't satisfy a
query built to distrust regex-based HTML processing categorically: even
the reordered chain had a real residual bug (chained, separately-invoked
`.replace()` calls can cascade-decode a double-encoded entity across
steps), and more fundamentally, hand-rolled tag/entity handling can't be
proven complete by a static analyzer no matter how it's arranged.

**Actual fix** (`7c6b723`): stopped hand-rolling this. Replaced the regex
chain with `sanitize-html` (parses with `htmlparser2`, a real HTML parser)
using `allowedTags: []` to remove every tag. Its own output deliberately
keeps HTML-significant characters entity-encoded (it's designed to produce
text still safe to re-embed in HTML) — so a follow-up `decodeSafeEntities()`
only decodes `&amp;`/`&quot;`/`&#39;`/`&apos;` in a *single* regex pass with
one replacer callback, never `&lt;`/`&gt;`. The output can now never contain
a literal `<` or `>` under any input encoding, by construction — and it no
longer silently deletes a user's literal typed angle-bracket text either
(it shows it back safely encoded instead, which the naive tag-strip
approach would have destroyed). Updated the regression test to assert the
new, correct expected output. **Confirmed via a fresh CI run on `7c6b723`**
— all 4 checks (`CodeQL`, `build-and-test`, both `Analyze` jobs) completed
`success` — before resolving the two review threads this time, not before.

**Lesson for future sessions:** when CodeQL (or any static analyzer) flags
hand-rolled string-processing security logic, don't assume a same-technique
patch (reordering, adding one more `.replace()`) actually satisfies it —
verify with a fresh scan on the actual pushed commit before resolving the
thread, and if the same class of finding reappears after a fix, that's a
signal to change *approach* (use a real, recognized library) rather than
keep patching the same regex chain.

Commands: `npm test` 46/46, `npm run lint`, `npm run build` all green after
every fix pass. `sanitize-html` + `@types/sanitize-html` added as
dependencies.

**Next step:** Phase B (auth hardening) is next — unblocked, no external
credentials needed.

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
