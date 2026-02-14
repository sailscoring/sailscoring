# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Sailscoring is a sail racing scoring application for managing regattas, series, and race days. It handles handicap corrections, result codes, discard rules, and series standings per World Sailing Racing Rules of Sailing (RRS) Appendix A.

**Current status:** Documentation and planning phase. No implementation code yet. Technology stack decisions (database, frontend, backend) are pending as ADRs in `docs/design/decisions/`.

## Repository Structure

- `docs/` - Living project documentation (requirements, design, planning)
  - `docs/design/decisions/` - Architecture Decision Records (ADRs)
  - `docs/design/data-model.md` - Core entities: Event, Fleet, Competitor, Race, Result, Series Result
  - `docs/requirements/glossary.md` - Defined sailing/scoring terminology; important domain context for understanding requirements and data model
  - `docs/requirements/user-stories.md` - User requirements by domain area
  - `docs/planning/` - MVP scope, iterations, backlog
- `reference/` - PDFs and notes from existing tools (Sailwave, ORC Scorer, HalSail, ZW). Contains lots of useful documents about comparable applications, and crucially the **Racing Rules of Sailing (RRS)** where **Appendix A governs Scoring**

## Domain Concepts

Key scoring concepts that any implementation must handle correctly:

- **Handicap systems:** PY (Portsmouth Yardstick), IRC, PHRF, one-design (none)
- **Corrected time:** `elapsed_time * (1000 / PY)` for Portsmouth Yardstick
- **Low Point scoring:** 1st = 1 point, 2nd = 2 points, etc. (lower is better)
- **Result codes:** DNS, DNF, DSQ, OCS, UFD, BFD, RET, DNC (scored as entries + 1); RDG and SCP are variable
- **Discards:** Worst race(s) dropped from series total; net_points = total_points minus discards
- **Tie-breaking:** Per RRS Appendix A procedures

## ADR Process

New architectural decisions should follow the template at `docs/design/decisions/000-template.md`. Existing ADRs:
- ADR-001: Database choice (Proposed - SQLite vs PostgreSQL vs IndexedDB)
- ADR-002: Scoring algorithm approach (Proposed - hard-coded vs configurable vs hybrid)
