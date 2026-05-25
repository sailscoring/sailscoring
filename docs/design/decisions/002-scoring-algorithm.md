# ADR-002: Scoring Algorithm Implementation

**Status:** Accepted

**Date:** 2026-02-16

**Deciders:** Mark McLoughlin

## Context

Sail racing has multiple scoring systems defined by World Sailing and various national authorities. The application must correctly implement these algorithms to produce accurate results. This decision covers how we implement and structure the scoring logic.

Per [ADR-003](003-application-architecture.md), the scoring engine is a pure TypeScript module (`lib/scoring/`) with zero dependencies on framework, database, or UI. It takes domain objects as input and returns domain objects as output.

## Decision Drivers

- Correctness — must match official scoring rules (RRS Appendix A)
- Testability — scoring edge cases must be verifiable with plain objects
- Extensibility — new scoring systems may be needed (e.g. PY, PHRF)
- Maintainability — rules change periodically (World Sailing updates)
- Transparency — users should understand how scores are calculated
- Portability — scoring logic must survive the transition from local-first to full-stack unchanged

## Key Scoring Concepts to Support

Reference: [Glossary](../../requirements/glossary.md), [Data Model](../data-model.md)

### Low Point Scoring System (RRS Appendix A)

- Position-based points (1st = 1 point, 2nd = 2 points, etc.)
- Non-finisher codes scored as entries + 1
- Discard rules (throw out worst races)
- Tie-breaking procedures (Appendix A8)

### Handicap Corrections

- Scratch (one-design): no correction, position-based
- IRC: corrected_time = elapsed_time x TCC (fixed per series)
- NHC: corrected_time = elapsed_time x NHC number (progressive, adjusted after each race)

### Special Cases

- Average points for redress (RDG)
- Scoring penalties (SCP)
- Multiple scoring systems per fleet (dual scoring)

## Considered Options

### Option 1: Hard-coded algorithms

Implement each scoring system directly in code as distinct functions.

**Pros:**
- Simple to understand and debug
- Fast execution
- Easy to test specific systems
- Each algorithm is self-contained and readable

**Cons:**
- Code changes required for rule changes
- May lead to duplication between similar systems
- Less flexible for unusual club variations

### Option 2: Rule-based/configurable engine

Define scoring rules in configuration data; a generic engine interprets rules at runtime.

**Pros:**
- Flexible for variations
- Rules can be adjusted without code changes
- Potential for user-defined scoring systems

**Cons:**
- Significantly more complex to implement and debug
- Configuration errors can produce silently wrong results
- Rule language design is a project in itself
- Over-engineered for MVP — the number of scoring systems is small and well-defined

### Option 3: Hybrid — hard-coded core with configurable parameters

Core scoring algorithms are implemented directly in code. Variation between
systems is handled through parameters (rating type, points allocation,
discard profile) rather than a generic rule engine.

**Pros:**
- Balance of simplicity and flexibility
- Most real-world variations are parameter differences, not algorithm differences
- Clear extension points for new scoring systems
- Easy to test — each algorithm has known inputs and outputs
- Configuration is limited to well-defined parameters, reducing error risk

**Cons:**
- Truly novel scoring systems still require code changes
- Must design the parameterization carefully to avoid a leaky abstraction

## Decision

**Option 3: Hybrid approach — hard-coded algorithms with configurable parameters.**

The scoring engine is structured as pure functions organized by responsibility:

```
lib/scoring/
  elapsed.ts      — finish_time - start_time
  corrected.ts    — elapsed_time x rating (per handicap system)
  ranking.ts      — order results within a fleet for a single race
  points.ts       — assign points from rank + handle result codes
  discards.ts     — apply discard profile to select worst races
  series.ts       — calculate net points and series standings
  tiebreak.ts     — Appendix A8 tie-breaking procedures
  types.ts         — input/output types for scoring functions
```

Each module is a set of pure functions. No classes, no state, no
dependencies on Dexie, React, or Next.js. The functions compose into a
scoring pipeline:

```
Finishes + Starts + Ratings
  → elapsed times
  → corrected times (if handicap)
  → ranking per race
  → points per race
  → series totals
  → discards applied
  → tie-breaking
  → final standings
```

Configurable parameters include:
- Scoring system (scratch, IRC, NHC) — determines which correction formula to apply
- Points allocation — low point (default per RRS), potentially others later
- Discard profile — how many discards at what race count thresholds
- Result code points — entries + 1 (default), or custom values for RDG/SCP

New scoring systems (e.g. PY, PHRF) are added by implementing a new
correction function and registering it. The rest of the pipeline
(ranking, points, discards, tie-breaking) is shared.

## Consequences

### Positive

- Scoring logic is independently testable with plain objects — no database or framework needed
- Each stage of the scoring pipeline can be tested in isolation
- Survives the local-first to full-stack transition with zero changes
- New handicap systems require only a new correction function
- Easy to validate against known-correct results from real events

### Negative

- Unusual scoring variations not expressible as parameters will require code changes
- The pipeline structure imposes a specific execution order that may not suit all edge cases

### Risks

- **Incorrect implementation producing wrong results.** Mitigation:
  extensive test suite using known-correct results from real events (IODAI
  championships, HYC Autumn League). Test against Sailwave output for the
  same input data.
- **Appendix A tie-breaking is complex.** Mitigation: implement
  incrementally — basic tie-breaking for MVP, full Appendix A8 compliance
  in a later iteration if needed.

## Related Decisions

- [ADR-001: Database Choice](001-database-choice.md) — scoring logic does
  not depend on the database, but results are persisted via the repository
  layer
- [ADR-003: Application Architecture](003-application-architecture.md) —
  defines the pure TypeScript module approach and repository pattern

## References

- World Sailing Racing Rules of Sailing, Appendix A
- [Data Model — Scoring Systems](../data-model.md#scoring-systems)
- [Data Model — Calculated Fields](../data-model.md#calculated-fields)
