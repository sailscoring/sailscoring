# User Documentation Approach

## Rationale

User documentation starts on day one — not because the product is mature, but because it isn't. Writing docs for a bare-bones app forces clarity about what the user-facing interface actually is, and sets the expectation that docs are a first-class deliverable rather than something retrofitted later. A race scorer encountering the app for the first time should not need to figure it out from scratch.

## Where Docs Live

User documentation is served in-app at `/help`, accessible from the deployed app at `app.sailscoring.ie/help`.

This is the right default for an MVP:

- **No extra infrastructure.** The docs deploy with the app via the same Vercel pipeline.
- **Always in sync.** There is no separate docs site to fall out of date with the running version.
- **Accessible to all users.** Any scorer who can use the app can reach the docs without leaving it.

The `/help` route is a standard Next.js App Router page (`app/help/`). As the app grows, it can expand to nested pages (`app/help/competitors/`, `app/help/standings/`, etc.) without any tooling changes.

## Tooling

No extra tooling for the first iteration. Help pages are plain React components, styled with the same Tailwind CSS / shadcn/ui stack as the rest of the app.

**MDX** (`@next/mdx`) is the natural upgrade path if prose-heavy content makes JSX unwieldy — but it is not introduced until that friction appears. Adding MDX is a one-line config change; there is no cost to deferring it.

## What "Bare-bones" Means

The first iteration covers the **M1 happy path**: everything a race scorer needs to score a single-fleet, position-based series from start to finish. It is:

- **Workflow-oriented**, not feature-catalogued — written as "how do I do X" rather than "here is what button Y does"
- **Plain prose**, no screenshots in v1 — screenshots go stale; clear instructions do not
- **Written for a non-technical scorer** who has never used the app before, and may be the only person at their club who does this job

It does not cover edge cases, result codes beyond the common ones (DNS, DNF, DSQ), or features not yet built.

## First Iteration Content

A single `/help` page covering the full M1 workflow in sections:

1. **What is Sail Scoring?** — one paragraph: what the app does, who it is for, that it runs in the browser and stores data locally
2. **Creating a series** — name, venue, date; what a "series" is in this context
3. **Adding competitors** — sail number (required), name, club; why sail numbers must be unique
4. **Adding races** — race number, date; how races relate to a series
5. **Entering results** — the finish entry flow: search by sail number, set finishing order, assign result codes (DNS / DNF / DSQ explained briefly)
6. **Reading the standings** — how points are calculated (Low Point), what net points and discards mean; pointer to RRS Appendix A for the authoritative rules

A brief inline glossary (or link to `docs/requirements/glossary.md` for internal use) can supplement until a user-facing glossary is warranted.

## Keeping Docs Current

Convention: **when a feature ships, its help text ships with it.** If a PR adds a new workflow or changes an existing one, it updates `/help` in the same commit. There is no separate docs backlog.

This does not mean every change requires a prose update — small UI tweaks do not. But any change that would cause a scorer to be confused about what to do next warrants a docs update.
