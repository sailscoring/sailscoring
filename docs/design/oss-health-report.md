# OSS Health Report: Lock-in Risks in Your Next.js / Vercel / Postgres Stack

*Compiled April 2026; updated July 8, 2026 for the Vercel/Better Auth acquisition. Focus: the projects you'd find hardest to migrate away from.*

## Scope and method

Of the components in your stack, only a few represent meaningful long-term commitments. Test libraries, icon sets, CSV parsers and class-composition utilities are easily swapped. Component code "owned in-repo" via the shadcn CLI similarly carries near-zero migration risk by design.

The seven things that actually pin you in are:

1. **Next.js** — framework, dictates routing, rendering, build output and a great deal of code structure.
2. **React** — substrate; every component depends on it.
3. **Tailwind CSS** — pervades every piece of markup; removing it is a full re-skin.
4. **Drizzle ORM** — defines schema and every query; touching the data layer means rewriting these.
5. **Better Auth** — auth flows, session model, adapter contract, and all callbacks.
6. **TanStack Query** — wraps every fetch, defines cache and revalidation semantics.
7. **PostgreSQL on Neon** — Postgres itself is highly portable; *Neon* is a vendor commitment.

Vercel is a hosting commitment rather than an OSS one, but it sits behind several of the above and its choices materially affect them, so it gets its own section.

What follows is what I'd want to know about each before betting a multi-year project on them.

---

## 1. Next.js — the deepest lock-in, with some recent strain

**Origin and ownership.** Created by Guillermo Rauch in 2016. Rauch is now CEO of Vercel; lead maintainer is Tim Neutkens. Per Next.js's own governance page, "research and development of Next.js is led by the core team working full-time at Vercel," with "over 3,000 contributors" historically. The React team at Meta and Google's Aurora team are listed as collaborators.

This is a **single-vendor open-source project**. There is no foundation, no neutral steering committee, and no separation between the company that monetizes the framework via hosting and the team that decides the framework's direction. Decisions are framed as RFCs in GitHub Discussions, but as Eduardo Bouças (formerly of Netlify) documents at length, in practice "the boundaries between the company and the open-source project" are not crisp, and many internal APIs that hosting providers depend on have historically been undocumented and subject to breaking changes in minor releases.

**The OpenNext story is the most important governance development.** Cloudflare and Netlify joined OpenNext in 2024 to collaborate on third-party adapters because Vercel's own Build Output API never gained Next.js support. After sustained pressure (and, in early 2025, a public commitment from Vercel to remove or document privileged code paths), Next.js 16.2 (March 2026) shipped a **stable Adapter API** and a new "Ecosystem Working Group" coordinating with platform partners. The framework's own announcement is candid that the working group "is not a decision-making body over the direction of Next.js itself; design decisions, feature priorities, and release timelines remain with the Next.js team." So: better than before, still not neutral.

**Release cadence.** Aggressive. 13 (Oct 2022) → 14 (Oct 2023) → 15 (Oct 2024) → 16 (Oct 2025) → 16.2 (March 2026). Major versions land yearly with breaking changes, though the upgrade tooling is good. The App Router, which your stack relies on, only stabilized in 13.4 (May 2023), and patterns are still evolving — Cache Components (`use cache`, `cacheTag`, `updateTag`), which your ADR-008 adopts, are a recent addition.

**Security history is the area that should make you most careful.** Two serious incidents in 13 months:

- **CVE-2025-29927** (March 2025, CVSS 9.1): the `x-middleware-subrequest` header could be spoofed to bypass middleware-based auth entirely. Affected every release from 11.1.4 through 15.2.2. Self-hosted apps were directly exposed; Vercel-hosted apps were patched at the platform layer.
- **CVE-2025-55182 / "React2Shell"** (Dec 2025, CVSS 10.0): unauthenticated RCE via deserialization in the React Server Components Flight protocol. Affected default `create-next-app` configurations on React 19 with no code changes by the developer. Exploited within hours of disclosure by multiple threat actors including state-nexus groups (per Google TIG, Microsoft, AWS), added to CISA's KEV catalog, used to drop coin miners, Cobalt Strike beacons, and persistence tooling. This is the closest thing the JavaScript world has had to a Log4Shell.

