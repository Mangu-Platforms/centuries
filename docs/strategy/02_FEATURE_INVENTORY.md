# 02 — NEXUS Feature Inventory
Legend: ✅ shipped & tested · 🟡 code-complete, awaiting live validation · 🔜 in charter, not built · 🧭 enterprise future state (beyond the current charter)

## A. Identity & Account
| Feature | Status | Notes |
|---|---|---|
| Email + password registration / login | ✅ | bcrypt cost 12 (NF16) |
| Short-lived access JWT (15 min) | ✅ | was 7-day; hardened in B1 |
| Rotating refresh tokens (httpOnly cookie) | ✅ | hashed at rest; `SameSite=None; Secure` in prod |
| Refresh-token **reuse/theft detection** | ✅ | reuse of a rotated token revokes all sessions |
| Silent 401 retry + shared in-flight refresh (web) | ✅ | survives fresh tabs/reloads |
| Password reset (email link) | ✅ | non-enumerating; revokes all sessions; hashed single-use tokens, 30-min TTL |
| Email verification | ✅ | 24-h tokens; resend from Settings |
| Rate limits on auth routes | ✅ | register 5/min, login 10/min, refresh 20/min per IP |
| Per-account lockout | ✅ | 5 fails → 15-min lock (423 + retryAfter), pre-password-compare |
| Active session list / revoke one / logout-all-others | ✅ | device, IP, date, "This device" badge |
| Change password (in-app) | ✅ | keeps current session, revokes the rest |
| Profile: display name, bio, avatar, theme | ✅ | `PATCH /api/auth/me` |
| Real email provider (Resend/Postmark/SMTP) | 🟡 B2a | interface + console transport shipped; needs an account |
| OAuth social login (Sign in with Google/Apple) | 🧭 | |
| Passkeys / WebAuthn, 2FA/TOTP | 🧭 | |
| SSO (SAML/OIDC), SCIM provisioning, audit log | 🧭 | enterprise tier |

## B. Platform Connections
| Feature | Status | Notes |
|---|---|---|
| Connect / list / disconnect connections | ✅ | initial timeline import on connect |
| Demo connectors for Twitter/X, Threads, Bluesky, Mastodon | ✅ | deterministic, zero-credential, permanent fallback |
| Connector registry (live-if-credentialed, else demo) | ✅ | the seam for every future network |
| Encrypted credentials at rest (AES-256-GCM, `DATA_KEY`) | ✅ | access/refresh tokens, app passwords, scopes, metadata |
| **Bluesky live** (AT Protocol app password) | 🟡 C1/C1a | fetch + publish (text); needs one real app password to validate |
| **Mastodon live** (OAuth 2.0, any instance, dynamic app registration) | 🟡 C2/C2a | encrypted-state OAuth dance; needs one human click-through |
| Graceful bad-credential handling (`status:"error"` + `warning`) | ✅ API / 🔜 UI (C1b/C6) | UI doesn't surface `warning` yet |
| X / Twitter live (OAuth 2.0 PKCE) | 🔜 C3 | WAITING-ON-HUMAN: developer app + `TWITTER_CLIENT_ID/SECRET` |
| Threads + Instagram live (Meta OAuth) | 🔜 C4 | WAITING-ON-HUMAN: Meta developer app; IG limit 2200 |
| Retries, 429 backoff, token refresh, circuit breaker | 🔜 C5 | so one dead platform never sinks the feed |
| Connection health UI (reconnect, last-error, last-synced-at) | 🔜 C6 | |
| Multiple handles per platform (schema-ready) | 🟡 | `@@unique(userId, platform, handle)` allows it; no UI |
| LinkedIn, YouTube (community posts), TikTok, Farcaster, Nostr, RSS connectors | 🧭 | each = one connector file, by design |

## C. Unified Feed
| Feature | Status |
|---|---|
| Merged chronological feed, newest first (FD01) | ✅ |
| Stable cursor pagination (FD02, D2 tiebreak fix) | ✅ |
| Platform filter chips + "All" (FD04) | ✅ |
| Bookmarks-only filter (FD05) | ✅ |
| Debounced text search (FD06) | ✅ (naive `contains` — D6 upgrades) |
| Like / bookmark, persisted (FD03) | ✅ (local only; F2 mirrors to platforms) |
| Own cross-posts appear in feed (`isOwn`) | ✅ |
| Background sync every 5 min + self-healing connections (D1) | ✅ |
| Dedup by (user, platform, externalId) (D3) | ✅ |
| Image media grid (1/2/3/4 layouts) (D4) | ✅ |
| Skeleton loaders, empty state | ✅ |
| Video rendering | 🔜 D4b |
| Reply thread drawer (read → then reply) | 🔜 D5 |
| Real search (indexed, cross-page) | 🔜 D6 |
| Infinite scroll (auto), keyboard j/k nav, mute/hide, saved filters ("Lenses") | 🧭 |
| Optional ranked lens ("For you" — transparent, user-tunable, chrono always default) | 🧭 |
| Lists/columns (Tweetdeck-style multi-column deck) | 🧭 |

