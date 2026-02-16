# ADR-001: Database Choice

**Status:** Accepted

**Date:** 2026-02-16

**Deciders:** Mark McLoughlin

## Context

The sail scoring application needs to persist event data, competitor information, race results, and calculated scores. The database choice will affect deployment options, offline capability, performance, and development complexity.

Per [ADR-003](003-application-architecture.md), the application follows a local-first MVP strategy with a planned transition to full-stack later. This means the database choice has two phases: MVP storage and future server-side storage.

## Decision Drivers

- Offline capability — must work at sailing venues with no internet
- Deployment simplicity — MVP should require no server infrastructure
- Query complexity for scoring calculations — scoring logic runs in TypeScript, not in database queries
- Data volume expectations — small (dozens of competitors, handful of races per series)
- Transition path — MVP storage choice should not prevent migration to server-side database later
- Cost — free for MVP

## Considered Options

### Option 1: SQLite (server-side)

Embedded relational database, single file.

**Pros:**
- Zero configuration, no server required
- Single file backup/portability
- Sufficient for expected data volumes
- Full SQL query capability

**Cons:**
- Requires a server process to host
- Limited concurrent write access
- No built-in replication
- Does not address the offline requirement

### Option 2: PostgreSQL

Full-featured relational database server.

**Pros:**
- Robust, battle-tested
- Excellent SQL support
- Good for multi-user scenarios
- Rich ecosystem (Neon, Supabase for managed hosting)

**Cons:**
- Requires server infrastructure and ongoing cost
- More complex deployment
- Offline support requires additional architecture
- Over-engineered for MVP data volumes

### Option 3: Browser IndexedDB via Dexie.js

Client-side browser storage wrapped with Dexie.js, a mature Promise-based API over IndexedDB.

**Pros:**
- No backend required — works offline by default
- Dexie provides clean query API and reactive queries (`liveQuery()`)
- Zero hosting cost
- Data stays with the user — no privacy/GDPR concerns for MVP
- Mature library with large community

**Cons:**
- No SQL — joins and aggregates happen in application code
- Data tied to one browser on one device
- No cross-device sync without additional services
- Browser may evict storage (especially iOS Safari)
- Schema migrations are manual (via Dexie's versioning API)

### Option 4: SQLite in browser via WASM (sql.js / wa-sqlite)

SQLite compiled to WebAssembly, running in the browser.

**Pros:**
- Full SQL capability in the browser
- Offline by default
- Can export/import database files

**Cons:**
- WASM blob adds loading overhead
- Tooling is less mature than Dexie/IndexedDB
- Additional complexity layer for uncertain benefit
- Scoring logic runs in TypeScript regardless, so SQL queries add little value

## Decision

**MVP: Option 3 — Browser IndexedDB via Dexie.js.**

The scoring engine is pure TypeScript functions that operate on domain
objects, not SQL queries. This means the database layer is primarily a
persistence store, not a query engine. Dexie.js provides a clean API for
storing and retrieving domain objects, with reactive queries that integrate
well with React.

**Future full-stack phase: Option 2 — PostgreSQL** (likely via Neon or
similar managed service, accessed through Drizzle ORM).

The transition is enabled by the repository pattern defined in
[ADR-003](003-application-architecture.md). Components access data through
repository interfaces. The MVP implements these with Dexie; the full-stack
version swaps in Drizzle/PostgreSQL implementations.

## Consequences

### Positive

- Offline storage from day one with zero infrastructure
- Dexie's `liveQuery()` provides reactive UI updates when data changes
- No server cost for MVP
- Data portability via JSON export/import
- Clean migration path to PostgreSQL via repository pattern

### Negative

- No cross-device access for MVP — data lives in one browser
- Must implement JSON export/import for backup and data portability
- Schema migrations handled through Dexie's versioning, which is less
  powerful than tools like Alembic or Drizzle Kit

### Risks

- **iOS Safari storage eviction:** Safari may purge IndexedDB data if the
  PWA is unused for several weeks. Mitigation: prominent backup/export
  feature, clear user guidance.
- **Repository abstraction leakage:** Dexie and Drizzle have different query
  patterns. Mitigation: keep repository interfaces domain-focused and
  simple.

## Related Decisions

- [ADR-003: Application Architecture](003-application-architecture.md) —
  defines the local-first MVP strategy that drives this decision

## References

- [Dexie.js documentation](https://dexie.org/)
- [Dexie.js liveQuery](https://dexie.org/docs/liveQuery())
- [Neon — Serverless PostgreSQL](https://neon.tech/)
- [Drizzle ORM](https://orm.drizzle.team/)
