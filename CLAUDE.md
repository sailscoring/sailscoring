# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Sail Scoring is a sail racing scoring application for managing regattas, series, and race days. It handles handicap corrections, result codes, discard rules, and series standings per World Sailing Racing Rules of Sailing (RRS) Appendix A.

**Current status:** Milestone 1 complete. A working local-first web app is built and deployed to `app.sailscoring.ie` (Vercel). It supports scratch (position-based) scoring for a single fleet across multiple races with series standings.

## Tech Stack

- **Framework:** Next.js 16 (App Router), React 19, TypeScript
- **Styling:** Tailwind CSS v4, shadcn/ui components (`components/ui/`)
- **Storage:** IndexedDB via Dexie.js (`lib/db.ts`, `lib/dexie-repository.ts`)
- **Package manager:** pnpm; Node 24.x
- **Unit/integration tests:** Vitest (`tests/` — run with `pnpm test:unit`)
- **E2E tests:** Playwright (`e2e/` — run with `pnpm test:e2e`)
- **Deploy:** Vercel (`pnpm deploy` / `pnpm deploy:prod`); see `DEPLOY.md` for custom domain setup

## Source Layout

```
lib/
  types.ts              — core data types: Series, Competitor, Race, Finish, RaceScore, Standing
  repository.ts         — repository interfaces (SeriesRepository, CompetitorRepository, etc.)
  dexie-repository.ts   — Dexie/IndexedDB implementations, exported as seriesRepo, competitorRepo, raceRepo, finishRepo
  scoring.ts            — pure scoring engine: calculateRaceScores(), calculateStandings()
  series-file.ts        — series file serialization, lineage check, open/save/update flows
  db.ts                 — Dexie DB schema
  debug.ts              — debug logging utility
  utils.ts              — shadcn/ui utility (cn)
app/
  page.tsx              — home: lists series, New Series and Open Series buttons
  series/new/page.tsx   — create series form
  series/[id]/
    layout.tsx          — series shell with nav tabs (Competitors, Races, Standings, File); Ctrl+S saves to file
    competitors/page.tsx — manage competitors (add, delete; sorted by sail number)
    races/page.tsx       — manage races (add, delete)
    races/[raceId]/page.tsx — enter finish positions and result codes per race
    settings/page.tsx   — series settings and file management (Save to File, Update from File)
    standings/page.tsx   — series standings with per-race points and result codes; Export HTML
```

## Repository Structure

- `docs/` - Living project documentation (requirements, design, planning)
  - `docs/design/decisions/` - Architecture Decision Records (ADRs)
  - `docs/design/naming.md` - Project naming conventions: "Sail Scoring" (brand), "sailscoring" (identifiers), "SailScoring" (PascalCase only)
  - `docs/design/data-model.md` - Core entities: Event, Fleet, Competitor, Race, Result, Series Result
  - `docs/design/libscoring-api.md` - API design for libscoring (the pure scoring engine)
  - `docs/requirements/glossary.md` - Defined sailing/scoring terminology; important domain context for understanding requirements and data model
  - `docs/requirements/iodai-use-case.md` - IODAI (Irish Optimist) use case: MVP target for position-based scratch scoring, mixed-division finish entry, large fleets
  - `docs/requirements/hyc-use-case.md` - HYC Autumn League use case: MVP target for time-based handicap scoring (IRC, HPH/NHC progressive), dual scoring from a single finish time
  - `docs/requirements/user-stories.md` - User requirements by domain area
- `reference/` - PDFs and notes from existing tools (Sailwave, ORC Scorer, HalSail, ZW). Contains lots of useful documents about comparable applications, and crucially the **Racing Rules of Sailing (RRS)** where **Appendix A governs Scoring**

## Domain Concepts

Key scoring concepts that any implementation must handle correctly:

- **Handicap systems:** IRC (fixed TCC), HPH/NHC (progressive, adjusted after each race), PY (Portsmouth Yardstick), one-design (scratch)
- **Corrected time:** `elapsed_time × TCC` for IRC/NHC; `elapsed_time × (1000 / PY)` for Portsmouth Yardstick
- **Dual scoring:** A single finish time scored under multiple handicap systems (e.g. IRC + HPH), each producing independent series standings
- **Low Point scoring:** 1st = 1 point, 2nd = 2 points, etc. (lower is better)
- **Result codes:** DNS, DNF, DSQ, OCS, UFD, BFD, RET, DNC (scored as entries + 1); RDG and SCP are variable
- **Discards:** Worst race(s) dropped from series total; net_points = total_points minus discards
- **Tie-breaking:** Per RRS Appendix A procedures

