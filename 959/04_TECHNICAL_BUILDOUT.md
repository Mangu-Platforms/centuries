# 04 — Technical Buildout: Every Page, Window, and Tool

Format per surface: **Purpose → Components → State & data → API contract → UX states → Accessibility → Future-state build notes.** Current facts are verified from source; future-state notes are the build spec.

---

## 1. Landing `/` (`app/page.tsx`)
**Purpose:** convert visitor → register. **Components:** hero, feature sections, footer (cites BRD v1.0). **Data:** none (static). **Future (F5):** embed the live demo — an unauthenticated read-only feed rendered from demo connectors via a public `GET /api/demo/feed`; one CTA ("See your networks in one place"); keep it a page, not a marketing site rewrite (charter rule). Add `/pricing` as a sibling static route.

## 2. Auth pages `/login` `/register` `/forgot-password` `/reset-password`
**Components:** single centered card; labeled inputs; inline rose error strip; submit button with busy state. **State:** local form state; on success `lib/auth.tsx` stores the access token in memory and the API sets the `nexus_refresh` httpOnly cookie (path `/api/auth`). **API:** `POST /api/auth/register|login` → `{ token, user }`; 423 lockout returns `retryAfterSeconds` (surface a countdown — small gap today); `password-reset/request` always 200. **UX states:** idle/busy/error; reset-password consumes `?token=`. **A11y:** labels bound, focus rings (charter-mandated). **Future:** passkey button (WebAuthn), OAuth buttons, 2FA challenge step — all additive to the same card; add CAPTCHA only if abuse observed (rate limits + lockout already in place).

## 3. Dashboard shell (`app/dashboard/layout.tsx`)
**Purpose:** auth gate + navigation + global composer host. **Components:** `<aside>` sidebar (Logo, NAV array, "New post", user card w/ initials + logout), mobile top bar + scrolling tab nav, `{composerOpen && <Composer/>}`. **State:** `useAuth()` (redirects to `/login` when unauthenticated), `connections` refetched when composer opens/closes, `composerOpen`. **Behavior detail that matters:** the composer *fully unmounts* on close — this is what makes E6's per-mount idempotency UUID correct. Preserve this contract if the shell is refactored. **Future:** add Planner/Inbox/Analytics/Library/Lists/Team to `NAV`; ⌘K command palette (portal, same pattern as composer); notification bell fed by `/app/inbox` unread count; workspace switcher above the user card.

## 4. Overview `/dashboard` (`dashboard/page.tsx`)
**Components:** `Stat` card ×4 (connected platforms / posts in feed / cross-posts sent / success-rate %), Connected-accounts panel (per-platform glyph, char limit, Active badge or "Connect →"), Engagement-totals panel (3 animated bars normalized to max, "authored N posts" footer), Publishing-history section (job cards with per-target ✓/✕ badges).
**Data:** parallel `api.dashboard()` + `api.history()` on mount; no polling. **API:** `GET /api/dashboard` → `{ stats:{connectionsCount, totalFeedPosts, crossPosts, crossPostSuccessRate, totalLikes, totalReposts, totalReplies, ownPosts}, platforms:[{platform,name,charLimit,connected}] }`.
**Future (F1 spec):** make every number live-derived: success rate and p50/p95 `latencyMs` from `PublishTarget` grouped per platform; feed volume time-series from `FeedPost.postedAt` bucketed daily (add index `(userId, platform, postedAt)`); render sparklines; add empty-state for zero connections that deep-links the connect flow. Later split into `/app/analytics` with tabs (Performance/Audience/Timing/Reports); computation moves to nightly rollup tables (`AnalyticsDaily(userId, platform, day, posts, likes, reposts, replies, publishes, failures, p50, p95)`) written by the worker, so the dashboard is O(rows-per-day) not O(all-posts).

## 5. Unified Feed `/dashboard/feed`
**Components:** sticky filter card (search input w/ icon, platform chips from `PLATFORM_ORDER`, amber Bookmarks toggle), `PostCard` list, skeletons ×3, empty state, "Load more".
**State machine:** `posts, cursor, platform, search (300 ms debounce), bookmarked, loading, loadingMore`. Filter change → full reload; Load more appends via cursor.
**API:** `GET /api/feed?cursor&platform&search&bookmarked` → `{ posts, nextCursor }`; ordering `postedAt DESC, id DESC` (D2). Likes/bookmarks: `POST /api/feed/:id/like|bookmark` toggles (optimistic in `PostCard`).
**PostCard anatomy:** avatar, author name/handle, platform glyph, relative time, content, `MediaGrid` (1: natural ratio max-height; 2/4: even squares; 3: one tall + two stacked; each opens full-size), action row (reply count, repost count, like w/ fill, bookmark), `isOwn` treatment.
**Future builds:** D5 thread drawer — right-side sheet; `GET /api/feed/:id/thread` calls connector `fetchThread(externalId)` (extend `PlatformConnector` with optional capability methods + a `capabilities()` descriptor so the UI can hide unsupported actions per network); read-only first, then reply via `publishReply`. D6 search — Postgres `tsvector` GIN index over `content` + `authorHandle` (SQLite path: FTS5), searched server-side across the whole cache, still cursor-paginated; upgrade to Meilisearch only when >1M rows/user cohorts demand it. Infinite scroll: IntersectionObserver on a sentinel replacing the button (keep the button as no-JS/reduced-motion fallback). Lenses: persisted named filter sets (`Lens(userId, name, query, platforms[], listId?)`); "For You" ranked lens = transparent linear score (recency decay × source-affinity × engagement-rate) computed at read time, never replacing Latest as default.

