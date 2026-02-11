# ADR-002: Scoring Algorithm Implementation

**Status:** Proposed

**Date:** _TBD_

**Deciders:** _TBD_

## Context

Sail racing has multiple scoring systems defined by World Sailing and various national authorities. The application must correctly implement these algorithms to produce accurate results. This decision covers how we implement and structure the scoring logic.

## Decision Drivers

- Correctness (must match official scoring rules)
- Testability (scoring edge cases must be verifiable)
- Extensibility (new scoring systems may be needed)
- Maintainability (rules change periodically)
- Transparency (users should understand how scores are calculated)

## Key Scoring Concepts to Support

Reference: [Glossary](../../requirements/glossary.md)

### Low Point Scoring System (RRS Appendix A)

- Position-based points (1st = 1 point, 2nd = 2 points, etc.)
- Non-finisher codes scored as entries + 1
- Discard rules (throw out worst races)
- Tie-breaking procedures

### Handicap Corrections

- Portsmouth Yardstick: corrected_time = elapsed_time × (1000 / PY)
- IRC/PHRF: various formulas
- Time-on-time vs time-on-distance

### Special Cases

- Average points for redress (RDG)
- Scoring penalties (SCP)
- Multiple divisions/fleets
- Split starts

## Considered Options

### Option 1: Hard-coded algorithms

Implement each scoring system directly in code.

**Pros:**
- Simple to understand
- Fast execution
- Easy to test specific systems

**Cons:**
- Code changes required for rule changes
- May lead to duplication
- Less flexible for unusual variations

### Option 2: Rule-based/configurable engine

Define scoring rules in configuration; engine interprets rules.

**Pros:**
- Flexible for variations
- Rules can be adjusted without code changes
- Potential for user-defined systems

**Cons:**
- More complex to implement
- Harder to debug
- Risk of configuration errors

### Option 3: Hybrid approach

Core algorithms hard-coded, with configurable parameters.

**Pros:**
- Balance of simplicity and flexibility
- Most variations are parameter differences
- Unusual cases can extend base algorithms

**Cons:**
- Must design extension points carefully
- Some complexity in abstraction

## Decision

_TBD: State the decision after discussion._

## Consequences

### Positive

- _TBD_

### Negative

- _TBD_

### Risks

- Incorrect implementation could produce wrong results
- Mitigation: extensive test suite with known-correct results

## Related Decisions

- [ADR-001: Database Choice](001-database-choice.md) — affects how results are queried

## References

- World Sailing Racing Rules of Sailing, Appendix A
- Portsmouth Yardstick documentation
- _Add specific rule references_
