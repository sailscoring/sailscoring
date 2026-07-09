# Sail Scoring: Project Goals

## Background

Sail race scoring is a specialized discipline. Clubs and class associations rely on a small number of volunteers who can translate sailing instructions into correct results using software tools. The dominant tool today is [Sailwave](https://www.sailwave.com/) -- a Windows desktop application that has served the community well for decades but which presents real challenges:

- **Platform:** Windows-only, with no web or mobile access. Scoring must happen on one person's laptop.
- **Learning curve:** The interface is dense and unforgiving. New volunteers find it intimidating, which limits the pool of people who can help with scoring.
- **Legacy technology:** Built on aging foundations with no modern API, no real-time publishing, and limited extensibility.
- **Maintainership:** Developed and maintained primarily by a single individual. The project's long-term future is uncertain.

These problems are not hypothetical. At Howth Yacht Club, a panel of roughly four volunteers handles all race scoring. At IODAI (the Irish Optimist class), a single scorer manages events with up to 200 competitors. In both cases, growing the volunteer base is difficult because of Sailwave's complexity. The consequences of losing an experienced scorer -- through burnout, life changes, or simply unavailability on race day -- are immediate and disruptive.

[HalSail](https://www.halsail.com/) has emerged as a web-based alternative, and is gaining adoption among some organizations. However, it shares some concerning characteristics: it is a proprietary product developed by a single maintainer, offers limited transparency into its development direction, and its user experience and feature coverage do not fully address the needs of clubs like HYC that rely on progressive handicap systems and dual scoring.

## Vision

Sail Scoring aims to be a web-based sail race scoring application that is accessible, correct, and sustainable.

- **Accessible:** A scorer with basic sailing knowledge and a web browser can set up and score an event without specialized training. The interface should guide rather than intimidate.
- **Correct:** Scoring must faithfully implement the Racing Rules of Sailing (RRS) Appendix A, handle the full range of handicap systems and result codes, and produce results that withstand scrutiny from competitors and protest committees.
- **Sustainable:** The project must be organized so that its long-term viability does not depend on any single individual -- whether that's the original developer, a particular volunteer, or a single hosting arrangement.
- **Contemporary.** The application should feel like it belongs in 2026, not 1996 or 2006. This is not an aesthetic preference; it directly serves the accessibility goal. A scorer working from a race committee boat on a tablet, or entering results on a laptop in a clubhouse, should find the interface familiar and self-explanatory. Changes should take effect immediately and visibly. Complexity should be available when needed but never imposed. The application should follow the conventions and interaction patterns that users expect from modern web applications -- not reproduce the desktop-era paradigms of existing scoring tools.

## The Irreplaceable Core

Not all parts of a scoring system are equally important. Some can be replaced by external innovation; one cannot.

**Finish recording** — entering the order or time at which boats cross the line — is already being disrupted. GPS trackers, transponders, and purpose-built mobile apps are increasingly capable of capturing finish data with less friction than a scorer typing into a form. Sail Scoring does not need to own this. A mobile finish-recording app, a GPS integration, or a data feed from another system can all supply the same inputs. The channel matters less than the data arriving correctly.

**Publishing and display** are similarly peripheral. Results can be consumed by any number of tools: a club's existing website, a third-party app, a federation's results platform. As long as Sail Scoring exposes a well-documented API, the display layer is replaceable. The **bilge** service (see [ADR-004](design/decisions/004-results-publishing.md)) is an explicit acknowledgement of this: a deliberately temporary publishing tool, designed to be replaced rather than grown into a permanent dependency.

**The irreplaceable core is scoring itself.** Given a series configuration, a list of competitors, and per-race finishes — assign scores, apply discards, and produce standings. This is the hard, rule-governed, trust-requiring part. It is the part that must be bullet-proof. Competitors and protest committees need to believe the results are correct; that belief rests entirely on the scoring engine.

Scoring is especially non-trivial when rating systems are involved. One-design scratch scoring is a handful of arithmetic steps. IRC and NHC handicap scoring requires time correction, progressive rating adjustment, and careful handling of dual scoring (multiple independent standings from a single set of finish times). ORC scoring is more complex still. The rules themselves — RRS Appendix A — are precise but not always intuitive, and the edge cases (ties, redress, scoring penalties, abandoned races) require careful implementation.

**libscoring is the part worth protecting and growing.** The scoring engine is not an implementation detail; it is the thing Sail Scoring exists to provide. The long-term aspiration is for libscoring to become the de-facto standard implementation of sail racing scoring rules — the library that other tools reach for when they need to know whether a tie-break was applied correctly or how progressive handicap points compound across a series. A credible, well-tested, well-documented implementation of Appendix A, freely available, is a genuinely useful thing for the sailing community to have. Nothing like it currently exists.

This framing has a practical implication for prioritisation: the scoring engine deserves the most rigour, the most test coverage, and the most care in its public API. Everything else in Sail Scoring is valuable but subordinate. A finish-entry screen that is clunky but correct is better than a beautiful screen backed by a buggy scoring engine.

## Near-Term Goals

The near-term goal is to build a Minimum Viable Product and validate it with real users during a stealth beta period.

### MVP

Build the smallest version of Sail Scoring that can score real events for two target organizations:

1. **IODAI events** -- position-based scratch scoring for large one-design fleets with mixed-division finish entry, standard Appendix A scoring, and result codes. (See [IODAI use case](requirements/iodai-use-case.md).) **Status: complete.** Milestone 1 delivered the full IODAI workflow including scratch scoring, all RRS Appendix A result codes, discards, CSV competitor import, and results publishing.

2. **HYC Autumn League** -- time-based finish entry with handicap correction (IRC and progressive NHC), dual scoring from a single finish time, and per-race rating adjustments. (See [HYC use case](requirements/hyc-use-case.md).) **Status: complete.** Phase 1 (IRC, PY) and Phase 2 (NHC1 progressive handicap and ECHO) are built, along with multi-fleet competitors, the finish sheet model for mixed timed/untimed entry, per-fleet start groups, per-race rating persistence, and rating-calculation explainability. Several handicap-system variants and refinements are deferred — see `docs/design/handicap-scoring.md` and the horizon doc.

The MVP must demonstrate that Sail Scoring can handle both of these use cases end-to-end: from event setup and competitor registration, through result entry and scoring, to published standings.

### Stealth Beta

**Status: in progress.** The stealth beta has begun with scorers at HYC, who are currently reviewing historical events in the application. Live race-day scoring has not yet been attempted.

The intent of this phase is to introduce the application to a small number of carefully chosen early adopters:

- **Goal:** Validate that the application works in real scoring conditions, collect feedback, and build confidence before any wider release.
- **Audience:** Trusted scorers at HYC and IODAI, and potentially one or two other Irish clubs with similar needs.
- **First impressions matter.** Early adopters are doing the project a favour by investing their time and trust. The application must be reliable, the results must be correct, and the experience must be noticeably better than Sailwave for their use cases -- even if feature coverage is narrower.
- **Deployment:** Hosted as a web application, with hosting costs borne by the project founder during this period.

### Full-Stack Transition

**Status: largely complete.** The MVP began as a local-first web application with data stored in the browser via IndexedDB ([ADR-003](design/decisions/003-application-architecture.md)). [ADR-008](design/decisions/008-full-stack-transition.md) committed to and sequenced the transition; Phases 1–8 are landed — Better Auth + Neon Postgres + the server-side data layer is the only runtime, the Dexie/IndexedDB code is gone, and HYC's scoring panel is on a shared workspace with actor-attributed concurrency. The migration was a swap of layers rather than a rewrite, as ADR-003 designed for: the repository pattern, the pure scoring engine, shared TypeScript types, and the JSON export/import format all carried across unchanged.

Two phases remain: Phase 9 replaces bilge with an integrated publish-to-blob-storage path at `/p/{slug}`, with a redirect window for existing bilge URLs; Phase 10 delivers self-service org administration, the full activity log, and vanity URLs. Both are scheduled in ADR-008 and tracked in `docs/design/horizon.md`.

### Near-Term Non-Goals

- Broad public availability or marketing.
- Feature parity with Sailwave. The MVP deliberately covers a narrow slice of Sailwave's functionality.
- Mobile-native applications. A responsive web application accessed through a browser is sufficient.
- Offline-first operation. Connectivity at race venues is generally adequate; offline support can be revisited later.

## Long-Term Goals

### Grow Beyond the Initial Use Cases

Irish club racing encompasses diverse formats -- ECHO handicaps, white sail racing, dinghy leagues, offshore racing under IRC and ORC. As Sail Scoring matures, it should expand to serve a broader range of Irish sailing clubs and class associations, and eventually the wider English-speaking sailing community and beyond.

This growth should be demand-driven: each new use case adopted because real users need it, not because features were added speculatively.

### Make Scoring Accessible to More Volunteers

The most important long-term goal is not a technical one. It is to lower the barrier so that more people can contribute to race scoring at their clubs. If Sail Scoring succeeds, the measure of that success is not how many features it has, but how many clubs can run their results without depending on a single indispensable volunteer.

### Establish a Sustainable Project Model

A part-time personal project cannot remain a part-time personal project if it gains real users who depend on it. The project needs a path to sustainability. Two broad models are worth considering:

**Open-source model:**

- Release the source code under a permissive open-source license.
- Grow a community of contributors -- developers, scorers, sailing administrators -- who share ownership of the project's direction.
- Fund hosting and infrastructure through donations, sponsorship, or a fiscal sponsor arrangement.
- Governance is community-driven, with the project's future not dependent on any one person.

**Proprietary/commercial model:**

- Operate as a commercial product, potentially with a freemium model (free for small clubs, paid tiers for larger organizations or federations).
- Revenue funds development and hosting directly.
- The founder (or a small team) retains control of product direction.

**Decision (July 2026): the open-source model.** The choice was deliberately deferred while the deciding factors were unclear; by mid-2026 they were not. The sustainability case made to sponsors and clubs leans directly on open source — forkability as the answer to the bus factor, transparency as the answer to trust — and that is the story that has resonated. No realistic proprietary path emerged, and pursuing one was never the founder's instinct. The code is released under the **MIT license**; external contributions use the Developer Certificate of Origin; the "Sail Scoring" name and logo remain trademarks governing who may operate a service under the name. The commercial model above is retained for the record. Execution — the audit and the flip to a public repository — is tracked in issue #282.

The preparation that made either choice possible, kept up from the outset, is what makes the decision cheap to execute:

- **Maintain clean intellectual property.** While the founder was the sole author, copyright ownership was straightforward and all licensing options remained open — which is what allowed the decision to be deferred without cost. Now that the project is open-sourced, the lighter-weight [Developer Certificate of Origin](https://developercertificate.org/) is the mechanism for external contributions, as it is for any permissively-licensed project.
- **Be cautious about third-party dependencies.** Avoid incorporating open-source libraries with copyleft licenses (e.g. GPL) that would impose obligations beyond the MIT license. Prefer permissively-licensed (MIT, Apache 2.0, BSD) dependencies.
- **Organize as a standalone entity.** Even while the project is personally funded, maintain separation between personal and project resources: a dedicated GitHub organization, dedicated infrastructure accounts, and a clear record of project costs. This ensures a seamless transition to a registered company, non-profit, or community-governed entity when the time comes.

### Build Confidence Through Correctness and Transparency

Scoring software occupies a position of trust. Competitors, protest committees, and organizing authorities need to believe that the results are correct. This trust is built through:

- **Faithful implementation of the rules.** Appendix A compliance is not optional or approximate.
- **Auditability.** Users should be able to understand how any score was calculated -- what inputs were used, what rules were applied, and why a particular result was produced.
- **Transparency in development.** Whether open-source or not, the project should be open about its approach to scoring rules, its known limitations, and its roadmap.

### Provide a Solid Technical Foundation

Without prescribing specific technology choices, the application should be built with these qualities:

- **Web-native.** Accessible from any device with a modern browser, with no software to install.
- **API-first.** A well-documented API that supports the full feature set, enabling automation, integration, and third-party tools.
- **Data portability.** Users should be able to export their data in standard formats. Lock-in is contrary to the project's values.
- **Reliable and tested.** Scoring correctness must be backed by comprehensive automated tests, particularly for Appendix A edge cases, tie-breaking, and handicap calculations.

## Adjacent Projects and Potential Synergies

[RacingRulesOfSailing.org](https://www.racingrulesofsailing.org/) is a community-maintained platform that provides cross-referenced racing rules, regatta management tools (event registration, protest handling, communications), and an active forum. It is not affiliated with World Sailing but is widely used by competitors, judges, and race officials. It sustains itself through patron subscriptions and a small percentage fee on event registrations processed through its platform.

RRS.org is interesting both as a model for sustainability -- a niche sailing tool funded by the community it serves -- and as a potential partner. Its scope is complementary: it handles rules reference, event registration, and protest management, but not scoring. One could imagine Sail Scoring providing a scoring capability that integrates with RRS.org's existing regatta management tools, or simply learning from its approach to community engagement and funding.

## Summary

Sail Scoring exists because the sailing community deserves scoring software that is accessible, correct, and not dependent on any single person or platform. The irreplaceable centre of that effort is the scoring engine: the rule-governed, trust-critical logic that translates finish data into standings. Finish recording, publishing, and display are designed to be replaced by external innovation; correct scoring is not.

The near-term focus is narrow and practical: build an MVP that serves IODAI and HYC, and validate it with real users. The long-term ambition is broader: establish a sustainable project that lowers the barrier to race scoring for clubs everywhere — and, through libscoring, provide a credible open implementation of the Racing Rules of Sailing that the wider sailing software community can build on.
