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

### 2026-08-27 — Session 7, part 4 (E7: per-target retry + a latent app-wide bug)

**Summary:** E7 per the strategy slice order — `POST /api/posts/:id/retry`
re-attempts only a job's failed targets (rate-limited, race-safe via an
atomic failed→pending claim so a double-clicked retry can never
double-post), with Retry buttons in publishing history and the composer
results panel. Tests written first (6, observed 5/6 red before
implementation). The "live pending→result rows" half is split out as E14.

**The real story — a latent app-wide bug found by live verification:**
the first browser walkthrough of the retry button failed, and the
root cause was NOT the new code: the web client's `request()` always
sent `Content-Type: application/json`, and Fastify 400s any body-less
POST claiming a JSON body (`FST_ERR_CTP_EMPTY_JSON_BODY`). That means
**like, bookmark, logout, logout-all, and resend-verification have been
silently broken in the web UI** — the optimistic like rolled back on
perfectly healthy servers (post-F3 with an error toast; before that,
invisibly). Reproduced via curl before touching anything, fixed by only
sending the header when a body exists, and guarded with a new e2e step
asserting a like persists across reload. Also gave like/bookmark
state-reflecting `aria-label`s + `aria-pressed` (screen-reader users
previously couldn't tell liked state). Lesson repeated from C5's review:
mock- and inject-level tests never send real browser headers — only the
e2e path could catch this, and it only did because the charter insists
on verifying by actually running the UI.

**Commands run (all green):** lint · **22 files / 168 tests** (6 new) ·
build · e2e (now includes the like-regression step) · live walkthrough
with screenshots: a genuinely failed target healed through the history
Retry button (success toast, badges patched in place), like persisting
across reload. DB reseeded.

### 2026-08-27 — Session 7, part 3 (Phase C5: connector resilience)

**Summary:** With C6 shipped, C5 was the last non-parked charter item in
Phase C. Tests were authored first (18 cases in `resilience.test.ts`),
though — honest note — the first execution happened after the
implementation was written, so the red state was never observed for this
slice (unlike part 2's 7/8 observed failures); the tests assert
mock-call counts and breaker state that a pass-through wrapper could not
satisfy, so they are not tautological.

**What shipped:** `src/lib/resilience.ts` + registry wiring + the
`refreshCredentials` seam on `PlatformConnector` +
`ConnectionContext.connectionId` threaded through every call site (see
the C5 backlog note for full behavior). Design decisions worth
remembering: retry only *provably* transient failures — a status-less,
code-less error is indistinguishable from a rejection and is NOT
retried, which also keeps every existing mocked-failure test fast and
unchanged; publish is never auto-retried on a network failure
(double-post risk — recovery is E7's user-driven per-target retry) and
exactly once on 429; the breaker is in-process state, documented as a
single-instance limitation until G1+.

**Commands run (all green):** `npm run lint` · `npm test` — **21 files /
150 tests** (18 new) · `npm run build` · Playwright e2e golden path
(10.7s) against a fresh dev stack — demo connectors are unwrapped, so
the zero-credential path is bit-for-bit unchanged. Live-API resilience
behavior (real 429s, real token expiry) is mock-verified only; real
validation rides on the C1a/C2a human unlocks.

**Ops note for future sessions:** running `npm run build` while `npm run
dev` is up corrupts the web dev server's `.next` (both write it —
"Cannot find module './NNN.js'" 500s). Kill the dev stack or
`rm -rf apps/web/.next` and restart after building.

**Review (outcome):** the adversarial review (2 finders → 3-refuter
panel, 47 agents) confirmed **13 findings** (2 refuted); all 13 fixed in
`c12957d`. The big ones — worth remembering as design lessons:
- **`@atproto` wraps network failures in `XRPCError{status: 1}`**, so
  "status present → judge by status" classified every Bluesky network
  error as non-transient and the entire retry feature was inert for the
  primary live connector. Only 100–599 count as HTTP verdicts now; other
  errors fall through to a cause-chain walk. Lesson: validate error
  classification against the real SDK's error shapes, not hand-built
  test errors.
- **A 60s breaker cooldown can never help a 5-minute sync cadence** —
  by the next tick it had always half-opened. Cooldown is now 10 min,
  the half-open probe is a true single attempt (with a `probing` flag so
  concurrent callers keep failing fast), and every attempt is bounded by
  a 10s per-attempt timeout so a black-holed host can't stall the
  sequential tick for undici's minutes-long defaults.
- **An open breaker was eating the user's own fix**: reconnect with a
  corrected credential failed fast and (worse) the validated candidate
  was then not persisted. User-initiated verification (reconnect route,
  OAuth callback) now resets the breaker first — the human IS the probe,
  and those routes are rate-limited.
- Plus: refresh single-flight per connection (rotating refresh tokens
  are single-use), Retry-After-over-cap fails fast instead of a doomed
  capped retry, retried-publish `latencyMs` re-measured wall-clock (NF03
  analytics honesty), `INTERACTIVE_RESILIENCE` profile for
  browser-blocked routes, breaker-entry eviction on connection delete.
  12 new tests pin all of it. Suite after fixes: **162 passing**; lint,
  build, e2e all green.

### 2026-08-27 — Session 7, part 2 (Phase C6 + C1b: connection health)

**Summary:** Re-derived priority from the reconciled backlog rather than
taking the founder's suggestion on faith — and confirmed it: after A6b/A8
(explicitly low-priority polish) and B6 (cosmetic), the Phase C frontier is
C5 vs C6+C1b; took C6+C1b because it fixes a live defect (a rejected live
credential was invisible in the UI), is the strategy pack's #1 build
recommendation, and gives C5's future circuit-breaker state a place to be
seen. Wrote the failing test first (8 cases, 7 failed on the missing schema
fields), then implemented.

**What shipped:**
- `Connection.lastSyncedAt` / `Connection.lastError` (schema + `prisma db
  push` + regenerate). Every successful timeline fetch — connect-time
  import, reconnect, periodic sync — stamps `lastSyncedAt`, clears
  `lastError`, and sets `status: "active"` (self-heal); every failure
  records the message and flips `status: "error"`. `importInitialTimeline`
  and `syncConnection` share the semantics, so the OAuth callback path
  (`mastodonAuth.ts`) gets them for free.
- `POST /api/connections/:id/reconnect` — ownership-checked; app-password
  platforms may carry a fresh credential (re-encrypted before storage,
  same as connect); credential-less (demo-mode) connections just re-fetch;
  response shape identical to connect (`{ connection, importedPosts,
  warning? }`). `publicConnection()` now exposes the two health fields
  (encrypted material still never serialized).
- Web connections page: per-row "Synced Xm ago" / "Not synced yet",
  status-colored badges (emerald/amber/rose via existing badge classes),
  rose `lastError` strip, per-row **Reconnect** (Mastodon → OAuth
  re-authorization redirect; Bluesky → app-password dialog; demo →
  direct re-fetch), and **Disconnect now requires confirmation** in an
  accessible dialog (role=dialog, aria-modal, labelled, initial focus +
  focus restore, Escape cancels, Tab cycles). C1b: a `warning` on the
  connect/reconnect response renders an amber strip instead of a false
  success. `PLATFORM_META` gained `authKind` (semantic mirror of the API's
  `auth` field) so the UI stops string-matching display labels.
- Seed stamps `lastSyncedAt` so the demo account starts with honest
  health data.

**Commands run (all green, evidence in session scratchpad):**
- `npm run lint` — clean (the same 2 pre-existing `exhaustive-deps`
  warnings, no new ones).
- `npm test` — **20 files / 128 tests** (8 new in
  `connectionHealth.test.ts`, written failing-first).
- `npm run build` — API + web clean.
- `PLAYWRIGHT_CHROMIUM_PATH=… npx playwright test` — e2e golden path
  passed against the running dev stack (9.4s).
- Live headless-browser walkthrough with screenshots (not just selector
  asserts): demo login works; 5 rows show "Synced Xm ago"; a
  DB-simulated errored Mastodon row shows the rose badge + error strip;
  the Disconnect dialog opens with proper roles and closes on Escape
  without disconnecting; the Bluesky Reconnect dialog prompts for an app
  password (cancelled — deliberately never submitted, so no live API was
  called with a fabricated credential, per the charter hard stop); the
  errored Mastodon connection was healed through the real Reconnect
  button (badge → active, "Synced just now", error strip gone).
- DB reseeded to a clean demo state afterward.

**Review:** an adversarial multi-agent review (3 independent finders →
3-refuter verification panel per finding, 45 agents total) ran over the
slice diff before push: 14 raw findings, 12 confirmed (each upheld by
≥2 of 3 refuters), 2 refuted. All 12 were fixed in `9e9bf32` before the
first push. The two HIGH findings were the same root defect: the
Mastodon OAuth callback hard-rejected an already-connected handle, so
the one platform whose reconnect requires re-authorization could never
actually reconnect — the freshly minted token was thrown away. Also
fixed: the reconnect route was an unthrottled outbound
credential-testing oracle (now rate-limited 5/min like the Mastodon
register route); reconnect persisted a candidate credential before
validating it (could destroy a known-good stored app password — now
validate-first); the sync worker's new unconditional health stamp could
throw P2025 on a mid-tick deleted row and abort the whole tick, and a
slow stale tick could clobber a concurrent reconnect's newer state (now
`updateMany` guarded on a new `updatedAt` optimistic-concurrency
column, plus per-connection try/catch in the loop); and five web
focus/state bugs (focus dropped to `<body>` after confirming either
dialog, escapable focus trap via clicks on non-interactive dialog text,
bfcache-stuck "Reconnecting…" button, stale error strip). +4 regression
tests → suite is 132 passing. Focus fixes re-verified live in the
browser (focus lands on the busy button / list heading, never
`<body>`), demo login + reconnect walkthrough re-verified, DB reseeded.

**Blockers:** none for this slice. C3/C4's "waiting on credentials" card
state deliberately stays with those items — no live connector exists for
X/Threads/Instagram yet, so "demo mode" is currently the accurate UI.

**Files touched:** `apps/api/prisma/schema.prisma`,
`apps/api/src/lib/sync.ts`, `apps/api/src/lib/timelineImport.ts`,
`apps/api/src/routes/connections.ts`, `apps/api/src/seed.ts`,
`apps/api/src/__tests__/connectionHealth.test.ts` (new),
`apps/web/lib/types.ts`, `apps/web/lib/api.ts`,
`apps/web/lib/platforms.tsx`,
`apps/web/app/dashboard/connections/page.tsx`, `docs/BACKLOG.md`,
`docs/CAMPAIGN.md`.

**Next step for the next session:** take **C5** (retries, 429 backoff +
jitter, token-refresh hook, per-connection circuit breaker so one dead
platform can't sink `/api/feed`) — the last non-parked charter item in
Phase C, now with C6's `lastError`/status UI to surface its state. Then
E7 (per-target retry) per the strategy pack's slice order.

### 2026-08-27 — Session 7, part 1 (strategy-pack backlog reconciliation)

**Context on arrival:** fresh container; branch
`claude/nexus-1242-autonomous-build-vo8ecx` exists locally at exactly the
default branch's tip (`d7c2e92`, 0 ahead / 0 behind) — its remote copy was
deleted after PR #6 merged, so this session restarts the branch from merged
history per the merged-PR protocol. HEAD is the founder's own upload commit
(`d7c2e92`, "Add files via upload"): an 11-doc strategy pack + interactive
UI prototype, landed in `959/`.

**Arrival verification (all green before any change):** `npm install` →
`cp` both env examples → `npm run db:setup` (demo user + 5 connections +
40 feed posts seeded) → `npm run lint` (API tsc clean; web next-lint clean
with 2 pre-existing `react-hooks/exhaustive-deps` warnings, non-blocking)
→ `npm test` (**19 files / 120 tests, all green**) → `npm run build` (API
+ web clean).

**What shipped (docs only):**
- `git mv 959 docs/strategy` — the pack now lives where the campaign
  prompt and all traceability references expect it; history preserved.
- `docs/BACKLOG.md` reconciled with the pack: **26 new items** (A8, B6,
  B7, C7–C10, D7–D9, E7–E13, F7–F14, G7–G12), every existing item ID
  preserved untouched, each new item traced to its strategy doc + section;
  extra pack detail appended to existing items' Notes (C5, C6, D5, D6, G1,
  G3–G6, B2a, C2b) instead of duplicating them; a "Strategy pack
  reconciliation" section records the prioritization rule
  (charter-phase items outrank future-state items), the staleness
  resolution (pack audited pre-PR-#6; backlog wins on E3/E4/E5/F1/F3/F5
  status), and a **6-entry contradiction register for the founder** (BRD §6
  v1-scope vs DMs/analytics-v2/multi-account; "no new frameworks" vs
  mobile/TanStack/BullMQ/Meilisearch; F5 vs `/pricing`+`/changelog`+`/docs`;
  `/dashboard`→`/app` rename; branding; monetization sequencing). Items
  directly hit by an unresolved contradiction are held at BLOCKED (C10,
  F9, F14, G10) rather than TODO, so no future session silently picks a
  side.

**Next step:** part 2 of this session takes **C6 + C1b** (connection
health UI) — the highest-priority unblocked charter-phase TODO, and the
strategy pack's own #1 build recommendation (`docs/strategy/05` §E.1).

### 2026-08-27 — Session 6 (Phase F1: real analytics)

**Summary:** PR #6 still open (draft, `mergeable_state: clean`, CI green on
`b2c92e1`, no new comments beyond the two already-resolved CodeQL threads
from E3). Picked **F1** — the only Phase F item left besides F2, and its
backlog note ("depends on live connectors existing") is satisfied now that
Bluesky and Mastodon have live connectors alongside the demo ones.

