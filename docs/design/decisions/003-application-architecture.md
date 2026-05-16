# ADR-003: Application Architecture — Local-First MVP, Full-Stack Later

**Status:** Superseded by [ADR-008](008-full-stack-transition.md)

**Date:** 2026-02-16

**Deciders:** Mark McLoughlin

> **Supersedure note.** The local-first MVP described here ran from launch
> through the ADR-008 Phase 8 cutover. After cutover the Dexie/IndexedDB
> layer, the `USE_SERVER_DATA` flag, and the static-export build mode were
> removed; the application now runs as full-stack Next.js on Vercel Fluid
> Compute backed by Neon Postgres + Better Auth. ADR-008's "Future
> Decisions Pre-resolved" choices (Auth.js, Drizzle, Resend) were the
> starting point; the only deviation is Better Auth in place of Auth.js,
> documented in ADR-008. The architecture principles below — repository
> pattern, shared domain types, pure scoring engine — all survived the
> transition as designed.

## Context

Sail Scoring needs an application architecture that supports the MVP goal of
scoring club racing series. The architecture must account for two realities:

1. **Sailing venues often have poor or no internet connectivity.** Scorers
   need to enter results and calculate standings on race day regardless of
   network conditions.

2. **The MVP should validate the product before investing in server
   infrastructure.** Multi-user features, authentication, payments, and
   cloud storage are not needed yet but are expected in the future.

The previous iteration of this project used a traditional client-server
architecture (Python/Flask + React + PostgreSQL on Render). This worked but
required server infrastructure from day one and had no offline capability.

## Decision Drivers

- Offline-first: must work at sailing venues with no internet
- Fast to build: minimize infrastructure and tooling for MVP
- Low cost: free or near-free to host
- Transition path: avoid a rewrite when adding server-side features later
- AI-assisted development: the stack should be well-supported by AI coding tools (large training corpus, strong type system)

## Considered Options

### Option 1: Local-first web app (IndexedDB, no backend)

The app runs entirely in the browser. Data is stored in IndexedDB. No server
is needed. Deployed as a static site. A Progressive Web App (PWA) service
worker caches the app shell for fully offline use.

**Pros:**
- Works offline by default — both app and data are local
- Zero server cost — static hosting is free (Vercel, Cloudflare Pages, GitHub Pages)
- Simple infrastructure — no backend, no database server, no auth
- Fast development — no API layer to build and maintain for MVP
- Data stays with the user — no privacy/GDPR concerns for MVP

**Cons:**
- Data is trapped in one browser on one device
- No sharing, collaboration, or multi-device access without manual export/import
- IndexedDB storage can be evicted by the browser (especially iOS Safari)
- No server-side logic — all computation happens in the client

### Option 2: Full-stack from day one (Next.js + PostgreSQL)

Traditional client-server architecture using Next.js with server-side
rendering, API routes, and a PostgreSQL database.

**Pros:**
- Data is centralized and accessible from any device
- Multi-user ready from the start
- Robust data persistence — no browser storage eviction risk
- Familiar pattern with extensive tooling

**Cons:**
- Requires server infrastructure and ongoing hosting cost
- No offline capability without significant additional work
- More complex to develop — API layer, auth, database migrations
- Over-engineered for a single-scorer MVP

### Option 3: Python + HTMX (server-rendered, minimal JavaScript)

Server-rendered HTML with HTMX for interactivity. Flask or Django backend,
SQLite on the server, minimal client-side JavaScript.

**Pros:**
- Extremely simple — no JavaScript build step, no SPA complexity
- Python familiarity for the developer
- Low overhead for forms-and-tables UI

**Cons:**
- Server-dependent — no offline capability
- Limited interactivity for features like live-updating standings or drag-to-reorder
- HTMX ecosystem is smaller — fewer component libraries and patterns
- Would require a rewrite to transition to a richer frontend later

## Decision

**Option 1: Local-first web app for MVP**, with the technology choices and
architecture designed to make the transition to a full-stack application
(Option 2) a migration rather than a rewrite.

### Technology choices

