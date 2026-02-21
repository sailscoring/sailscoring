# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Sailscoring is a sail racing scoring application for managing regattas, series, and race days. It handles handicap corrections, result codes, discard rules, and series standings per World Sailing Racing Rules of Sailing (RRS) Appendix A.

**Current status:** Documentation and planning phase. No implementation code yet. Technology stack decisions (database, frontend, backend) are pending as ADRs in `docs/design/decisions/`.

## Repository Structure

- `docs/` - Living project documentation (requirements, design, planning)
  - `docs/design/decisions/` - Architecture Decision Records (ADRs)
  - `docs/design/naming.md` - Project naming conventions: "Sail Scoring" (brand), "sailscoring" (identifiers), "SailScoring" (PascalCase only)
  - `docs/design/data-model.md` - Core entities: Event, Fleet, Competitor, Race, Result, Series Result
  - `docs/requirements/glossary.md` - Defined sailing/scoring terminology; important domain context for understanding requirements and data model
  - `docs/requirements/iodai-use-case.md` - IODAI (Irish Optimist) use case: MVP target for position-based scratch scoring, mixed-division finish entry, large fleets
  - `docs/requirements/hyc-use-case.md` - HYC Autumn League use case: MVP target for time-based handicap scoring (IRC, HPH/NHC progressive), dual scoring from a single finish time
  - `docs/requirements/user-stories.md` - User requirements by domain area
  - `docs/planning/` - MVP scope, iterations, backlog
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

## Ideas Workflow

When a new idea or area of exploration comes up, capture it as a GitHub issue with the `idea` label. Keep the issue brief — just enough to remember the thought. The **Definition of Done** for an `idea` issue is a design document drafted under `docs/` that covers the topic; close the issue once that document exists.

To create an idea issue: `gh issue create --label idea --title "..." --body "..."`

## ADR Process

New architectural decisions should follow the template at `docs/design/decisions/000-template.md`. Existing ADRs:
- ADR-001: Database choice (Proposed - SQLite vs PostgreSQL vs IndexedDB)
- ADR-002: Scoring algorithm approach (Proposed - hard-coded vs configurable vs hybrid)
