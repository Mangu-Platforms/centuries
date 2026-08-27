# NEXUS: Every Network, One Voice
### A white paper on owning the interface layer of social media
Mangu Platforms · v1.0 · August 2026

## Abstract

Social media did not consolidate; it shattered. A person with something to say now maintains a presence on X, Threads, Bluesky, Mastodon, and Instagram, each with its own client, its own character limit, its own audience, and its own failure modes. The cost of that fragmentation is paid in attention, in duplicated labor, and in reach forfeited to whichever networks a person is too tired to open. NEXUS is a bet that the durable position in this landscape is not another network but the interface above all of them: one place to read everything, one place to write once and publish everywhere, built on open protocols first so that no gatekeeper can switch it off. This paper describes the product, the architecture that makes it defensible, the path from the working aggregator that exists today to an enterprise platform, and an honest accounting of the risks.

## 1. The problem: the post-Twitter diaspora is permanent

Between 2022 and 2026 the default public square dissolved into at least five viable successors. None won. Bluesky and Mastodon grew on open protocols; Threads attached itself to Instagram's graph; X retained incumbency and chaos. The realistic forecast is not reconsolidation but permanent multipolarity, because the forces that split the landscape — ownership disputes, moderation philosophy, protocol ideology — are structural, not cyclical. Every creator, brand, journalist, and ordinary opinionated person now faces the same daily tax: five apps to check, five composers to paste into, five sets of replies to miss. The tools that exist address half the problem at most. Schedulers such as Buffer and Hootsuite publish outward but offer no reading experience and price for marketing departments. Readers such as Openvibe and Tapestry aggregate inward but publish thinly or not at all. The apps people actually live in remain the networks' own, which is precisely the fragmentation being suffered.

## 2. The thesis: own the interface, not the network

When a market fragments irreversibly, value migrates to whatever layer reunifies the experience. Browsers did this to websites; email clients did it to mail servers. NEXUS applies the same move to social: a two-way client that treats every network as a backend. The strategic core is a single abstraction, the PlatformConnector, behind which all platform-specific code is quarantined. Reading, writing, scheduling, analytics, and identity are built once against that seam; each network is one replaceable file. This inverts the usual power relationship. Networks compete to be well-represented inside the user's chosen interface, and the user's center of gravity — their merged feed, their publishing history, their cross-network interaction graph — accumulates in NEXUS, where it compounds and cannot be replicated by any single platform.

Two design commitments make the thesis credible rather than merely stated. First, protocols before permissions: Bluesky's AT Protocol and Mastodon's ActivityPub require no developer approval and cannot be revoked by a business-development decision, so they form the foundation, while X and Meta connectors are treated as env-gated accelerants that degrade gracefully to demo mode when absent. Second, the product must never go dark: deterministic demo connectors are a permanent fallback for every platform, which simultaneously guarantees resilience and gives NEXUS something no competitor has — a complete, zero-credential product demo that is the product itself.

## 3. What exists today

This is not a concept paper. As of August 2026 the repository contains a working aggregator: unified chronological feed with stable cursor pagination, deduplication, background sync, and image rendering; a cross-post composer with per-platform limit enforcement, partial-failure reporting, race-safe idempotency, and scheduled sends driven by a restart-proof external cron; hardened authentication with rotating refresh tokens, theft detection, lockout, password reset, and session management; encrypted credential storage under AES-256-GCM; live connectors for Bluesky and Mastodon that are code-complete and awaiting only a human's test credentials; continuous integration including an end-to-end browser test. It was built by an autonomous agent operating under a written 1,242-hour charter with a public backlog and session log — an operating discipline that is itself part of the asset.

## 4. Architecture for the decade

The system is deliberately boring where boring wins — Next.js, Fastify, Prisma, Postgres — and opinionated at exactly three points. The connector seam, described above, is the extensibility surface; adding LinkedIn, Farcaster, Nostr, or RSS is a one-file exercise, which later becomes a community SDK and marketplace. The publishing ledger (PublishJob and PublishTarget) records every send, immediate or scheduled, per network, with latency and error detail, which is the substrate for retries, approvals, analytics, and audit long before those features exist. The credential vault encrypts every token at rest under a server-side key with no plaintext path, which is the substrate for the trust position the brand will stand on: your keys are safer in NEXUS than in a browser tab, you can export everything, and eventually you can run it yourself.

## 5. The road to enterprise

The sequence is deliberate. Near term, live-validate the open-protocol connectors, add resilience (retries, backoff, circuit breakers) and connection-health UI, ship media uploads and per-target retry, and stand up production on Postgres with real observability. Mid term, ship the surfaces that convert utility into habit and habit into revenue: the Planner with queue slots, Lenses and a multi-column deck for power readers, real analytics, a braided public identity page, and mobile apps whose share sheet makes "post everywhere" a system-level verb. Long term, the layers that make NEXUS an institution: team workspaces with approval workflows and audit, SSO and SCIM, a self-hosted edition for organizations that cannot outsource their voice, and the connector marketplace that turns the seam into an ecosystem.

## 6. Business model

Open-core with a straightforward ladder: a free tier generous enough to be someone's daily client; a Pro tier priced for individuals rather than departments, carrying the planner, analytics, variants, and AI assistance; a Team tier adding approvals and shared workspaces; an Enterprise tier adding SSO, audit, and self-hosting. The category's incumbents have abandoned the individual at the low end and the sovereignty-minded organization at the high end; NEXUS takes both flanks.

## 7. The network question

Should NEXUS ever become a network itself? The disciplined answer is: client first, network by gravity. Every feature that makes the client indispensable — the braided profile, cross-network lists, the unified inbox — quietly assembles the ingredients of a network without demanding one. If a day comes when enough people's primary identity is their NEXUS braid, native posting is a small step taken from strength. Declaring a new network on day one would be the opposite: maximal cost, minimal leverage, and a betrayal of the neutrality that makes the client trustworthy.

## 8. Risks, stated plainly

The defining risk is platform dependency: X's API is expensive and volatile, Meta's review is slow, and either could tighten further; the mitigation is structural (open protocols as the foundation, gated giants as bonuses) rather than hopeful. Aggregator terms-of-service risk is real but well-trodden — the incumbents operate on official APIs, and NEXUS uses only official APIs with user-granted credentials. Ranking and inbox features are constrained by what each API exposes; capability descriptors per connector keep the UI honest about it. Finally, the project's velocity currently depends on an unusual agentic build process; the charter, backlog, and campaign log exist precisely so that any engineer, human or otherwise, can resume it cold.

## 9. Conclusion

The fragmentation of social media is the largest interface vacuum since the browser wars, and it will not close on its own. The repository already holds the hard parts done right: the seam, the ledger, the vault, and a working product wrapped in unusual engineering discipline. What remains is execution along a sequence this pack lays out in full — and two credentials only a human can supply. Every network. One voice.