| Layer | MVP Choice | Rationale |
|-------|------------|-----------|
| Framework | **Next.js** (App Router, static export) | Same framework pre- and post-transition. Large ecosystem, AI-friendly |
| Language | **TypeScript** | Shared types across UI, data layer, and scoring engine. Strong type safety |
| Storage | **Dexie.js** (IndexedDB) | Clean Promise-based API, reactive queries via `liveQuery()`, mature and well-documented |
| UI Components | **shadcn/ui** (Radix + Tailwind) | Components owned in the codebase, not a dependency. Natural fit with Next.js/Vercel ecosystem |
| Styling | **Tailwind CSS** | Utility-first, consistent with shadcn/ui |
| Scoring Engine | **Pure TypeScript module** (`lib/scoring/`) | Zero dependencies on framework or storage. Testable with plain objects |
| Testing | **Vitest** | Fast, TypeScript-native |
| PWA | **Yes** (`@serwist/next` or similar) | Caches app shell for offline access. Low implementation cost, high value for sailing venues |
| Hosting | **Vercel** (static export) | Free tier, zero server management. Flip to server mode later |
| Data Portability | **JSON export/import** | Backup, device transfer, and future migration path |

### Architecture principles

**Repository pattern for data access.** Components and the scoring engine
never access Dexie directly. All data flows through repository interfaces:

```
interface SeriesRepository {
  getSeries(id: string): Promise<Series>
  listSeries(): Promise<Series[]>
  createSeries(data: CreateSeriesInput): Promise<Series>
  ...
}
```

The MVP implements these with Dexie. The full-stack version swaps in API
client or Drizzle ORM implementations. No component code changes.

**Shared domain types.** All entities are defined once in `lib/types.ts` and
used by every layer — UI, repositories, scoring engine.

**Pure scoring engine.** The scoring module in `lib/scoring/` takes domain
objects as input and returns domain objects as output. No database, no
framework, no side effects. This is the core intellectual property of the
application and must be heavily tested and fully portable.

### Transition plan

When the product is validated and multi-user or cloud features are needed:

| Layer | MVP (local-first) | Full-stack (later) | Change required |
|-------|-------------------|-------------------|-----------------|
| Framework | Next.js (static export) | Next.js (server mode) | Reconfigure build |
| UI Components | React + shadcn/ui | React + shadcn/ui | None |
| Scoring Engine | `lib/scoring/` | `lib/scoring/` | None |
| Domain Types | `lib/types.ts` | `lib/types.ts` | None |
| Data Access | Dexie repositories | Drizzle/Postgres repositories | Swap implementation |
| API Layer | None | Next.js API routes / server actions | Add |
| Auth | None | Auth.js (NextAuth v5) | Add |
| Database | IndexedDB (browser) | PostgreSQL (Neon) | Add |
| Hosting | Vercel (static) | Vercel (full-stack) | Reconfigure |
| Email | None | Resend | Add |
| Payments | None | Stripe | Add |

Estimated ~70-80% of codebase survives the transition unchanged. The
migration is: add server infrastructure, write Postgres repository
implementations, add auth, swap the data provider.

**Data migration:** Users export their local data as JSON and import it into
their server account. The JSON export/import feature built for MVP data
portability doubles as the migration tool.

## Consequences

### Positive

- Offline capability from day one — matches the core use case
- Zero hosting cost for MVP
- Fast development — no API layer, auth, or database infrastructure to build
- Product can be validated before committing to server infrastructure
- Transition path is well-defined — no framework or language changes required
- Scoring engine is fully portable and independently testable

### Negative

- MVP data is isolated to a single browser — no sharing or multi-device access
- Must build JSON export/import to mitigate data loss risk
- IndexedDB has no migration tooling comparable to Alembic or Drizzle Kit — schema changes need manual handling through Dexie's versioning
- PWA and service worker caching adds minor development complexity

### Risks

- **iOS Safari storage eviction:** Safari may purge IndexedDB data if the
  PWA is unused for several weeks. Mitigation: prominent "Export Backup"
  feature in the UI, clear messaging to users about saving backups after
  each race day.

