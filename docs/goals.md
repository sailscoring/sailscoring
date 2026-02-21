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

## Near-Term Goals

The near-term goal is to build a Minimum Viable Product and validate it with real users during a stealth beta period.

### MVP

Build the smallest version of Sail Scoring that can score real events for two target organizations:

1. **IODAI events** -- position-based scratch scoring for large one-design fleets with mixed-division finish entry, standard Appendix A scoring, and result codes. (See [IODAI use case](requirements/iodai-use-case.md).)

2. **HYC Autumn League** -- time-based finish entry with handicap correction (IRC and progressive HPH/NHC), dual scoring from a single finish time, and per-race rating adjustments. (See [HYC use case](requirements/hyc-use-case.md).)

The MVP must demonstrate that Sail Scoring can handle both of these use cases end-to-end: from event setup and competitor registration, through result entry and scoring, to published standings.

### Stealth Beta

Once the MVP is functional, introduce it to a small number of carefully chosen early adopters:

- **Goal:** Validate that the application works in real scoring conditions, collect feedback, and build confidence before any wider release.
- **Audience:** Trusted scorers at HYC and IODAI, and potentially one or two other Irish clubs with similar needs.
- **First impressions matter.** Early adopters are doing the project a favour by investing their time and trust. The application must be reliable, the results must be correct, and the experience must be noticeably better than Sailwave for their use cases -- even if feature coverage is narrower.
- **Deployment:** Hosted as a web application, with hosting costs borne by the project founder during this period.

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

**The choice between these models is deliberately deferred.** Both have precedent in the sailing software space and in software generally. The right choice depends on factors that will become clearer as the project develops: whether a contributor community emerges, whether there is willingness to pay, and what model best serves the sailing community long-term.

What is not deferred is the preparation to make either choice possible. From the outset, the project should:

- **Maintain clean intellectual property.** While the founder is the sole author, copyright ownership is straightforward and all licensing options remain open. If external contributions are accepted before a licensing decision is made, contributors should assign copyright or grant a broad license that preserves the project's freedom to choose its licensing model later. (Once the project is open-sourced -- if it is -- a lighter-weight mechanism like the [Developer Certificate of Origin](https://developercertificate.org/) is sufficient, as it is for any permissively-licensed project.)
- **Be cautious about third-party dependencies.** Avoid incorporating open-source libraries with copyleft licenses (e.g. GPL) that would constrain future licensing choices. Prefer permissively-licensed (MIT, Apache 2.0, BSD) or proprietary-compatible dependencies.
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

Sail Scoring exists because the sailing community deserves scoring software that is accessible, correct, and not dependent on any single person or platform. The near-term focus is narrow and practical: build an MVP that serves IODAI and HYC, and validate it with real users. The long-term ambition is broader: establish a sustainable project that lowers the barrier to race scoring for clubs everywhere.