Both were patched promptly, but the pattern is: a fast-moving framework with deep coupling between framework, runtime and bundler, where edge-case logic at internal boundaries has had real-world consequences. You should assume more issues like this over the lifetime of a long-running project, and plan for rapid patch cycles.

**The April 2026 Vercel breach** (covered in §8) does not affect Next.js source itself, but does affect customer trust in the company that *is* Next.js's governance.

**Bottom line.** Excellent product, mature tooling, huge ecosystem, real momentum. But the project is governed by a hosting company whose business model creates pressure to make features work best on its own platform; the security record is mixed; and the upgrade treadmill is faster than most enterprise teams want. The new Adapter API is genuine progress — make sure you understand it, because it is the seam along which any future "get off Vercel" migration would happen.

## 2. React — newly under a foundation, but Meta still pays the bills

**Origin.** Released by Facebook in 2013. Roughly **80–85% of JavaScript developers** use it (State of JavaScript 2024–2025). It is the de-facto standard.

**The major recent event** is the formation of the **React Foundation**, announced by Meta in October 2025 and formally launched February 2026 under the Linux Foundation umbrella. Founding board members are Amazon, Callstack, Expo, Meta, Microsoft, Software Mansion, and Vercel; first executive director is Seth Webster, previously Meta's head of React. Meta committed over $3M and a five-year engineering partnership.

This *looks* like a mature governance transition, but read it carefully:

- The 21-member Core team includes 14 Meta employees, 5 Vercel employees, and 2 independents.
- The Foundation's executive director comes directly out of Meta's React org.
- The TSC is being designed but not yet operating fully independently.

The relevant comparison is Kubernetes joining the CNCF — it took several years for contributor employment to actually diversify after the formal handoff. Expect the same here. *Today*, React's roadmap is still set by people who work for Meta and Vercel; the Foundation is a structural improvement that will pay off over years, not weeks.

**Practical implication for you.** React itself is the safest piece of your stack from a sustainability standpoint. It's used by half the web, has a Foundation behind it, and Meta has business reasons to keep using and funding it indefinitely. Concerns are about *direction* (continuing complexity creep, server-side features increasingly tied to Next.js / Vercel patterns) rather than survival.

**React 19 + Server Components are recent.** RSCs only really stabilized with React 19 (Dec 2024), and they were the locus of December 2025's CVSS-10 RCE. You're adopting a young technology with one major catastrophic CVE already in its history. That's not a reason to avoid it, but it is a reason to keep your update discipline tight.

## 3. Tailwind CSS — strong technically, recently fragile financially

**Origin.** Adam Wathan and Jonathan Reinink, first release 2017. Now operated by **Tailwind Labs**, a small private company headquartered effectively wherever the founders live (the Latvian registration in some databases is a remnant of an earlier setup). Other principals: Steve Schoger (design), and a small engineering team. The OSS project is permissive-licensed (MIT).

Tailwind Labs has historically been **bootstrapped, not VC-funded**. Revenue came primarily from Tailwind UI / Tailwind Plus (paid components) — the founder reported the business reaching $4M in revenue "in under 2 years" back in 2020. By 2024 they had grown to ~8 employees with senior engineering compensation in the $250–300k range.

**Recent events you need to know.** In **January 2026**, Wathan announced major layoffs. According to widely reported coverage, Tailwind Labs went from 8 people back to roughly the three co-founders plus one engineer. The proximate cause was a ~40% drop in documentation traffic as AI coding assistants increasingly emit Tailwind by default without anyone visiting the docs, plus declining commercial-product revenue. The OSS framework is being used *more* than ever — it's one of the dominant outputs of LLM code generators — but the funding model that paid for its maintenance was hollowed out.

Within days, the project was rescued (at least in the short term) by sponsorships from Sentry's Open Source Pledge, Railway, and a number of smaller backers. Adam Wathan went public about the emotional cost; the `tailwindcss` repo was briefly made private during the worst of the GitHub backlash. As of early 2026, the project is technically healthy and still shipping.