- **Repository abstraction may not fit cleanly:** The Dexie and
  Drizzle/Postgres query patterns are different enough that the repository
  interface could become awkward. Mitigation: keep the interface simple and
  domain-focused (not database-shaped). Accept that implementations may
  diverge internally as long as the contract holds.

- **Next.js static export limitations:** Some Next.js features (middleware,
  API routes, server components with data fetching) are unavailable in
  static export mode. Mitigation: the MVP is a client-side app that doesn't
  need these features. They become available when transitioning to server
  mode.

## Future Decisions Pre-resolved

Some full-stack technology choices are noted here to avoid relitigating them
later, even though they are not needed for MVP.

### Authentication: Auth.js (NextAuth v5), not Clerk or Auth0

When the full-stack phase adds user accounts, authentication should be
implemented with **Auth.js (NextAuth v5)** rather than a SaaS auth provider
such as Clerk or Auth0.

Rationale:
- Auth.js runs inside the Next.js app — no external service dependency
- Sessions are stored in the existing Postgres database via a Drizzle adapter
- The app can be run fully locally during development without any internet
  connection or third-party accounts
- Auth requirements are simple (email magic link, optionally Google OAuth) —
  no need for a provider's advanced features
- Keeps the dependency count low — Resend (already planned) handles the
  magic link emails

Clerk and Auth0 are rejected because all auth flows pass through their
servers, making local development dependent on a live external service and
introducing vendor lock-in.

A dedicated ADR should be written for auth when the full-stack phase begins.

### External API access: a post-MVP goal

A public or partner-facing API is a deliberate post-MVP goal. The intent is
to allow third-party developers to experiment with applications that integrate
with Sail Scoring — for example, a mobile finish-recording app that lets a
finish-line official log boat finishes in real time, potentially using voice
recognition or scanning.

**Why this is not possible in the MVP.** The local-first architecture has no
server. Data lives in IndexedDB in a single browser session. There is nothing
for an external application to connect to.

**Why the transition plan provides for it without a rewrite.** The
architectural decisions made for MVP were chosen precisely to make this
transition low-cost:

- **Repository pattern.** The `SeriesRepository` and related interfaces are
  exactly what API route handlers will call. The abstraction already exists.
  A server-side implementation backed by Postgres (the planned full-stack
  transition) is all that is needed to expose data to external clients.
- **Pure scoring engine.** `lib/scoring/` takes plain objects in and returns
  plain objects out. It has no dependency on storage or framework. Exposing
  scoring calculations via an API endpoint is straightforward.
- **Shared TypeScript types.** `lib/types.ts` serves directly as the
  canonical shape of API request and response bodies, and could be used to
  generate a typed SDK for third-party clients.
- **Next.js is already the framework.** API routes are a first-class feature.
  The only change needed to enable them is switching from static export to
  server mode — a build configuration change, not a code change.

**What the finish-recording mobile app use case requires.** A finish-line app
is a thin write client: it needs to POST finish times as boats cross the line.
It does not need to implement scoring, series management, or standings — all
of that remains in the main application. This is a good fit for a simple,
independently-maintained app that consumes the API.

**Authentication for third-party clients.** API keys or OAuth 2.0 tokens will
be needed for external clients. This is a separate decision, deferred to the
full-stack phase. Auth.js supports this. A dedicated ADR should be written
when the API is scoped.

## Related Decisions

- [ADR-001: Database Choice](001-database-choice.md) — this decision
  effectively resolves ADR-001 for MVP: IndexedDB via Dexie.js, with
  PostgreSQL planned for the full-stack phase.
- [ADR-002: Scoring Algorithm Implementation](002-scoring-algorithm.md) —
  the pure TypeScript scoring engine described here is compatible with any
  ADR-002 outcome.

## References

- [Dexie.js documentation](https://dexie.org/)
- [shadcn/ui documentation](https://ui.shadcn.com/)
- [Next.js Static Exports](https://nextjs.org/docs/app/building-your-application/deploying/static-exports)
- [@serwist/next (PWA for Next.js)](https://serwist.pages.dev/)
