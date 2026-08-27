# 07 — NEXUS Feasibility Study

Scope: can NEXUS reach its enterprise future state — technically, legally, financially, operationally — and on what timeline? Verdict up front: **feasible, with one structural condition — the open-protocol wedge must carry the value proposition, because access to X and Meta is purchasable and revocable, not ownable.**

## 1. Technical feasibility — HIGH
The hardest architectural problems are already solved in the repo: the connector seam, encrypted credential storage, a durable publishing ledger, restart-proof scheduling, dedup and stable pagination, and an auth system at production grade. Nothing in the future state requires research-level work; it is accretion along known patterns (queues, object storage, full-text indexes, mobile via React Native/Expo, SSO via standard SAML/OIDC libraries). Two genuine constraints: (a) **capability asymmetry** — each network exposes different read/write abilities (threads, DMs, likes-by-API vary), so the UI must be capability-descriptor-driven per connector rather than pretending to uniformity; the buildout (doc 04 §5) specifies this. (b) **Scale of the feed cache** — per-user cached posts grow linearly with connections × cadence; mitigations (retention windows, rollup tables, per-connection cadence, Postgres partitioning by user hash) are conventional. Confidence: the 1,242-hour charter's remaining phases are executable as written.

## 2. Platform-access feasibility — MEDIUM, and it is the whole game
| Network | Access path | Cost/risk | Verdict |
|---|---|---|---|
| Bluesky (AT Protocol) | App password or OAuth; open, no approval | Effectively free; protocol-stable | **Foundation** |
| Mastodon (ActivityPub) | Per-instance OAuth, self-registered | Free; thousands of instances; no gatekeeper | **Foundation** |
| X / Twitter | Paid API tiers; developer app; terms have shifted repeatedly since 2023 | Recurring cost that scales with usage; unilateral-change risk | Accelerant, env-gated |
| Threads | Meta API (post/read for owned account); app review | Review latency; scope limits | Accelerant, env-gated |
| Instagram | Graph API; business/creator accounts; strict review | Highest review friction; caption-only 2200 | Accelerant, env-gated |
The charter already encodes the correct posture: implement fully, gate on env, show "waiting on credentials," fall back to demo. **Condition of feasibility:** the product must be worth paying for with only Bluesky + Mastodon live. Given Tweetdeck's paywalling and the fediverse's tooling gap, it is.

## 3. Legal / compliance feasibility — MEDIUM-HIGH
NEXUS uses only official APIs with user-granted, user-revocable credentials — the same legal footing as Buffer/Hootsuite, which have operated for 15 years. Obligations to procure (sequenced in doc 08): Privacy Policy + ToS; GDPR/CCPA posture (data export and deletion are already architecturally easy — cascade deletes modeled); a DPIA once EU users are real; platform-developer-policy compliance reviews per connector (notably Meta's data-use rules and X's content-syndication limits); DMCA agent registration once user media uploads exist; SOC 2 for the enterprise tier (12–18 months out, start evidence collection early — the audit-friendly publishing ledger helps). No showstoppers identified.

## 4. Market feasibility — HIGH
Demand signals: the scheduler category sustains multiple $100M+ revenue businesses on the publish half alone; the read half's incumbents (Tweetdeck) were withdrawn or paywalled, leaving visible unmet demand; multi-network posting is now normal behavior, not niche. NEXUS's differentiated wedges — two-way client, zero-credential demo, protocol-first trust, individual-friendly pricing — target the two flanks incumbents abandoned (doc 09). Primary market risk: the networks themselves shipping "cross-post to X" natively; mitigation: no network will ever build a *neutral* home for its competitors' feeds — that role structurally belongs to a third party.

## 5. Operational feasibility — MEDIUM-HIGH
The agentic build system (charter + backlog + campaign log + CI + tests) has demonstrated ~2 phases/day of shippable, tested slices with honest logs. Bottleneck is not engineering throughput but **human unlock latency**: five WAITING-ON-HUMAN items have sat since 2026-08-26, two of which cost minutes. Recommended cadence: a weekly 30-minute human session dedicated to unblocks (credentials, developer-app applications, deploy approvals, brand/legal decisions). Support, moderation, and abuse handling become real at ~1k users; budget one operator role by then.

## 6. Financial feasibility — sketch (validate in the Financial Model doc, #4 in doc 08)
Costs, monthly, first year: infra (Railway API + Postgres + Vercel + S3 + email) ≈ $50–200 at seed scale; X API tier if/when enabled ≈ $200–5,000 depending on tier chosen; Apple/Google developer accounts ≈ $124/yr; incorporation/legal boilerplate one-time ≈ $2–5k; the marginal engineering cost is unusually low given the agentic pipeline. Revenue: at Pro $12/mo, break-even on hard infra costs sits in the low hundreds of subscribers; the Team tier ($29/seat) is where category economics live. Runway math therefore favors shipping the paid Planner early (doc 05 §E slice 4) rather than delaying monetization for scale.

## 7. Timeline feasibility (charter-calibrated, assuming human unlocks keep pace)
| Horizon | Milestone |
|---|---|
| Week 1 | C1a/C2a live validation; C5/C6 resilience + health UI; production Postgres deploy (G1/G2 minimum) |
| Month 1 | E3 media, E4 retry UI, schedule UI + Planner v0, F1 real analytics, G3/G4 observability + security pass → **public beta on Bluesky/Mastodon communities** |
| Month 2–3 | Lenses/deck, thread drawer, real search, braided profile, billing + Pro tier → **launch** |
| Month 3–6 | X/Meta connectors as approvals land; mobile apps; teams/approvals |
| Month 6–18 | Enterprise pack (SSO/SCIM/audit/self-host), connector marketplace, SOC 2 |

## 8. Kill criteria (define them now, honestly)
Reassess the thesis if: (a) both AT Protocol and ActivityPub audiences prove unwilling to pay anything after a real Pro launch (two quarters of data); (b) two or more major platforms simultaneously prohibit third-party posting via official APIs; (c) retention shows the unified feed is a novelty rather than a habit (D30 < 10% among users with 2+ live connections). None of these is currently indicated.

## 9. Verdict
**GO.** Technically de-risked, legally conventional, financially light, operationally proven by its own commit history. The single condition: build as if X and Meta might vanish, and treat every day they don't as upside — which is exactly how the charter is already written.