**What shipped:** Checked what analytics already existed before building
anything: `GET /api/dashboard` already returned one lifetime-aggregate
cross-post success rate, but nothing broke it down per platform, nothing
surfaced latency anywhere in aggregate form (only per-job, in publish
history), and "feed volume" was a single lifetime count with no trend.
New `GET /api/analytics` (`apps/api/src/routes/analytics.ts`): per-platform
attempts/success/failure counts, success rate, and average latency
computed from `PublishTarget` rows — latency averaged over *successful*
attempts only, since a failed attempt's `latencyMs` is always 0
(`lib/publish.ts` never times a failure) and mixing it in would understate
real latency for a flaky platform. Also a 14-day feed-volume time series,
bucketed by UTC calendar day and always including zero-count days so a
real gap doesn't get silently compressed away. New web page
`apps/web/app/dashboard/analytics/page.tsx` (added to the sidebar nav
between Feed and Connections): a bar per platform with attempts/success-
rate/latency, and a 14-bar volume chart.

**Commands run:** `npm run lint && npm test && npm run build` — all green
(120/120 tests, 3 new in `analytics.test.ts` covering auth, per-platform
math with mixed success/failure across two platforms, and day-bucketing
including a genuinely empty day and a 30-day-old post correctly excluded
from the 14-day window). Manual smoke test against a live server: reseeded
the demo account, published two real posts through the composer (all 5
demo connectors succeed, so this exercises the real success path with
real per-platform latencies rather than synthetic data), and confirmed via
a headless-browser screenshot that the analytics page renders correct
per-platform success rates/latencies and a populated volume chart.
Reseeded the demo account again afterward so the smoke-test posts don't
linger as fixture data.