## 6. Composer (modal) — `components/Composer.tsx`
**Current contract (precise):** platform target pills default to *all connected*; per-pill live countdown (`charLimit - content.length`, bold red when negative); min-limit ring (SVG stroke-dashoffset; rose >100%, amber >85%); Post disabled while `submitting || overLimit`; server re-validates limits (CP02 — client is preview, server is truth); response swaps the form for per-target result rows (✓ posted in N.Ns / ✕ error); idempotency UUID per mount.
**API:** `POST /api/posts { content, platforms[], mediaUrls[], scheduledAt?, idempotencyKey? }` → `201 { job, results[] }` (or `200` replay for a repeated key).
**Future builds, in order:**
- **E4 per-target live status:** render `pending → success/failed` rows as they resolve (return early with the job, poll `GET /api/posts/:id`, or SSE); "Retry failed targets" calls a new `POST /api/posts/:id/retry` that re-attempts only `failed` targets through `lib/publish.ts#attemptPublish` (already shared — this is why it was extracted).
- **Schedule UI:** popover with date/time + timezone; sets `scheduledAt`; success state says "Scheduled for …" with an Undo toast (job delete while all targets pending).
- **E3 media:** `POST /api/media` multipart → `MediaAsset(id, userId, kind, url, width, height, altText, bytes)`; storage driver interface (disk dev / S3-compatible prod); connectors gain `uploadMedia(ctx, asset)` (Bluesky blob upload, Mastodon `/api/v2/media`); composer thumbnail rail with per-image alt-text prompt (required-by-default, a11y differentiator); enforce per-platform media count/size rules in `PLATFORMS`.
- **Variants:** `PublishTarget.contentOverride` nullable; UI tab per selected platform; char ring per tab.
- **Thread builder:** ordered child jobs (`PublishJob.parentJobId`, `threadIndex`); connectors chain reply-to on the previous target's `externalId`.
- **AI drawer:** server-side `POST /api/ai/assist { mode: draft|fit|alt_text|repurpose, input }` proxying a model with per-plan quotas; never blocks manual flow.

## 7. Connections `/dashboard/connections`
**Current:** 4-platform picker grid (green check badge when connected), dynamic form (Mastodon → instance only + "Continue to your instance" redirect via `api.mastodonRegister`; Bluesky → handle + app-password field; others → handle), auth-model + char-limit badges, success/error strips, OAuth return banners (params stripped after display), connections list (glyph, handle, instance, status badge, one-click Disconnect).
**Known gaps to close (C1b/C6 spec):** surface the API's `warning` on live-credential rejection; add `lastSyncedAt`/`lastError` columns to `Connection` (write in `lib/sync.ts`) and show "Synced 2m ago / Error: …" + **Reconnect** (re-prompts credential, PATCHes encrypted fields); confirm dialog on Disconnect; X/Threads/Instagram cards show "Waiting on credentials — runs in demo mode" when env unset (registry already knows).
**Future:** multi-account per platform (schema already allows; add per-connection labels + a default-for-publishing flag); connector marketplace page reading a signed manifest registry.

## 8. Settings `/dashboard/settings`
**Current cards:** Profile (display name, bio, theme select → `PATCH /api/auth/me`; theme toggles `documentElement` class, persists), Email verification (status + resend), Change password (current/new/confirm; revokes other sessions), Active sessions (device/IP/date, "This device" badge — cookie-matched server-side, unspoofable; per-session revoke; logout-all-others).
**Future:** tabbed layout (Profile · Security · Notifications · Data · Billing · API keys); Security adds 2FA/passkeys; Data adds export-all (JSON zip of feed cache, jobs, connections-sans-secrets) and delete-account (cascade already modeled via `onDelete: Cascade`).

## 9. Background tools (no UI)
- **Sync worker** (`lib/sync.ts` + `syncScheduler.ts`): 5-min unref'd interval, started only in `server.ts`; per-connection error→self-heal; future: per-connection cadence + jitter, move to BullMQ when >1k connections.
- **Scheduled-send tick** (`routes/internal.ts` + `lib/publish.ts`): `POST /internal/tick`, timing-safe `x-cron-secret`, 30/min rate-limited, re-resolves connections at fire time; prod 503s if `CRON_SECRET` unset. Wire Railway cron (or GitHub Actions schedule) to hit it every minute.
- **Email** (`lib/email.ts`): `EmailProvider` interface; add `ResendProvider` selected by env (B2a).
- **Crypto** (`lib/crypto.ts`): AES-256-GCM, `DATA_KEY`; dev fallback, prod-throw if unset. Future: key-version prefix on ciphertexts to enable rotation.
- **Registry** (`connectors/registry.ts`): the extension point. **Add-a-platform recipe (G6 preview):** implement `PlatformConnector` in one file → `registerLiveConnector("id", impl)` in `app.ts` → add to `PLATFORMS` (api) + `PLATFORM_META` (web) → env vars in `.env.example` → one vitest file → done.

## 10. Cross-cutting build standards (hold the line as surfaces multiply)
Zod at every route boundary; error envelope `{ error, code, details?, requestId }` everywhere (finish A6b); optimistic UI must roll back (F3) — pattern: snapshot → mutate → revert on reject + toast; every new surface ships keyboard operability, labels, focus rings, contrast (charter NF); every connector method, auth path, and publish path gets tests (charter rule); no fetch/publish logic outside connectors — ever.