## Repository and Licensing

- **GitHub:** `github.com/sailscoring/sailscoring` (private; org is `sailscoring`)
- **Git:** Direct commits to `main` are fine; no PR requirement; SSH remote
- **License:** All rights reserved, copyright Mark McLoughlin — deliberately deferred pending open-source vs. commercial decision. See `LICENSE` and `docs/goals.md`. This constraint should inform dependency choices: avoid copyleft (GPL) libraries that would limit future licensing options; prefer MIT, Apache 2.0, or BSD.

## Issues Workflow

**Ideas:** Long-term possibilities and areas of exploration that may or may not be pursued. Capture as a GitHub issue with the `idea` label. Keep the issue brief — just enough to remember the thought. The **Definition of Done** for an `idea` issue is a design document drafted under `docs/` that covers the topic; close the issue once that document exists.

Before creating a new idea issue, check for overlap with existing ones: `gh issue list --label idea --repo sailscoring/sailscoring`

To create an idea issue: `gh issue create --label idea --title "..." --body "..."`

**Features:** In-scope work that relates to the current codebase and will almost certainly be implemented. Capture as a GitHub issue with the `feature` label. Keep the issue brief — just enough to describe what needs building.

To create a feature issue: `gh issue create --label feature --title "..." --body "..."`

**Bugs:** When a bug is identified, capture it as a GitHub issue with the `bug` label. Keep the issue brief — just enough to reproduce the problem.

To create a bug issue: `gh issue create --label bug --title "..." --body "..."`

## Feature Checklist

When implementing any new user-facing feature, ensure the following are covered before considering it done:

- **Keyboard shortcut** — if the feature is a page-level action (add, import, export, etc.), add a shortcut via `useGlobalKeyDown` in the relevant page, register it in `components/keyboard-help.tsx` under the appropriate section, and document it in `app/help/page.tsx` if that page covers the area.
- **Help documentation** — update `app/help/page.tsx` if the feature introduces a workflow or concept that a new scorer would need guidance on.
- **Unit tests** — if the feature includes pure logic (calculations, parsers, validators), add Vitest tests in `tests/`. E2e covers workflows; unit tests cover correctness of the underlying functions.
- **E2E test** — add a Playwright test in `e2e/` covering the happy path. Console errors and page errors fail tests automatically (see `e2e/` setup).
- **Series file format** — if the feature adds new persistent fields to any type in `lib/types.ts`, update the serialization in `lib/series-file.ts` and consider whether the format version needs bumping. Omitting this causes silent data loss on file round-trips.

## Tone and Humour

The project aims to be credible and serious — scorers are exacting people — but a little wry humour is welcome. The bar is: the name or term must do real communicative work, and the nautical connection must be genuine, not forced. Examples that hit the mark:

- **bilge** — the results publishing service; bilge is dirty water you pump out before the real plumbing is installed. Signals temporary and throwaway without a word of explanation.
- **the bilge pump** — the migration script inside the bilge repo that drains it when the full-stack arrives. The joke completes itself.
- **the log** — the audit trail of scorer changes. A ship's log and a software log are the same thing.

The pattern: a structural name (a tool, a module, a section heading), not inline prose. If a sailor wouldn't immediately recognise the term as correct, it's too cute.

## ADR Process

New architectural decisions should follow the template at `docs/design/decisions/000-template.md`. Existing ADRs:
- ADR-001: Database choice (Accepted — IndexedDB via Dexie.js)
- ADR-002: Scoring algorithm approach (Accepted — hybrid: hard-coded algorithms with configurable parameters)
- ADR-003: Application architecture (Accepted — local-first web app for MVP, full-stack later)
- ADR-004: Results publishing (Accepted — separate **bilge** service, `github.com/sailscoring/bilge`)
- ADR-005: Hosting and domain structure (Accepted — `sailscoring.ie` marketing, `app.sailscoring.ie` app, `bilge.sailscoring.ie` bilge API)
- ADR-006: Testing and debug logging (Accepted — Vitest for unit/integration, Playwright for e2e; no DB mocking; debug logs gated behind `DEBUG` env var)