**Files touched:** `apps/api/src/routes/analytics.ts` (new),
`apps/api/src/app.ts`, `apps/api/src/__tests__/analytics.test.ts` (new),
`apps/web/app/dashboard/analytics/page.tsx` (new),
`apps/web/app/dashboard/layout.tsx`, `apps/web/lib/types.ts`,
`apps/web/lib/api.ts`, `docs/BACKLOG.md`, `docs/CAMPAIGN.md`.

**Blockers:** None.

**Next step:** Check PR #6 is still open, commit, push. The only remaining
Phase F item is **F2** (bookmarks/likes mirrored to platform where
possible) — this needs new connector-interface methods (each connector
would need a `like`/`bookmark` call, and the demo connectors would need to
simulate success), a bigger lift than F1/F3/F5. Once F2 lands, Phase F is
fully complete and Phase G (Postgres datasource, deploy docs,
observability, security pass, OPERATOR.md) is the only phase left entirely
untouched.

### 2026-08-27 — Session 5 continued (Phase F5: landing page copy fix)

**Summary:** Picked **F5** next — Phase F3 just shipped and pushed, PR #6
still open (draft, `mergeable_state: clean`), CI freshly triggered.
Reviewed `apps/web/app/page.tsx` against the backlog's "no marketing
rewrite" note: the page itself was already well-built, so this was a
review pass for real gaps, not a redesign.

**What shipped:** Found one concrete, genuine bug: the hero badge
hardcoded `"Four networks, one command center"` and the sub-headline
hand-listed `"Twitter, Threads, Bluesky, and Mastodon"` by name — both
went silently stale when Instagram (Phase E5) brought the real platform
count to five, since neither was derived from `PLATFORM_ORDER`. Same
class of bug as E5's `DEMO_HANDLES` fix: a value duplicated by hand
instead of computed from the single source of truth. Fixed both to
derive from `PLATFORM_ORDER`/`PLATFORM_META` — a small number-word
lookup (`NUMBER_WORDS`) for the badge, a comma-and-"and" `joinPlatformNames()`
helper for the sentence — so a sixth platform addition can't leave this
page's copy wrong again without a compile-time nudge to update it.

**Commands run:** `npm run lint && npm test && npm run build` — all
green (117/117 API tests, unaffected). Manual smoke test against a live
dev server with a headless-browser screenshot: confirmed the badge now
reads "Five networks, one command center" and the sub-headline lists all
five platform names correctly, with no layout regression to the
already-generic integrations grid below it.

**Files touched:** `apps/web/app/page.tsx`, `docs/BACKLOG.md`,
`docs/CAMPAIGN.md`.

**Blockers:** None.

**Next step:** Check PR #6 is still open, commit, push. Phase F
remaining: F1 (analytics — unblocked by live Bluesky/Mastodon connectors,
needs scoping) and F2 (platform-mirrored bookmarks/likes — needs new
connector-interface methods, bigger lift). Once those two land, Phase F
is fully complete and Phase G (Postgres datasource, deploy docs,
observability, security pass, OPERATOR.md) is the only phase left
entirely untouched.

### 2026-08-27 — Session 5 (Phase F3: error toasts)

**Summary:** PR #6 still open and green. Picked **F3**, the top TODO item
in Phase F now that Phase E is fully complete. Re-scoped it after actually
reading the code rather than trusting the backlog note: two of the three
named concerns — empty states (feed/connections/history all already had a
dashed-border "no X yet" block) and optimistic UI with rollback
(`PostCard`'s like/bookmark already updated state immediately and rolled
back on a failed request) — were already implemented. A first grep for
`toast\|rollback\|optimistic` came back empty and briefly suggested
*nothing* existed yet; reading `PostCard.tsx` directly showed that grep
had just missed a capitalized `// Optimistic update` comment. The real,
confirmed gap was error toasts: five spots swallowed a failure completely
silently (`.catch(() => {})`), leaving no way for a user to know a
background load or an optimistic rollback had failed.

**What shipped:** New `apps/web/lib/toast.tsx` — a dependency-free
`ToastProvider`/`useToast()` React context, mirroring the existing
`AuthProvider` shape. Stacked, auto-dismissing (5s) toasts in a
fixed-position bottom container; `pointer-events-none` on the wrapper with
`pointer-events-auto` per-toast so the empty space around them never
blocks clicks. Mounted in `app/layout.tsx`, wrapping `AuthProvider`. Wired
`useToast()` into the 5 silent-failure call sites: `PostCard.tsx`'s
`toggleLike`/`toggleBookmark` rollback catches, and the initial background
loads in `dashboard/page.tsx` (overview + history), `dashboard/connections
/page.tsx`, and `dashboard/settings/page.tsx`. Left every failure that
already had a form-adjacent inline `error` state alone (login, register,
composer publish, connect-a-platform, change-password) — toasts are
additive for failures with no natural inline home, not a replacement for
existing inline error UI.

**Commands run:** `npm run lint && npm test && npm run build` — all
green (117/117 API tests unaffected; two pre-existing `react-hooks/
exhaustive-deps` warnings on `connections/page.tsx` and `settings/
page.tsx` are unrelated to this slice and predate it). Manual smoke test
against two live dev servers: logged in as the demo account, loaded the
unified feed, killed the API process mid-session (verified down via a
failed `curl`, not just process-not-found in `ps`), clicked Like on a
post, and confirmed via a headless-browser screenshot that the like
state rolled back **and** a "Couldn't update like. Try again." toast
rendered in the bottom-right corner. Cleaned up both dev servers and the
scratch Playwright script afterward.

**Files touched:** `apps/web/lib/toast.tsx` (new), `apps/web/app/
layout.tsx`, `apps/web/components/PostCard.tsx`, `apps/web/app/dashboard/
page.tsx`, `apps/web/app/dashboard/connections/page.tsx`, `apps/web/app/
dashboard/settings/page.tsx`, `docs/BACKLOG.md`, `docs/CAMPAIGN.md`.

**Blockers:** None.

