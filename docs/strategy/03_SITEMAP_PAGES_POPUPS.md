# 03 — NEXUS Sitemap: Every Page, Subpage, Pop-up, and Tool

## Part 1 — What exists today (verified in `apps/web/app/`)

### Pages (9 routes)
| Route | Page name (as shown) | Purpose |
|---|---|---|
| `/` | Landing — "NEXUS" | Public marketing page; footer cites BRD v1.0; links to Login/Register |
| `/login` | Log in | Email + password; "Forgot password?" link |
| `/register` | Create account | Email, display name, password |
| `/forgot-password` | Forgot password | Requests reset email (always-200, non-enumerating) |
| `/reset-password` | Reset password | Token from email link → new password |
| `/dashboard` | **Overview** | 4 stat cards; Connected accounts panel; Engagement totals; Publishing history |
| `/dashboard/feed` | **Unified Feed** | Search bar; platform filter chips (All/X/Threads/Bluesky/Mastodon); Bookmarks toggle; post stream; Load more |
| `/dashboard/connections` | **Connections** | "Connect a platform" card (4-platform picker grid, dynamic form) + "Your connections" list |
| `/dashboard/settings` | **Settings** | Profile card; Theme; Email verification card; Change password card; Active sessions card |

### Persistent shell (dashboard layout)
- **Left sidebar (desktop):** NEXUS logo → Menu: Overview · Unified Feed · Connections · Settings → **"New post"** primary button → user card (initials avatar, name, email, logout).
- **Mobile:** top bar (logo + "Post" button) + horizontal scrolling tab nav.

### Pop-ups, modals, overlays, transient UI
| Element | Where | Behavior |
|---|---|---|
| **Composer modal** (the only modal) | Global, from "New post"/"Post" | Full-screen dim + blur backdrop; textarea; platform target pills with live per-platform char countdown (red when over); circular min-limit progress ring; Cancel/Post; then swaps to **Publishing-results panel** (per-platform ✓ posted-in-N.Ns / ✕ error badges) |
| Mastodon OAuth redirect banners | Connections | `?mastodonConnected` → green "Connected! Imported N posts"; `?mastodonError` → red banner; params stripped after display |
| Inline success/error strips | Connections, Settings, auth pages | Green/rose rounded alerts |
| Skeleton loaders | Feed (3 pulse cards), Overview ("Loading…") | |
| Empty states | Feed ("No posts found — connect a platform or adjust filters"), Connections ("No connections yet"), History ("No posts published yet — hit New post") | |
| Confirmation states | Bluesky app-password field hint; "Continue to your instance" for Mastodon | |
| Browser-level | External OAuth consent screen (Mastodon instance) | leaves and returns to `/dashboard/connections` |

### Tools (API surface — the machine-facing "pages")
Auth: `POST /api/auth/register · /login · /refresh · /logout · /change-password`, `GET/PATCH /api/auth/me`, `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id`, `POST /api/auth/sessions/logout-all`, `POST /api/auth/password-reset/request · /confirm`, `POST /api/auth/email/verify/request`, `GET /api/auth/email/verify`.
Connections: `GET/POST /api/connections`, `DELETE /api/connections/:id`, `POST /api/connections/mastodon/register`, `GET /api/connections/mastodon/callback`.
Feed & posts: `GET /api/feed` (cursor, platform, search, bookmarked), `POST /api/feed/:id/like · /bookmark`, `POST /api/posts` (immediate or `scheduledAt`, idempotencyKey), `GET /api/posts/history`.
Meta: `GET /api/dashboard`, `GET /api/platforms`, `GET /health`, `GET /ready`, `POST /internal/tick` (cron, `x-cron-secret`).

---

## Part 2 — Future-state sitemap (enterprise NEXUS)
New surfaces marked ●. Existing surfaces evolve in place.

```
/                      Landing (live product demo embedded — the demo connectors ARE the demo)
/pricing ●             Plans: Free / Pro / Team / Enterprise
/changelog ● /docs ●   Public docs + developer platform docs
/login /register /forgot-password /reset-password
/onboarding ●          3-step: pick networks → connect or "try demo" → first post

/app                   (renamed from /dashboard)
├── /app/home              Overview (Today panel, health, quick stats)
├── /app/feed              Unified Feed
│     ├── lens switcher ●      Latest (default) | For You (transparent ranked) | per-List
│     ├── /app/feed/post/[id] ●  Post detail + full thread
│     └── deck mode ●          multi-column boards (per platform/list/search)
├── /app/compose ●         Full-page composer (modal remains for quick post)
│     ├── variants tab ●       per-platform content editing
│     ├── thread builder ●     chained posts
│     └── AI assist drawer ●   draft / fit-to-limit / alt-text / repurpose
├── /app/planner ●         Calendar (month/week) of scheduled + queue slots
│     └── /app/planner/queue ●   Buffer-style time slots per platform
├── /app/inbox ●           Unified notifications, mentions, replies; DMs where APIs allow
├── /app/analytics ●       (grows out of Overview)  Performance · Audience · Timing heatmap · Reports/export
├── /app/library ●         Drafts · Templates · Media assets · Hashtag sets
├── /app/connections       + health (last sync, last error, reconnect), multi-account per platform,
│                            "waiting on credentials" states for X/Meta, connector marketplace ●
├── /app/lists ●           Cross-platform people lists → feed lenses
├── /app/profile ●         The braided Nexus identity page (public: nexus.app/@you)
├── /app/team ●            Members, roles, approval workflows, brand workspaces
└── /app/settings          Profile · Security (2FA, passkeys, sessions) · Notifications ●
                           · Data (export/delete, GDPR) ● · Billing ● · API keys ●

/admin ●               Internal: user support, abuse queue, feature flags, system health
Mobile apps ●          iOS + Android (share-sheet "post everywhere", push for inbox)
```

### Future-state pop-ups & sheets (design once, reuse everywhere)
Command palette (⌘K: navigate, post, search) ● · Schedule picker popover (date/time/timezone/queue-slot) ● · Media upload sheet with alt-text prompt ● · Post-detail thread drawer (D5) · Reply/quote sheet ● · Per-target retry dialog ("Bluesky failed — retry just Bluesky?") ● · Connection reconnect dialog with platform-specific guidance ● · Keyboard-shortcut overlay (?) ● · Toast system with undo ("Post scheduled — Undo") ● · Approval request/review sheet (teams) ● · Paywall/upgrade sheet ● · Danger confirmations (disconnect, delete account, revoke session) — today disconnect is one un-confirmed click; add confirm.

### Naming system (recommendation)
Keep interface nouns human and consistent: **Feed** (never "timeline aggregator"), **Post** (the verb and the noun), **Planner** (not "scheduler"), **Inbox**, **Connections** (not "integrations"), **Lenses** (saved filters), **Braid** (the multi-network identity — the brandable concept). The current app already does this well; protect it as surfaces multiply.
