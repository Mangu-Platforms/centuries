# 08 — Document Procurement Roadmap (Chronological)
Every document needed to take NEXUS from today's repo to its enterprise future state, in the order to produce them. "Have" = exists in repo/this pack. Each entry: what it is → exit criterion (when it's done).

## Phase 0 — Already in hand
1. **Build Charter** (`AGENTS.md`) — have. Governs execution.
2. **BRD v1.0-r1** (`docs/BRD.md`) — have (reconstructed). Utility-layer requirements.
3. **Architecture Doc** (`docs/ARCHITECTURE.md`) — have.
4. **Backlog + Campaign Log** (`docs/BACKLOG.md`, `docs/CAMPAIGN.md`) — have, living.
5. **Repo Audit / Feature Inventory / Sitemap / Technical Buildout / White Paper / Feasibility / Competitive Strategy** — this pack (docs 01–07, 09).

## Phase 1 — Define (weeks 0–2)
6. **Vision & North Star Doc** — the founder's one-pager: what NEXUS is at year 5, what it will never be. *Exit: every later doc cites it.* (The white paper, doc 06, is the draft; you edit it into yours.)
7. **Brand Decision Memo** — Centuries vs NEXUS vs new name; domain, trademark search, app-store availability. *Exit: one name everywhere; repo renamed; `main` branch set.*
8. **Market & Competitive Analysis** — sizing, segments, incumbent teardown (expands doc 09 with data). *Exit: target segment + wedge signed off.*
9. **Business Model & Pricing Doc + Financial Model (spreadsheet)** — tiers, costs incl. X API tier decision, break-even. *Exit: pricing on the (future) pricing page; 18-month runway math.*
10. **PRD v2.0** — supersedes the BRD: full future-state requirements with IDs (FD/CP/NF/DS extended; new families: PL planner, IN inbox, AN analytics, TM teams, ID identity). *Exit: replaces BRD.md as source of truth; backlog re-linked.*

## Phase 2 — Design (weeks 1–4, overlapping)
11. **UX Research Brief + Personas** (3: solo creator, indie brand, social media manager) → interview notes → **Research Synthesis**. *Exit: top-5 pains ranked with evidence.*
12. **Design System Spec** — tokens, type, components, dark/light, a11y standards (extends the prototype in this pack). *Exit: Figma library + coded tokens match.*
13. **Full Product Design Spec (Figma)** — every screen in doc 03 Part 2, all states. *Exit: dev-handoff-ready with redlines.*
14. **Content/Voice Guide** — interface vocabulary (Feed, Planner, Lenses, Braid), error-message style. *Exit: applied in design spec.*

## Phase 3 — Engineer (weeks 2–8)
15. **System Architecture Doc v2 (SAD)** — future-state: queues, storage, search, mobile, multi-region; C4 diagrams; ADR log formalized. *Exit: replaces ARCHITECTURE.md.*
16. **Per-Platform Connector Specs** (5 docs: Bluesky, Mastodon, X, Threads, Instagram) — endpoints, scopes, rate limits, capability matrix, error taxonomy, review requirements. *Exit: each connector's tests trace to its spec.*
17. **API Reference (public)** — OpenAPI for `/api/*`; versioning policy. *Exit: docs site renders it.*
18. **Data Model & Retention Spec** — every table, PII classification, retention windows, deletion paths. *Exit: feeds privacy docs + G1 migrations.*
19. **Security Threat Model + Secure Development Policy** — STRIDE over connectors/auth/vault; secret-rotation runbook (incl. the historical JWT_SECRET burn). *Exit: G4 checklist derived from it.*
20. **Test Strategy Doc** — layers (unit/contract/e2e/load), coverage gates, connector contract tests against recorded fixtures. *Exit: CI enforces it.*
21. **SLO & Observability Plan** — publish-latency SLO (NF03: <3s/target), feed availability, error budgets, alerting. *Exit: dashboards live (G3).*

## Phase 4 — Legal & compliance (weeks 3–8, parallel)
22. **Incorporation / IP Assignment** docs (if not done). 23. **Privacy Policy** + 24. **Terms of Service** — aggregator-specific clauses (credential handling, platform ToS pass-through). 25. **Data Processing Agreement template** + **Subprocessor list**. 26. **Cookie/Consent notice** (refresh cookie is essential-only — document it). 27. **Platform Developer Policy Compliance Memos** (X, Meta) — filed with the developer-app applications. 28. **DPIA (GDPR)** once EU users are real. *Exit for all: linked in app footer before public beta.*

## Phase 5 — Launch (weeks 6–12)
29. **Deployment & Environments Runbook** — supersedes DEPLOY.md; env matrix; preview deploys (G2). 30. **OPERATOR.md** (charter G6) — run it, env vars, add-a-platform recipe. 31. **Incident Response Runbook** + status-page policy. 32. **Support Playbook** + macros. 33. **Go-To-Market Plan** — beta cohorts (Bluesky/Mastodon communities), launch narrative (incl. the agentic-build story), channels. 34. **Release Notes / Changelog policy.**

## Phase 6 — Grow (months 3–9)
35. **Mobile App PRD** (iOS/Android, share-sheet spec, push). 36. **App Store / Play Store listing pack** + review-compliance notes. 37. **AI Features Spec** (assist modes, quotas, provider abstraction, data-handling disclosure). 38. **Connector SDK Spec + Marketplace Policy** (third-party connector review rules). 39. **Analytics/Data Warehouse Spec** (rollups, product analytics events, privacy-respecting).

## Phase 7 — Enterprise (months 6–18)
40. **Enterprise Requirements Pack** — SSO (SAML/OIDC), SCIM, audit-log spec, session policies, data residency. 41. **Team/Approvals Workflow Spec** (roles, states, audit). 42. **Self-Hosted Edition Guide** (licensing decision memo: open-core boundaries). 43. **SOC 2 Readiness Plan** → policies bundle (access control, change mgmt, vendor mgmt, BC/DR) → audit. 44. **SLA + Enterprise MSA templates.** 45. **Trust & Safety Policy** (abuse of publishing tools, spam prevention, report handling). 46. **Accessibility Conformance Report (VPAT/WCAG 2.2 AA)** — the alt-text-first culture makes this earnable.

**Sequencing rule:** nothing in Phase N blocks starting Phase N+1's cheap items early, but no public beta before 22–24 + 29–31, and no enterprise sales motion before 40–44.