**Tailwind v4** (released late 2024) is a significant rewrite: a Rust-based engine (Oxide), a new CSS-first configuration model using `@theme` and CSS custom properties, and dramatic performance gains. Your stack is on v4. The migration from v3 was non-trivial; if you're greenfielding on v4 you avoid that pain, but you're also early on a relatively young architecture.

**Bottom line.** Technically excellent, deep ecosystem, near-ubiquitous in modern AI-assisted coding workflows, MIT-licensed and forkable. But its corporate steward had a financial near-miss within the last few months, and its long-term funding model is unresolved. The project would survive Tailwind Labs going under — it's MIT and forkable, and the ecosystem is large enough — but velocity and direction would suffer. Worth tracking sponsorship announcements over the next year as a leading indicator.

## 4. Drizzle ORM — sustainable but recently entangled with PlanetScale

**Origin.** Drizzle ORM was started in 2021 by Andrew Sherman and Alex Blokh as a TypeScript port of an earlier internal Java tool from a Ukrainian outsourcing agency. The team is based in Dnipro, Ukraine, and the company is registered as an LLC through Diia City. The library is MIT-licensed and zero-dependency.

**By the numbers** (late 2025, before the recent acquisition): 21 full-time developers, 17% of the TypeScript ORM market by npm download share (up from 11% earlier in the year), used in production by Replit, Sentry, Databricks, Deco.cx, Figma and many others. Reached profitability in 2024. Famously declined VC offers, choosing bootstrapped growth.

**The big sustainability event: March 2026, PlanetScale hired the entire Drizzle core team.** Drizzle's own sustainability page now reads, "PlanetScale hired entire Drizzle core team and becomes the biggest backer we have." The framing is positive — they get to keep working on Drizzle full-time — but in OSS-history terms, this is the same pattern as Mongoose-via-Automattic, MongoDB Compass-via-MongoDB, etc. The team is intact and shipping (Drizzle Kit and Drizzle Studio rewrites in progress, v1 work underway), but the organizational pressure now flows from a database-vendor parent rather than a self-sustaining OSS shop.

This isn't bad — PlanetScale is a healthy, well-led company with a solid OSS reputation (their MySQL Vitess work is exemplary) — but it is a change. Note also that **Drizzle Studio** has commercial components (Studio Gateway, embeddable Studio component) that are not part of the OSS package; the boundary between the free ORM and paid ancillary tooling exists and could shift.

**Maintenance signals are good.** The repo has been actively maintained throughout 2024–2026, including a substantial drizzle-kit rewrite and a v7 / v1 push. Issue triage isn't always fast — a 2025 sustainability discussion thread on GitHub flagged a backlog of unanswered PRs — but the maintainers responded transparently and have continued to ship.

**Migration risk if Drizzle stalled.** Moderate. The schema definition syntax and query API are Drizzle-specific, so a migration to e.g. Kysely, Prisma, or hand-written SQL would mean rewriting both. However, because Drizzle is "a thin typed layer on top of SQL" (in the maintainers' own words) with no Rust binaries, no proxy, and direct driver use, the actual SQL it generates is portable. You're locked into the *schema/query DSL*, not the *runtime data path*.

## 5. Better Auth — future-proof by the maintainers' own logic, now acquired by Vercel

**Some history, because it explains why you're here.** Auth.js (formerly NextAuth.js) was handed to the Better Auth team in September 2025, and the new maintainers were candid that they "strongly recommend new projects to start with Better Auth unless there are some very specific feature gaps (most notably stateless session management without a database)." Your ADR-008 followed that advice: this codebase runs **Better Auth** (`lib/auth.ts`) with database-backed sessions against Neon/Drizzle, not Auth.js v5. So this section is about the library you're actually on, not a choice still ahead of you.

**The material development: Vercel acquired Better Auth, announced 7 July 2026.** Founder Bereket Engida and the core team are joining Vercel "to continue their work on Better Auth and agent identity." Per the announcement, the project "retains its name, and the team continues to lead development with the same open contribution model, community governance, and framework support," and "remains free and open source under MIT." Beyond conventional auth, the team's stated focus is advancing *agent identity*, integrated into Vercel Connect and eve (Vercel's agentic platforms).