## D. Composer & Publishing
| Feature | Status |
|---|---|
| Cross-post to any subset of connected platforms (CP01) | ✅ |
| Per-platform char limits, fail-fast server-side (CP02) | ✅ X 280 · Bluesky 300 · Threads 500 · Mastodon 500 (+ IG 2200 planned E5) |
| Live per-platform countdown + min-limit progress ring | ✅ |
| Partial-failure reporting per target: status, externalId, error, latencyMs (CP03) | ✅ |
| Durable publishing ledger (`PublishJob`/`PublishTarget`) (DS03) | ✅ |
| Publishing history view | ✅ |
| **Idempotency keys** (double-click / retry safe, race-safe) (E6) | ✅ |
| **Scheduled sends** + external-cron tick worker (`CRON_SECRET`) (E2) | ✅ API (no scheduling UI yet — see E4/planner) |
| Media upload pipeline (disk dev / S3 prod, platform-native uploads) | 🔜 E3 |
| Per-target pending/success/failed states in composer + history UI | 🔜 E4 |
| Per-platform content variants (edit the same post per network) | 🧭 |
| Thread composer (multi-post chains, auto-numbering) | 🧭 |
| Drafts, templates, snippet library, hashtag sets | 🧭 |
| Best-time-to-post suggestions; queue slots (Buffer-style) | 🧭 |
| AI assist: draft, shorten-to-limit, tone shift, alt-text generation, repurpose long→thread | 🧭 |
| Approval workflows (draft → review → approve → publish) | 🧭 teams |
| First-comment, cross-link footers, UTM tagging | 🧭 |

## E. Dashboard & Analytics
| Feature | Status |
|---|---|
| Overview stats: connected platforms, feed volume, cross-posts sent, success rate | ✅ |
| Engagement totals (likes/reposts/replies) with bars | ✅ |
| Connected-accounts panel with char limits + Connect CTAs | ✅ |
| Publishing history with per-target badges | ✅ |
| Real analytics: per-platform latency percentiles, live success/failure, feed volume over time | 🔜 F1 |
| Post-level performance, follower growth, best-time heatmap, export CSV | 🧭 |
| Team reports, scheduled email digests | 🧭 |

## F. Settings
| Feature | Status |
|---|---|
| Profile (name, bio), theme light/dark (persisted to `User.theme`) | ✅ |
| Email verification status + resend | ✅ |
| Change password card | ✅ |
| Active sessions card | ✅ |
| Notification preferences, data export (GDPR), delete account | 🧭 |
| Billing & plan management | 🧭 |

## G. Platform / Infrastructure
| Feature | Status |
|---|---|
| CI: typecheck, lint, unit tests, build, gated Playwright e2e | ✅ |
| Request IDs + structured error envelope (global) | ✅ (per-route codes: A6b 🔜) |
| `/health` (cheap) + `/ready` (DB) | ✅ |
| Vitest API suite (auth, refresh, sessions, recovery, feed, posts, tick, sync, connectors, idempotency) | ✅ |
| Playwright golden-path smoke in CI | ✅ |
| SQLite dev → Postgres prod (provider-agnostic) | ✅ design / 🔜 G1 migrations |
| Deploy targets: Vercel (web) + Railway (API) | 🔜 G2 (documented, not live) |
| Observability: pino structured logs, metrics, error reporting | 🔜 G3 |
| Security pass: CSP, exact CORS, secret rotation notes | 🔜 G4 |
| OPERATOR.md (run, env matrix, add-a-platform guide) | 🔜 G6 |
| Job queue (BullMQ/Redis), webhooks, public API + API keys, plugin SDK for connectors | 🧭 |
| Mobile apps (iOS/Android), desktop app, PWA offline | 🧭 |
| Multi-region, SOC 2, SLA, self-hosted enterprise edition | 🧭 |

## H. The Network Layer (the future-state leap — none in charter)
Unified cross-platform notifications & mentions inbox · unified DMs (where APIs allow) · a portable "Nexus identity" that braids handles into one profile page · follow-graph import/export & backup · communities/rooms · creator monetization (tips, subscriptions) · trust & safety (blocklist sync across networks, report routing) · developer platform (third-party connectors marketplace).