**Next step:** Check PR #6 is still open, commit this in reviewable
slices (toast lib + layout wiring; the five call-site wirings; docs), push.
Phase F remaining: F1 (analytics — now unblocked by live Bluesky/Mastodon
connectors, needs scoping), F2 (platform-mirrored bookmarks/likes — needs
new connector-interface methods, bigger lift), F5 (landing page polish).
After Phase F, Phase G (Postgres datasource, deploy docs, observability,
security pass, OPERATOR.md) is the only phase left entirely untouched.

### 2026-08-27 — Session 4 continued (Phase E5: Instagram as a full demo platform)

**Summary:** PR #6 still open and green. Picked **E5** — the last open
item in Phase E. Re-scoped it after actually checking the codebase:
Instagram didn't exist as a platform anywhere (config, demo connector,
web types), unlike Threads which already had a demo card even though its
live OAuth (C4) is still `WAITING-ON-HUMAN`. So this was "stand up a new
platform, demo-only" rather than the one-line char-limit tweak the
backlog note originally implied.

**What shipped:** Added `instagram` to `apps/api/src/config.ts`'s
`PLATFORMS` (2200 char limit, brand color, oauth-shaped like Threads),
`apps/api/src/connectors/demo.ts`'s `AUTHORS`/`SNIPPETS` records,
`apps/web/lib/types.ts`'s `PlatformId` union, and
`apps/web/lib/platforms.tsx`'s `PLATFORM_META`/`PLATFORM_ORDER`/
`ICON_PATHS` (real Instagram brand glyph). Confirmed first that every
other consumer — the connect UI, feed platform filter, publish char-limit
validation, demo image/avatar generation — is already generic over
`PLATFORM_IDS`/`PLATFORM_ORDER`, so nothing else needed to change to get
a fully working demo platform.

**Found a real bug while smoke-testing:** `apps/api/src/seed.ts`'s
`DEMO_HANDLES` lookup was typed `Record<string, string>` rather than
`Record<PlatformId, string>`, so the missing `instagram` key wasn't a
compile error — it was a runtime crash on `npm run db:setup`
(`PrismaClientValidationError: Argument handle is missing`). Fixed both
the immediate gap (added the entry) and the root cause (retyped to
`Record<PlatformId, string>`, so this class of bug is now a build failure
instead of a broken `db:setup` the next time a platform is added).

**Commands run:** `npm run lint && npm test && npm run build` — all
green (117/117 API tests unaffected, since Instagram flows through
entirely generic code paths). `npm run db:setup` failed once (the seed
bug above), fixed, then succeeded cleanly (5 platform connections, 40
feed posts). Manual smoke test against a live server with a real
headless-browser walkthrough (not just types passing): screenshotted
`/dashboard/connections` (Instagram card renders with the right icon,
color, and connects successfully — "Your connections" shows 5) and
`/dashboard/feed` (Instagram demo posts, including demo images, appear
correctly in the unified timeline alongside the other four platforms).

**Files touched:** `apps/api/src/config.ts`, `apps/api/src/connectors/demo.ts`,
`apps/api/src/seed.ts`, `apps/web/lib/types.ts`, `apps/web/lib/platforms.tsx`,
`docs/BACKLOG.md`, `docs/CAMPAIGN.md`.

**Blockers:** None. Live Instagram OAuth (real Meta developer app) remains
parked as `C4`, `WAITING-ON-HUMAN`, unaffected by this slice.

**Next step:** Check PR #6 is still open, commit this in reviewable
slices, push. Phase E is now fully complete (E1–E6 all `DONE`). Remaining
open work is entirely Phase F: F1 (analytics — depends on live connectors
existing, still mostly blocked), F2 (platform-mirrored bookmarks/likes),
F3 (empty states/toasts — `PostCard` already has optimistic UI w/ rollback
for like/bookmark, worth a scoping pass before assuming untouched), F5
(landing page polish). After Phase F, Phase G (production hardening:
Postgres datasource, deploy docs, observability, security pass, OPERATOR.md)
is the only phase left untouched. Check the Parked/WAITING-ON-HUMAN
section of `BACKLOG.md` for any new credentials before picking the next
phase.

### 2026-08-26 — Session 4 continued (Phase E4: per-target status UI polish)

**Summary:** PR #6 (Phase E3) still open and green (CI + CodeQL both
clean after the path-injection fix). Picked **E4** next — the highest-
priority unblocked `TODO`.

**What shipped:** Scoped E4 by reading the dashboard's publishing-history
list (`apps/web/app/dashboard/page.tsx`) against what `GET /api/posts/history`
already returns. Found a real bug: every target whose status wasn't
`"success"` rendered as a red failed badge, including `"pending"` — a
scheduled post not yet due showed as a false failure. Fixed with a new
`.badge-pending` (amber) style and a three-way branch instead of a
binary one. Also wired up two fields the API already returned but the UI
silently dropped: a failed target's `error` message (previously
invisible) and a successful target's `latencyMs` (mirrors the composer's
own "Posted in Xs" wording). `job.scheduledAt` now shows next to the
timestamp when set. No backend changes — `posts.ts` already returned
everything needed.

**Commands run:** `npm run lint && npm test && npm run build` — all
green (117/117 API tests, unaffected since this was a web-only change).
Manual smoke test against a live server with three genuine states (not
just visual inspection): a real immediate success (published to Bluesky),
a real scheduled-but-not-due post (Mastodon, correctly shows "Pending"),
and a real failure — scheduled a post to Twitter, disconnected Twitter,
then fired `/internal/tick` to force a genuine since-disconnected-platform
failure with a real error message, confirmed via a headless-browser
screenshot that all three states render correctly and honestly. One
near-miss during cleanup: an ad-hoc Prisma `deleteMany` intended to clear
smoke-test data was scoped to `email: { contains: "demo@nexus.app" } }` —
which matches the permanent demo account itself, not just smoke-test
leftovers. The command was interrupted by the sandbox before it ran
(confirmed via a fresh `findUnique` immediately after), but the close
call is worth recording: any future cleanup should reseed via
`npm run db:setup` (which fully overwrites to a known-good state) rather
than hand-scoping deletes against real fixture data. Reseeded and
confirmed the demo account and all 4 connections are intact.

**Files touched:** `apps/web/app/dashboard/page.tsx`,
`apps/web/app/globals.css`, `docs/BACKLOG.md`, `docs/CAMPAIGN.md`.

**Blockers:** None.

**Next step:** Check PR #6 is still open (it should be — this continues
the same slice), commit this in reviewable slices, push. After E4:
E5 (Instagram char-limit preview — needs standing up Instagram as a
platform from scratch) and the rest of Phase F (F1 analytics, F2
platform-mirrored bookmarks/likes, F3 empty-states/toasts — `PostCard`
already has optimistic UI w/ rollback for like/bookmark, worth a scoping
pass before assuming untouched, F5 landing page polish) remain. Check the
Parked/WAITING-ON-HUMAN section of `BACKLOG.md` for any new credentials
before picking the next phase.

### 2026-08-26 — Session 4 (Phase E3: media upload pipeline)