Read this the way the rest of this report reads the Neon/Databricks and Drizzle/PlanetScale deals: **the reassuring parts are real, and so is the shift in who sets the roadmap.** MIT + 4.7M weekly downloads + 850 contributors means the library survives and stays forkable regardless of Vercel. But direction now flows from a hosting company whose commercial priority for auth is agent identity on its own agentic platforms — not necessarily what an independent auth library would prioritise. The irony worth naming plainly: Better Auth was, until three months ago, the *independent* alternative to the Vercel-governed corner of your stack. It is no longer independent of Vercel. Whatever comfort you took from "at least the auth layer isn't Vercel's" is gone; auth now belongs on the concentration list in §8.

**What this does and doesn't change for you.** Nothing breaks: your Drizzle adapter, session model, and magic-link-via-Resend flow are untouched, and MIT means no rug-pull on licensing. What changes is the *watch list* — specifically whether agent-identity/Vercel-platform priorities start shaping the OSS core, and whether a free-vs-paid boundary emerges around the hosted/agent pieces (the same "the boundary exists and could shift" caveat this report raises for Drizzle Studio).

**A standing security note that survives the acquisition:** the March 2025 Next.js middleware bypass (CVE-2025-29927) hit middleware-only auth patterns particularly hard. Your ADR-008 retains middleware-gated routes, so make sure the auth checks are *not* middleware-only — enforce at the route handler level too. Defence in depth here is independent of who owns the library.

## 6. TanStack Query — the healthiest sustainability story in your stack

**Origin.** Tanner Linsley, originally as React Query (2019–2020). Now part of the broader TanStack umbrella (Query, Table, Router, Form, Virtual, Start). MIT-licensed. The project's main caretaker for Query specifically is Dominik Dorfmeister; Tanner is the umbrella owner.

**Funding model.** TanStack is a genuinely independent OSS organization. As of late 2025, Tanner went full-time on TanStack via partnerships and sponsorships from 16 partner companies. From his own State of TanStack post (November 2025):

- 13 active projects, 36 core contributors, ~6,300+ on Discord.
- 4+ billion total downloads, 112,660 GitHub stars, 2,790 contributors.
- Funding covers Tanner's salary, sponsorships for ~12 core contributors, and contracts for another 3–5 people.
- No VC. No paid tiers of the libraries themselves. No acquisition. Multiple partner sponsors mean no single funder controls the project.

This is one of the cleanest sustainability stories in modern frontend OSS. The structural risk is low — if any one sponsor pulled out, the others would more than cover the gap.

**Stability of Query specifically.** Very high. The API has been stable across major versions, breaking changes are rare and well-documented, and the `persistQueryClient` plugin you're relying on for offline persistence has been in widespread production use for years.

**What to watch.** Tanner's broader TanStack Start framework is positioned as a Next.js alternative — there's mild strategic tension if you're committing to both ecosystems. Doesn't affect Query's reliability, but worth noting.

## 7. PostgreSQL — the easiest piece; Neon — the loudest vendor commitment

**PostgreSQL itself.** Independently governed by the PostgreSQL Global Development Group, ~30 years of release history, no single corporate owner, used by virtually every major cloud provider. As an OSS project it is the textbook example of long-term health. **Migration from one Postgres host to another is a routine operation**; your data and your SQL go anywhere.

**Neon.** Founded 2021. Built a serverless Postgres with separated storage and compute, copy-on-write branching, and a Rust-based page server. **Acquired by Databricks in May 2025 for approximately $1 billion.**

This is a meaningful change since you presumably picked Neon. The rationale Databricks gave is the AI-agent angle — Neon reports that ~80% of new database creations on its platform are now initiated by AI agents — and Databricks is positioning Neon as the OLTP layer of the lakehouse. Implications for you:

