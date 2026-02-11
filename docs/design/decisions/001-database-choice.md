# ADR-001: Database Choice

**Status:** Proposed

**Date:** _TBD_

**Deciders:** _TBD_

## Context

The sail scoring application needs to persist event data, competitor information, race results, and calculated scores. The database choice will affect deployment options, offline capability, performance, and development complexity.

## Decision Drivers

- Offline capability requirements (see [Constraints](../../requirements/constraints.md))
- Deployment simplicity
- Query complexity for scoring calculations
- Data volume expectations
- Team familiarity
- Licensing/cost

## Considered Options

### Option 1: SQLite

Embedded relational database, single file.

**Pros:**
- Zero configuration, no server required
- Excellent offline support
- Single file backup/portability
- Sufficient for expected data volumes
- SQL query capability for scoring

**Cons:**
- Limited concurrent write access
- Not suitable for multi-user server deployment
- No built-in replication

### Option 2: PostgreSQL

Full-featured relational database server.

**Pros:**
- Robust, battle-tested
- Excellent SQL support
- Good for multi-user scenarios
- Rich ecosystem

**Cons:**
- Requires server infrastructure
- More complex deployment
- Offline support requires additional architecture

### Option 3: Browser IndexedDB / LocalStorage

Client-side browser storage.

**Pros:**
- No backend required
- Works offline by default
- Simple deployment (static hosting)

**Cons:**
- Limited query capability
- Storage limits
- Data tied to browser/device
- No cross-device sync without additional services

### Option 4: _TBD_

_Add other options considered._

## Decision

_TBD: State the decision after discussion._

## Consequences

### Positive

- _TBD_

### Negative

- _TBD_

### Risks

- _TBD_

## Related Decisions

- Architecture decisions will depend on this choice

## References

- _TBD_