**Summary:** PR #5 (Phase C2, carrying forward every phase through F6) was
merged by a human. Per this repo's "a merged PR is finished" convention,
restarted `claude/nexus-production-build-s6p5hz` from the current default
branch (`autonomous-agent-setup-6249396920522474145`) — a plain
`git merge --ff-only` was safe since the branch's prior head was already
fully contained in the new base (nothing unmerged to carry forward), and
pushed the restarted branch. Picked **E3** (media upload pipeline) next —
the highest-priority unblocked `TODO` in Phase E.

**What shipped:** New `MediaStorage` interface (`apps/api/src/lib/mediaStorage.ts`)
with a `LocalDiskStorage` default — same "ship a fully-working default,
gate the real backend behind env" split this campaign already used for
`EmailProvider`/`ConsoleEmailProvider` (Phase B2), since no S3-compatible
bucket or credentials exist yet (parked `WAITING-ON-HUMAN` as `E3a`).
`POST /api/media/upload` (new `apps/api/src/routes/media.ts`, authenticated,
rate-limited 20/min via `@fastify/multipart`): accepts one image
(jpeg/png/gif/webp), 10MB max, stores it under a random UUID-based
filename — never the client-supplied name — and returns `{ url, key }`
directly usable in `POST /api/posts`'s existing `mediaUrls` field.
`GET /uploads/:key` serves it back; the key must match a strict
`UUID.ext` pattern before ever touching disk, which rules out path
traversal by construction rather than by sanitizing client input. Web:
`Composer` gained an "add photo" control (up to 4 images, matching the
existing `mediaUrls` cap), sequential uploads (keeps order == selection
order, avoids bursting the rate limit on a multi-file drop), thumbnail
previews with per-image remove, "Post" disabled mid-upload.

**Commands run:** `npm run lint && npm test && npm run build` — all
green (117/117 tests, +6 new in `media.test.ts`: auth required, a real
PNG round-trips byte-for-byte through upload → serve, rejects a
disallowed MIME type, rejects a real 11MB file — genuinely oversized, not
a mocked check — rejects a request with no file field, and the serving
route 404s a well-formed-but-missing key vs. 400s a malformed one).
Manual end-to-end smoke test against a live server: logged in as
`demo@nexus.app`, uploaded a real PNG via `curl`, confirmed the served
file was byte-identical to the original (`cmp`), then published a post
carrying that media URL and confirmed it published successfully — all
with zero third-party credentials. Cleaned up the local `uploads/`
directory afterward (gitignored either way).

**Files touched:** `apps/api/src/lib/mediaStorage.ts` (new),
`apps/api/src/routes/media.ts` (new), `apps/api/src/__tests__/media.test.ts`
(new), `apps/api/src/app.ts`, `apps/api/package.json`,
`apps/web/components/Composer.tsx`, `apps/web/lib/api.ts`, `.gitignore`,
`docs/BACKLOG.md`, `docs/CAMPAIGN.md`.

**Blockers:** None for the local-disk path. `E3a` (S3-compatible storage)
parked `WAITING-ON-HUMAN` — needs a real bucket + credentials; the swap-in
point is documented in `BACKLOG.md`.

**Next step:** Check for an open PR on this restarted branch (none should
exist yet — open a new draft PR and subscribe to its activity). After
that, remaining open items: E4 (per-target status UI polish — API already
returns it), E5 (Instagram char-limit preview — needs standing up
Instagram as a platform from scratch), and Phase F (F1 analytics, F2
platform-mirrored bookmarks/likes, F3 empty-states/toasts — `PostCard`
already has optimistic UI w/ rollback for like/bookmark, worth a scoping
pass before assuming untouched, F5 landing page polish). Check the
Parked/WAITING-ON-HUMAN section of `BACKLOG.md` for any new credentials
before picking the next phase.

### 2026-08-26 — Session 3 continued a tenth time (Phase F6: Playwright smoke test + CI wiring; F4 backlog correction)

**Summary:** Checked PR #5's CI on the E6 push before continuing — green.
Picked **F6** (Playwright smoke test) next. While scoping F4 (light/dark
theme) to see if it was still open, found it was already fully implemented
pre-session — `darkMode: "class"` in the Tailwind config plus an existing
`apps/web/lib/auth.tsx` effect already toggle the document's dark class off
`user.theme`, and the settings page already has a working theme selector.
Verified with a real reload + headless-browser screenshot rather than just
trusting the code read. Corrected `docs/BACKLOG.md`'s F4 row from stale
`TODO` to `DONE (pre-existing, verified 2026-08-26)` rather than re-doing
already-finished work.

**What shipped (F6):** `apps/web/playwright.config.ts` (new) — array
`webServer` starting both the API dev server (`:4000/health`) and the web
dev server (`:3000`), single `chromium` project via
`devices["Desktop Chrome"]` with an optional `PLAYWRIGHT_CHROMIUM_PATH`
override for this sandbox's nonstandard browser path. `apps/web/e2e/smoke.spec.ts`
(new) — one golden-path test against the real demo-connector stack (no
mocks, no third-party credentials): register a fresh account → connect
Twitter/X as a demo connection → feed loads real imported posts → compose
and publish a post → publish history on the dashboard shows it. Found and
fixed one locator bug during development: `getByRole("button", { name: /Twitter \/ X/ })`
matched both the platform-selector button ("Twitter / X") and the
"Connect Twitter / X" submit button — resolved with
`{ name: "Twitter / X", exact: true }`. Verified passing twice locally on a
fresh cold start (10.2s, then 9.3s), test-results/report artifacts cleaned
up afterward. Added `@playwright/test` as an `apps/web` devDependency and a
`test:e2e` script. Wired a new `e2e` job into `.github/workflows/ci.yml`,
`needs: build-and-test` (so a browser install + full e2e run only happens
once lint/unit tests/build already passed): installs Playwright's Chromium
with `--with-deps`, runs `npm run test:e2e -w @nexus/web`, uploads the HTML
report as a build artifact only `if: failure()`. Gitignored
`apps/web/{test-results,playwright-report,blob-report}/`.

**Commands run:** `npm run lint`, `npm test` (full 111-test API suite,
unaffected by web-side changes), `npm run build` — all green. Local
Playwright run (`npm run test:e2e -w @nexus/web`) passed twice in a row
against fresh cold-start dev servers.

**Files touched:** `apps/web/playwright.config.ts` (new),
`apps/web/e2e/smoke.spec.ts` (new), `apps/web/package.json`,
`apps/web/package-lock.json`, `.gitignore`, `.github/workflows/ci.yml`,
`docs/BACKLOG.md`, `docs/CAMPAIGN.md`.

**Blockers:** None.