- *Operational*: short-term continuity is good. The team joined intact; the brand and product survive. Existing Vercel Marketplace integration continues.
- *Strategic*: Neon's roadmap will increasingly be shaped by Databricks' priorities (AI workloads, agent infrastructure, lakehouse integration), not by what an indie Postgres-as-a-service company would choose. Pricing, free tier, and feature gating all become subject to a much larger corporate strategy.
- *Risk*: Databricks could deprecate the standalone Neon offering and fold it into a higher-tier Databricks product, similar to how Snowflake has handled some past acquisitions. There's no indication this will happen, but it is in the realm of plausible 3–5 year scenarios.
- *Mitigation*: because the underlying database is Postgres, you can move. Run `pg_dump` against Neon, restore on Supabase / Crunchbridge / RDS / fly.io / your own box — the actual data layer is portable in a way none of the rest of your stack is.

This is actually the most important point of the whole report: of the seven things in your stack, **the one that runs on the most boring, most portable technology is the one with the most acquisition activity around it**. Mind that asymmetry.

## 8. Vercel — not OSS, but it sits behind half this stack

Brief, since it's not strictly an OSS project, but it's relevant context.

- **Concentration risk.** Vercel governs Next.js, employs the maintainer of shadcn/ui, employs five members of the React Core team, runs the v0 generative-UI product, is a founding board member of the React Foundation, and — as of July 2026 — now owns Better Auth (§5), the auth layer this stack runs on. This is the most concentrated single-vendor influence in the modern frontend stack, and your stack sits inside it at the framework, component, and auth layers simultaneously.
- **April 2026 security incident.** A Vercel employee installed a third-party AI tool (Context.ai) and granted it broad Google Workspace OAuth access. Context.ai had been compromised in February 2026 via Lumma Stealer infostealer infection of one of its own employees. The attacker chained the OAuth trust into the Vercel employee's Google account, then into Vercel internal systems. Non-sensitive environment variables stored in plaintext were exfiltrated; "sensitive" environment variables (a separate encryption-at-rest tier) were not. ShinyHunters claimed credit and listed data for sale on BreachForums for $2M; Vercel says Next.js and Turbopack source were unaffected. CEO Guillermo Rauch confirmed the attack chain publicly on April 19. Investigation is ongoing as of late April 2026.
- **The lesson** isn't that Vercel is uniquely insecure — supply-chain-via-OAuth-app is a category problem affecting every SaaS vendor — but it does reinforce that running on Vercel means depending on Vercel's operational security posture, and that environment variables marked merely "non-sensitive" should be treated as potentially readable in a worst case.
- **Lock-in management.** The Next.js 16.2 stable Adapter API (March 2026) is the single most useful development for portability of the framework. Familiarize yourself with it now, even if you stay on Vercel. It is the seam along which OpenNext, sst, and a few self-host paths now operate.

---

## Cross-cutting observations

**Concentration around Vercel and Meta.** Vercel's footprint in your stack widened in July 2026: on top of Next.js (direct), React (Core team seats and Foundation board), and shadcn/ui (via employment), it now owns Better Auth — so the *auth* layer joined the *framework* and *component* layers under a single vendor. Better Auth had been one of the independent choices in this list; that's no longer true. Tailwind and TanStack are now the only meaningfully independent projects here, with Drizzle PlanetScale-backed. This is not unusual for modern JavaScript stacks — it is structural to that ecosystem — but the asymmetry is worth being clear-eyed about: the pieces you'd have called "independent" keep getting acquired.

**Recent security pattern.** Two CVSS 9+ vulnerabilities in Next.js / React in 13 months (CVE-2025-29927, CVE-2025-55182), plus a hosting-provider supply-chain breach (April 2026), plus a maintainer transition in your auth library (Sept 2025). The stack itself is technically excellent; the *operational security posture* of running it requires more active vigilance than, say, a Rails or Django stack with a lower release velocity.

