# NEXUS / Centuries — Executive Brief
**Repo:** `Mangu-Platforms/centuries` · **Product:** NEXUS — Social Media Aggregator Platform
**Prepared:** 2026-08-27 · **Pack:** 11 documents + 1 interactive UI prototype

---

## The direct answers

### 1. Does the repo do it justice? Do I see the full picture?

**Honest verdict: the repo is excellent for what it is, and what it is, is about 20% of the picture you're describing.**

What the repo *is*: a disciplined, well-engineered v1 of a **social media aggregator** — read five networks in one feed, write once, publish everywhere, with security engineering (encrypted credentials, rotating refresh tokens with theft detection, idempotency keys) that most seed-stage products never bother with. Phases A–B of the 1,242-hour charter are complete; C–E are half-shipped. The engineering log is unusually honest — real bugs found, isolated, and fixed with regression tests.

What the repo is *not yet*: a social platform. There is no native identity/graph, no messaging, no discovery or ranking, no creator monetization, no mobile app, no team/brand workspaces, no trust-and-safety layer, no AI layer, no revenue mechanism. The vision documents for those layers don't exist either — the BRD in the repo is a *reconstruction* of a lost v1.0 utility spec, not a north-star product vision.

**So: you see the engine block, machined beautifully. You do not yet see the car.** That's the correct state for hour ~120 of 1,242 — but the "full picture" currently lives in your head, not in the repo. This pack is the transfer.

### 2. Was the PRD found?

Yes — three documents together form the de facto PRD:
- **`docs/BRD.md`** — Business Requirements v1.0-r1 (reconstructed from requirement IDs in code; the original BRD v1.0 PDF was lost and never recovered)
- **`AGENTS.md`** — the 1,242-hour autonomous build charter (the real north star: phases A–G, non-negotiable rules, definition of done)
- **`docs/BACKLOG.md` + `docs/CAMPAIGN.md`** — the living backlog and session-by-session build log

### 3. How does it win? (One paragraph — full version in doc 09)

NEXUS wins by being the only product that is **two-way** (a beautiful reading client *and* a full publishing system in one), **protocol-first** (own Bluesky/AT Protocol and Mastodon/ActivityPub, where no gatekeeper can revoke access, then treat X/Meta as gated bonus connectors), **trustworthy by construction** (credentials encrypted at rest, demo mode means you can try the whole product before handing over a single token), and **fast and crafted** where incumbents (Buffer, Hootsuite, Sprout) are enterprise-slow, publish-only, and $99+/seat. The moat is the connector seam plus the user's aggregated interaction graph, which compounds and cannot be copied by any single network.

---

## What's in this pack

| # | Document | Answers your ask |
|---|---|---|
| 00 | Executive Brief (this) | The direct questions |
| 01 | Repo Audit — Deep Dive | "Deep dive into the repo, find the PRD" |
| 02 | Feature Inventory | "A doc that lists all its features" (current + enterprise future state) |
| 03 | Sitemap: Pages, Subpages, Pop-ups | "Every page and its name, every tool and subpage, pop-ups" |
| 04 | Technical Buildout per Page/Window/Tool | "A technical and detailed build out of each page, window and tool" |
| 05 | Opportunities, Fixes, Blockers, Strategies, User Stories | "End to end nonstop list…" |
| 06 | White Paper | "Build a white paper" |
| 07 | Feasibility Study | "Do a feasibility study" |
| 08 | Document Procurement Roadmap (chronological) | "Name of all documents I'd need to procure in order" |
| 09 | Competitive Strategy | "How this app wins against all the rest" |
| 10 | Full Stack Code Map + Skills | "Procure the full stack code and list of skills" |
| — | `NEXUS_UI_Prototype.html` | "Complex UI model" — interactive future-state console |

## The five decisions only you can make (everything else is executable)

1. **Name.** Repo is *Centuries*, product is *NEXUS*, org is *Mangu Platforms*. Three brands for one thing. Pick one (recommendation in doc 09).
2. **Wedge.** Approve protocol-first (Bluesky + Mastodon live-validated first) vs. waiting on X/Meta developer apps.
3. **Human unlocks.** Five WAITING-ON-HUMAN items block live validation: a Bluesky app password, one Mastodon OAuth click-through, an X developer app, a Meta developer app, an email provider account (≈2 hours of your time total for the first two).
4. **Business model.** Open-core + Pro subscription vs. pure SaaS (doc 07 §6).
5. **The network question.** Does NEXUS stay a client forever, or eventually become a place people *post to natively*? (Doc 06 §7 argues: client first, network by gravity.)