**Next step:** Check PR #5 is still open and fetch shows no divergence,
then commit this slice (small reviewable commits: Playwright config +
dependency, the smoke spec, the CI job, docs) and push. After F6, the
remaining open items are E3 (media upload pipeline — the biggest lift left
in Phase E), E4 (per-target status UI polish), E5 (Instagram char-limit
preview — now understood to require standing up Instagram as a new
platform from scratch, not a one-line `PLATFORM_META` tweak), and the rest
of Phase F (F1 analytics, F2 platform-mirrored bookmarks/likes, F3
empty-states/toasts — note `PostCard` already has optimistic UI w/ rollback
for like/bookmark, so F3 may be partially done already and worth a scoping
pass before assuming it's untouched, F5 landing page polish). Check the
Parked/WAITING-ON-HUMAN section of `BACKLOG.md` for any new human-supplied
credentials before picking the next phase.

### 2026-08-26 — Session 3 continued a ninth time (Phase E6: idempotency keys, plus fixing a test-suite flake my own test exposed)

**Summary:** Checked PR #5's CI on the E2 push before continuing — green
across all 4 checks, `mergeable_state: "clean"`, PR now 49 commits /
~5950 additions. Picked **E6** (idempotency keys) over E5 (Instagram
char-limit preview) — E5 turned out bigger than it looked, since Instagram
isn't wired as a platform anywhere in the codebase yet (unlike Threads,
which already is), so "just add the char limit" would mean standing up a
whole new platform's demo data/UI entries for a card with no connector
behind it. E6 had a crisp, well-understood shape instead.

**What shipped:**
- **`PublishJob.idempotencyKey`** (nullable, `@@unique([userId,
  idempotencyKey])` — SQL's normal null-handling means multiple `null`s
  never collide, so a caller that never sends a key is completely
  unaffected). `POST /api/posts` accepts an optional `idempotencyKey`; a
  repeated request with the same one returns the *original* job's current
  state (`200`, not `201` — nothing new was created) instead of publishing
  again.
- **Actually race-safe, not just check-then-create**: the obvious
  "look up by key, create if missing" has a real TOCTOU gap — two
  requests can both pass the lookup before either commits. Handled by
  catching the unique-constraint violation (`P2002`) the *second* create
  hits and turning it into "fetch and return whichever request won" rather
  than a 500. Verified this actually matters, not just in theory: fired two
  genuinely simultaneous real `curl` requests (backgrounded with `&`, not
  sequential `await`s) with the same key against a live server — both
  returned the same `jobId` (one showed `"pending"`, the other `"success"`,
  since one request's response was read mid-flight while the winner's
  publish was still running — a legitimate snapshot of an in-flight job,
  not a bug), and confirmed via `/api/feed` that exactly one post existed
  afterward.