**Funding-model fragility in adjacent projects.** Tailwind Labs' January 2026 layoffs are part of a broader pattern of OSS funding pressure as AI-generated code reduces docs traffic (the long-standing proxy for monetizable attention). Several of your dependencies are sustained by sponsorship from companies (Sentry's Open Source Pledge, Railway) rather than by the projects' own revenue. This is not a stable equilibrium across an industry, though the specific projects sponsoring Tailwind, Drizzle, and TanStack are themselves healthy.

**A note on your "low-lock-in" choices.** Two ADR-008 choices stand out as particularly well-judged from a sustainability angle:

- **shadcn/ui.** Code is copied into your repo and you own it. If shadcn the maintainer disappears, your existing components don't break; you just stop getting new ones via the CLI. This is genuinely the lowest-lock-in component-library model in the ecosystem.
- **Postgres + Drizzle.** Drizzle generates standard SQL against standard Postgres. The combination is much more portable than ORM+vendor-DB pairings like Prisma+PlanetScale-Vitess or Mongoose+MongoDB Atlas.

## Concrete recommendations

1. **Keep the Better Auth escape hatch warm now that it's Vercel-owned.** You're already committed to Better Auth (the right call at the time, and still fine — MIT, forkable, healthy). But the July 2026 Vercel acquisition means auth is no longer a hedge against Vercel concentration. Keep your session/adapter usage close to the documented core and out of anything agent-identity- or Vercel-platform-specific, so that if the OSS core diverges toward Vercel's commercial priorities you could migrate (to Auth.js's successor, Lucia-style hand-rolled sessions, or another Drizzle-adapter library) without a session-model rewrite. This is cheap insurance, not an alarm.

2. **Treat Vercel hosting and Next.js framework as separable.** Set up your project today so it can build with `next build` and run with `next start` on a plain Node host (or via the OpenNext adapter). Even if you never exercise that capability, knowing that your `next.config` doesn't depend on Vercel-only features is the cheapest insurance you can buy against governance shifts.

3. **Pin major versions and do scheduled, not opportunistic, upgrades.** Next.js's release cadence rewards staying current but punishes drift. Plan a Next.js minor-upgrade cadence (e.g., quarterly) and a major-upgrade exercise (e.g., yearly). The same applies to React, given RSC churn.

4. **Encrypt all secrets at the application layer, not just at the platform "sensitive" tier.** The April 2026 Vercel breach showed that "non-sensitive" environment variables are a category that includes things you'd rather an attacker not have.

5. **Don't over-invest in patterns specific to current Next.js cache APIs (`use cache`, `cacheTag`, `updateTag`).** These are recent and have evolved twice in 18 months. Keep them isolated behind a small abstraction in your code so a future cache-API rewrite (which seems likely) is contained.

6. **Track Postgres-level portability tests as part of CI.** A weekly job that dumps your Neon DB and restores it onto a vanilla Postgres in a container will catch any inadvertent reliance on Neon-specific extensions or behavior. Cheap insurance against a future Databricks-direction-shift scenario.

7. **Watch four indicators over the next 12 months:**
   - Tailwind Labs' sponsorship/runway updates — second consecutive year of layoffs would be a red flag.
   - React Foundation's first independent technical decisions — does the TSC actually disagree with Meta/Vercel on anything visible?
   - PlanetScale's treatment of Drizzle — does it remain genuinely vendor-neutral, or does Drizzle's MySQL dialect quietly start outpacing its Postgres one?
   - Better Auth under Vercel — now that Vercel owns it (July 2026), watch whether agent-identity / Vercel-platform priorities start shaping the OSS core, and whether a free-vs-paid boundary emerges around the hosted or agent-identity pieces. The "same open governance, still MIT" promises are worth holding them to.

---

*Sources and dates checked April 26, 2026. **Updated July 8, 2026** to reflect Vercel's acquisition of Better Auth (announced 7 July 2026) — see §5, §8, the concentration note, and recommendations 1 and 7; the rest of the report still reflects the April snapshot. The fast-moving ones — Vercel breach scope, React Foundation TSC formation, Tailwind Labs financial recovery, and now Better Auth's direction under Vercel — will continue to develop; this report reflects two points in time, not a live view.*