- **Web**: `Composer.tsx` generates a UUID once per mount via
  `useState(() => crypto.randomUUID())`. Confirmed this gives the right
  lifecycle by checking how it's actually rendered
  (`dashboard/layout.tsx`'s `{composerOpen && <Composer .../>}`) — the
  component fully unmounts on close, so a fresh compose session always
  gets a fresh key, while clicking "Post" again after a dropped response
  within the *same* open session reuses the same one (a correct retry, not
  a new post). `lib/api.ts`'s `publish()` gained the parameter.
- **A real test-suite flake, found and root-caused by my own new test**:
  the "truly concurrent requests" test (two real `Promise.all`-fired HTTP
  requests within one test, needed to actually exercise the P2002 recovery
  path rather than just the sequential-retry path) started making the
  *full* suite intermittently fail — not in its own file, but in
  `internal.test.ts`, with a response missing an expected field entirely.
  Root-caused properly rather than shrugging it off as "flaky": stashed
  the E6 changes, ran the full suite twice on the prior (E2) commit —
  clean both times — confirming this was newly introduced, not
  pre-existing. The cause: vitest runs test *files* in parallel by
  default, and this repo's tests have no per-file DB isolation — all 17
  files hit the same physical `./dev.db` SQLite file. SQLite is
  single-writer; a write colliding with another file's concurrent write
  fails immediately ("database is locked") rather than queuing, and that
  failure can surface in whatever unrelated file happened to be writing at
  that instant — exactly the `internal.test.ts` symptom. First attempt at
  a fix (`PRAGMA busy_timeout` set once in `db.ts`) didn't work and was
  reverted: Prisma's query engine keeps an internal connection pool, and a
  PRAGMA applied via one raw query only takes effect on *that* specific
  pooled connection, not the others real concurrent load would actually
  use. (This attempt also briefly broke every test file: `PRAGMA busy_timeout
  = N` returns a result row, so it needs `$queryRawUnsafe`, not
  `$executeRawUnsafe` — caught immediately since the whole suite failed to
  even load, not silently wrong.) The real fix: `apps/api/vitest.config.ts`
  (new) with `fileParallelism: false` — tests within a file were already
  sequential by default, this just extends that to files too. Confirmed by
  running the full suite twice clean after the fix (not just once).
- **Tests**: 4 new tests in `apps/api/src/__tests__/posts.test.ts` (new
  describe block) — a retried request returns the original job without
  creating a second one or publishing again, the genuinely-concurrent race
  case above, a different key creates a real separate post, omitting the
  key entirely still works (backward compatible, multiple keyless posts
  coexist fine).

**Commands run (all green, after the flake was fixed):**
- `apps/api`: `npx tsc --noEmit` clean. `npx vitest run` — **111/111**
  across 17 files (4 new), run twice to confirm no flake remained.
- Root: `npm run lint` (API typecheck + `next lint`) clean. `npm run build`
  — API clean; web clean, all 10 routes still prerender.
- Manual smoke test against a locally running API: `demo@nexus.app` login
  unaffected; fired two real concurrent `curl -X POST /api/posts` (via
  shell backgrounding, not sequential) with the same `idempotencyKey` —
  both returned the same `jobId`; confirmed via `/api/feed` that exactly
  one post was created despite the real race. Deleted the throwaway
  post/job afterward; stopped the dev server.

**Blockers:** None. No new env vars.

**Files touched:** `apps/api/prisma/schema.prisma`,
`apps/api/src/routes/posts.ts`, `apps/api/vitest.config.ts` (new),
`apps/api/src/__tests__/posts.test.ts`, `apps/web/lib/api.ts`,
`apps/web/components/Composer.tsx`, `docs/BACKLOG.md`.

**Next step for the next session:** Read `docs/BACKLOG.md` — Phase E now
has E1, E2, and E6 all `DONE`. **E3** (media upload pipeline) is the
biggest remaining Phase E lift; **E4** (per-target status in the composer/
history UI — the API already returns it, this is UI polish) and **E5**
(Instagram char-limit preview — now understood to actually require
standing up Instagram as a new platform, not a one-line tweak) are the
other open items. Phase F (product surface: empty states, optimistic UI,
a Playwright smoke test) is also fully open and may be worth a look if
Phase E's remaining items all feel bigger than a clean single-session
slice. As always, check Parked/WAITING-ON-HUMAN for new credentials first.

### 2026-08-26 — Session 3 continued an eighth time (Phase E2: scheduled send worker, and a second real bug found by reading the existing code)

**Summary:** Checked PR #5's CI on the D4 push before continuing — green
(`CodeQL`, `build-and-test`, both `Analyze` jobs `success`, `mergeable_state:
"clean"`). D6 (search) needs Phase G1 (real Postgres) to be worth doing
properly, so moved to **Phase E** instead, per the D4 entry's own note.
Picked **E2** (scheduled send worker) — `.env.example` already documented
the intended design (`CRON_SECRET` + `POST /internal/tick`) from a much
earlier session, so the shape of this slice was already decided; it just
hadn't been built.

**What shipped:**
- **The bug, found while reading `routes/posts.ts` to scope this**:
  `POST /api/posts` already accepted `scheduledAt` in its request schema
  and stored it on the `PublishJob` row — but then published to every
  platform immediately regardless, unconditionally, every time. A user
  "scheduling" a post for tomorrow would actually have it posted right
  now. The web composer never exposed a scheduling control (confirmed by
  grepping the whole `apps/web` tree for `schedule`), so this was
  unreachable from the actual product — but it's exactly the kind of
  latent, API-only gap this session has been catching by reading code
  closely rather than assuming an existing field was wired up correctly
  (echoes the D2 pagination bug from earlier today, and the B4
  reuse-detection cascade before that).
- **`lib/publish.ts`** (new) — `attemptPublish()`: publishes to one
  platform and records the outcome on an *existing* `PublishTarget` row
  (never creates a new one), so the immediate-publish path and the tick
  worker share identical logic instead of two copies drifting apart.
  `runDueScheduledSends()`: finds every `PublishJob` with `scheduledAt` in
  the past that still has pending targets, and publishes them — critically,
  re-resolving each user's `Connection` fresh at send time rather than
  trusting anything decided when the post was scheduled, so a user who
  reconnected (or disconnected) a platform in between gets correct
  behavior either way.
- **`routes/posts.ts`** rewritten: every `PublishTarget` is now created
  `"pending"` up front (the model already had this as its default status —
  it just was never actually used); a due-or-unscheduled post is published
  immediately right after via the same `attemptPublish()`, while a future
  one is left pending and returned to the client as `"pending"` rather than
  `"success"`/`"failed"`.
- **`routes/internal.ts`** (new) — `POST /internal/tick`: `x-cron-secret`
  header checked with `crypto.timingSafeEqual` (not `===`, to avoid a
  timing side-channel on the secret compare — consistent with this
  session's security rigor elsewhere). Unset `CRON_SECRET` falls back to a
  fixed, exported-for-tests dev-only secret in non-production (mirrors
  `lib/crypto.ts`'s `DATA_KEY` pattern exactly), and hard-503s in
  production instead of silently accepting a guessable default. Rate-
  limited (30/min) as defense in depth, generous enough not to false-
  positive a real cron's cadence. **Deliberately an external-cron design,
  not an in-process timer like D1's feed sync** — the two phases made
  different tradeoffs on purpose: missing a feed-sync tick just delays a
  refresh, but a scheduled *send* firing at the wrong time is a much
  worse failure mode, and an external cron keeps firing on schedule across
  API restarts/redeploys where an in-process timer resets. Documented this
  reasoning directly in the route's own comment so a future session
  doesn't "simplify" it into a setInterval and lose the property that made
  it worth building this way.
- **Tests**: `apps/api/src/__tests__/posts.test.ts` (new — `posts.ts` had
  zero coverage before this) — immediate publish unchanged, a future
  `scheduledAt` stays pending and touches neither the connector nor the
  feed, a past `scheduledAt` still publishes immediately (boundary check),
  missing-connection rejection still works for both paths.
  `apps/api/src/__tests__/internal.test.ts` (new, 6 tests) — auth rejection
  (no secret, wrong secret), a due job's pending target publishes while a
  future one stays untouched, a connector failure at send time is recorded
  without crashing the tick, a since-disconnected platform is recorded as
  a clear failure rather than crashing, rate limiting trips at 30/min.

**Commands run (all green):**
- `apps/api`: `npx tsc --noEmit` clean. `npx vitest run` — **107/107**
  across 17 files (10 new: 4 in `posts.test.ts`, 6 in `internal.test.ts`).
- Root: `npm run lint` (API typecheck + `next lint`) clean. `npm run build`
  — API clean; web clean (unaffected, all 10 routes still prerender).
- Manual smoke test against a locally running API — the real payoff of
  testing this end-to-end rather than trusting the unit tests alone:
  confirmed `demo@nexus.app` still logs in; scheduled a post 1 hour out via
  the real API and confirmed the response said `"pending"`, not
  `"success"`; called `/internal/tick` with no secret (401), the wrong
  secret (401), and the real dev-fallback secret (200, correctly
  `jobsProcessed: 0` since nothing was due yet); backdated that job's
  `scheduledAt` directly in the DB to simulate an hour passing; called
  `/internal/tick` again and confirmed `jobsProcessed: 1, targetsPublished:
  1`; confirmed via `/api/feed` that the published post actually appears
  there, `isOwn: true`. Deleted the throwaway job/feed post afterward;
  stopped the dev server.

**Blockers:** None. No env vars required for this to work locally (the dev
fallback secret covers it); `CRON_SECRET` documented in `.env.example` for
whoever wires up the actual external cron in production.

**Files touched:** `apps/api/src/config.ts`, `apps/api/src/lib/publish.ts`
(new), `apps/api/src/routes/posts.ts`, `apps/api/src/routes/internal.ts`
(new), `apps/api/src/app.ts`, `apps/api/.env.example`,
`apps/api/src/__tests__/posts.test.ts` (new),
`apps/api/src/__tests__/internal.test.ts` (new), `docs/BACKLOG.md`.

**Next step for the next session:** Read `docs/BACKLOG.md` — Phase E now
has E1 and E2 both `DONE`. **E3** (media upload pipeline — local disk dev,
S3-compatible prod) is the natural next Phase E item, though it's a bigger
lift than most slices this session (needs an actual upload endpoint, not
just URL passthrough) — consider whether **E5** (per-platform char-limit
preview, adding Instagram to `PLATFORM_META`) or **E6** (idempotency keys
to prevent double-post on double-click) are faster wins first. As always,
check the Parked/WAITING-ON-HUMAN section for new credentials before
assuming Phase E/F is still the right phase to be in over Phase C's gated
items.

### 2026-08-26 — Session 3 continued a seventh time (Phase D4: media rendering — images)

**Summary:** Checked PR #5's CI on the D2 push before continuing — green
(`CodeQL`, `build-and-test`, both `Analyze` jobs all `success` this time,
`mergeable_state: "clean"`, same 5 already-resolved review threads, no new
ones). Picked **D4** (media rendering, images first) next — independent of
D1-D3, no datasource dependency the way D6 (search) would have (Phase G1's
Postgres migration is still `TODO`, so investing in "real" search now would
be premature).

**What shipped:**
- **The gap**: the API already carried `FeedPost.mediaUrls` end-to-end —
  live Bluesky/Mastodon connectors (Phase C) already extract image URLs
  from real timelines, `/api/feed` already serializes and returns them —
  but `apps/web/components/PostCard.tsx` never rendered them. A real
  connected account's photos were silently dropped on the floor.
- **`MediaGrid`** (new component in `PostCard.tsx`): 1 image keeps its own
  aspect ratio, capped at a max height; 2 or 4 images render as even
  squares; 3 renders the familiar one-tall-image-beside-two-stacked layout
  (via CSS grid `row-span-2`) rather than a naive uniform grid, which looks
  cramped for a single wide photo and awkward for three. Every image links
  out to the full-size original in a new tab. Inserted between the post
  content and the like/repost/reply/bookmark action bar.
- **Demo data gap this exposed**: `DemoConnector.fetchTimeline` always
  returned `mediaUrls: []` — meaning the always-must-work, zero-credential
  demo path would never have shown the new UI at all. Fixed by giving demo
  posts deterministic sample images: `demo.ts` gained `demoImageFor()`
  (a colored-gradient SVG, picked from a small deterministic palette) and
  `demoMediaUrlsFor()` (roughly a third of posts get 1-2 images), using the
  exact same dependency-free inline-SVG-data-URI technique already
  established for `avatarFor()` — no external network calls, consistent
  with this session's demo-data conventions and this sandbox's restricted
  egress.
- **Tests**: `connectors.test.ts` gained a test asserting the new demo
  media generation is deterministic (same seed → same URLs across two
  calls), that at least some posts have images and some don't, and that
  every generated URL is a well-formed inline SVG data URI.
- **Actually looked at it, not just "should render"**: re-seeded the dev
  DB (existing seeded posts predated the demo-image change) and used a
  headless-browser screenshot (Playwright + the sandbox's pre-installed
  Chromium — global install, wired up via `NODE_PATH`/an explicit
  `executablePath` since it isn't a project dependency) of the actual
  `/dashboard/feed` page, logged in as `demo@nexus.app`, to visually
  confirm both single- and two-image posts render with the intended
  layout, spacing, and rounded corners consistent with the rest of the UI
  — not just that the build succeeded.

**Commands run (all green):**
- `apps/api`: `npx tsc --noEmit` clean. `npx vitest run` — **97/97** across
  15 files (1 new test, no new file).
- Root: `npm run lint` (API typecheck + `next lint`) clean. `npm run build`
  — API clean; web clean, all 10 routes still prerender (the feed page's
  bundle grew slightly, 5.78kB → 6.01kB, from the new `MediaGrid`).
- Manual smoke test: re-ran `db:setup` to regenerate demo data with the new
  image logic, started both dev servers, screenshotted the real feed page
  in a headless browser as described above. Screenshot and the ad hoc
  Playwright script deleted afterward; both dev servers stopped.

**Blockers:** None. No new env vars. Video rendering is explicitly out of
scope for this slice, per the backlog item's own "images, then video"
phrasing — noted as still open in `docs/BACKLOG.md`.

**Files touched:** `apps/api/src/connectors/demo.ts`,
`apps/api/src/__tests__/connectors.test.ts`,
`apps/web/components/PostCard.tsx`, `docs/BACKLOG.md`.

**Next step for the next session:** Read `docs/BACKLOG.md` — D1-D4 are all
DONE (D4 for images; video remains open). **D6** (non-naive search) is the
last unstarted Phase D item, but is better sequenced after **G1** (real
Postgres datasource) given `mode: "insensitive"` and other richer search
options aren't available on SQLite — worth checking G1's status before
picking D6 up as-is versus doing a smaller SQLite-compatible improvement
(e.g. searching `authorName`/`authorHandle` too, not just `content`) in the
meantime. Otherwise, Phase E (publishing) or Phase F (product surface) are
reasonable next phases if a human hasn't supplied new Phase C credentials.

### 2026-08-26 — Session 3 continued a sixth time (Phase D2: stable cursor pagination)

**Summary:** Checked PR #5's CI on the D1/D3 push before continuing — all
green (`build-and-test`, both `Analyze` jobs `success`; `CodeQL` showed
`neutral` rather than `success` this time, which was worth double-checking
rather than assuming — re-read the review threads and confirmed no new
findings appeared, so `neutral` here is just how that check reports "ran,
nothing new," not a partial failure), `mergeable_state: "clean"`. Picked
**D2** next per the backlog's own note — it's flagged "mostly done, verify
under concurrent writes," and D1's new periodic sync makes that concern
concrete for the first time (before D1, a feed was static after connect;
now it keeps growing while a client might be mid-pagination).

**What shipped:**
- **The bug**: `routes/feed.ts`'s `/api/feed` ordered strictly by
  `{ postedAt: "desc" }`. `postedAt` isn't unique — two posts easily land on
  the same value (demo data, or a burst of real activity). Prisma's cursor
  pagination anchors on `{ cursor: { id }, skip: 1 }` and then continues in
  query order — but query order among rows tied on `postedAt` is
  unspecified unless the `orderBy` itself breaks the tie. Nothing stops two
  separate paginated queries (page 1's initial fetch, then page 2's
  cursor-anchored fetch) from ordering a set of tied rows differently,
  which silently skips or repeats a row across pages.
- **The fix**: `orderBy: [{ postedAt: "desc" }, { id: "desc" }]` — a single
  line. `id` is already unique, so this makes the full ordering
  deterministic regardless of how many rows share a `postedAt`.
- **Tests**: `apps/api/src/__tests__/feed.test.ts` (new — `/api/feed` had
  *zero* test coverage before this) — 5 tests: platform filter, search
  filter, bookmarked filter, cross-user isolation, and the main one:
  create 10 posts all sharing the exact same `postedAt`, paginate through
  with `limit=3` via the real cursor mechanism, assert every post is seen
  exactly once with nothing skipped or duplicated across pages.
- **An honest wrinkle, caught by actually trying to prove the test would
  fail without the fix rather than just trusting it passed**: temporarily
  reverted the `orderBy` to the old single-key version and reran the new
  pagination test — it **still passed**. Traced this to SQLite (this
  repo's dev/test datasource) happening to preserve insertion order for
  tied rows within a single unmutated table across repeated queries in one
  process — that's implementation behavior SQLite doesn't actually
  guarantee, not a real absence of the bug, and Postgres (production) makes
  no such promise at all — a different query plan, an index Postgres
  decides to use, or a genuinely concurrent write landing between two
  paginated requests can break ties differently there. Restored the fix
  (confirmed the diff came back byte-identical to before the revert) and
  documented this caveat directly in the test's own comment rather than
  letting it quietly overclaim what it proves. The fix itself is still
  correct and worth having — SQLite happening to hide the bug in this one
  test scenario isn't a reason not to fix a real latent correctness issue
  that Postgres would expose.

**Commands run (all green):**
- `apps/api`: `npx tsc --noEmit` clean. `npx vitest run` — **96/96** across
  15 files (5 new). Also specifically re-ran just the new pagination test
  against the reverted (pre-fix) code to check whether it would catch the
  bug — see the honest wrinkle above.
- Root: `npm run lint` (API typecheck + `next lint`) clean. `npm run build`
  — API clean; web clean (unaffected, all 10 routes still prerender).
- Manual smoke test against a locally running API: logged in as
  `demo@nexus.app`, fetched two real pages of the feed via the actual
  cursor mechanism (`limit=5` each), confirmed zero id overlap between the
  pages.

**Blockers:** None. No new env vars.

**Files touched:** `apps/api/src/routes/feed.ts`,
`apps/api/src/__tests__/feed.test.ts` (new), `docs/BACKLOG.md`.

**Next step for the next session:** Read `docs/BACKLOG.md` — D1, D2, and D3
are all DONE. **D4** (media rendering: images now, video later) and **D6**
(non-naive search, replacing the `contains` scan) are the remaining
unstarted Phase D items, independent of each other and of D1-D3. As
always, check the Parked/WAITING-ON-HUMAN section for any credentials a
human may have supplied since the last check before assuming Phase D is
still the right phase to be in.

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
