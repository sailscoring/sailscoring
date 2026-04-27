# ADR-008: Full-Stack Transition

**Status:** Proposed

**Date:** 2026-04-26

**Deciders:** Mark McLoughlin

## Context

ADR-003 chose a local-first MVP and described — at a high level — the path
to a full-stack application. Stealth beta has begun. HYC scorers are
reviewing historical events in the application and the friction of the
local-first model is already visible: data is trapped in one browser,
results are not visible to other scorers, and collaboration depends on
shared `.sailscoring` files. Live race-day scoring on the current
architecture has not yet been attempted.

This ADR treats the full-stack transition as **inevitable rather than
speculative**. The question is no longer *if* but *what shape*, *when*, and
*how*. ADR-003 deliberately structured the codebase to make this a
migration: repository interfaces in `lib/repository.ts`, a pure scoring
engine, shared TypeScript types, and JSON export/import as the migration
format are all in place. The cost of acting now is mostly engineering work;
the cost of deferring is continued friction during the very period the
application is being validated.

## Goals

- Multi-device access for a single scorer
- Panel collaboration: multiple scorers editing a shared series
- Server-of-record persistence; no IndexedDB-eviction risk
- Replace `.sailscoring` file exchange as the primary collaboration mechanism
- A new in-app publishing path that replaces bilge, with bilge retired as
  ADR-004 always anticipated
- Smooth migration of existing local-first data into accounts

## Non-Goals

- **Offline-first editing.** Read-only offline access is acceptable if it
  falls out of the chosen stack; durable offline writes (sync engine,
  CRDTs) are explicitly out of scope.
- Mobile-native applications.
- Public API for third-party clients. Anticipated but a follow-up ADR.
- Custom per-club domains. Sub-paths under the app domain are sufficient
  initially.

## Decision Drivers

- ADR-003 pre-resolved several technology choices (Auth.js v5,
  Drizzle/Postgres, Resend); honour them unless we have a reason to
  deviate. Auth.js is one such deviation — see Stack below.
- Already on Next.js 16 + Vercel; minimise ecosystem disruption.
- Avoid sync-engine complexity unless its costs become justified.
- The scoring engine must remain pure and unaffected.

## Decision

Migrate Sail Scoring to a full-stack Next.js application on Vercel Fluid
Compute, backed by Neon Postgres via the Vercel Marketplace, with Better
Auth for authentication and a workspace-based collaboration model. The migration
preserves the repository pattern, the pure scoring engine, and the shared
type system. It replaces the storage layer, adds authentication and
authorization, replaces Dexie's reactive primitive in the UI, and replaces
bilge with an integrated publishing path; bilge is retired at the end of a
URL-redirect transition window, as ADR-004 always anticipated.

## Stack

| Layer | Choice | Note |
|-------|--------|------|
| Framework | Next.js 16 (App Router, server mode) | Same as today; flip from static export to Fluid Compute |
| Compute | Vercel Fluid Compute | Default runtime; Edge Functions explicitly avoided |
| Database | Neon Postgres (via Vercel Marketplace) | Ratifies ADR-003 |
| ORM | Drizzle | Ratifies ADR-003; first-class TypeScript |
| Auth | Better Auth with Drizzle adapter | Deviates from ADR-003's choice of Auth.js v5; see below |
| Email | Resend | Magic-link login + transactional |
| Reactivity | TanStack Query | Replaces Dexie's `useLiveQuery`; persistent cache provides natural read-only offline |
| Migration | Existing JSON export/import | Already the canonical interchange format |

## Data model changes

### Workspaces and membership

Introduce **workspaces** — a tenancy boundary covering a group of scorers
working together (e.g. HYC's panel). Every series belongs to exactly one
workspace. Every user has a personal workspace by default and may belong
to others.

The workspace model is implemented by Better Auth's **organizations**
plugin: users, organizations (= workspaces in our UI vocabulary),
memberships with roles (owner | admin | member), and invitations are
all provided. We use the plugin's default role set rather than custom
sailing-specific names — keeps us on the well-trodden path and avoids
fighting flows that hard-code role names. Series gain a `workspace_id`
foreign key referencing the plugin's organization table:

```
series          (id, workspace_id, ..., as today)
```

A solo scorer (IODAI use case) operates entirely in their personal
workspace and never sees the membership UI. A panel (HYC use case)
shares a single workspace; the panel lead is `owner`, other panel
members are `member` (or `admin` if they manage invitations).

"Workspace" is the user-facing term; "organization" is the underlying
plugin's term. Keeping the UI neutral avoids implying corporate
structure for a single sailor. Promoting workspaces to a richer "club"
concept (branding, billing, custom domains) is a future ADR.

### Tenancy enforcement

`workspace_id` on every series-scoped row enforces tenancy at the row
level. Authorization is a single workspace-membership check on the parent
series; scoring engine inputs are unchanged.

### Concurrency

Each mutable row gets a `version` integer (or `updated_at` timestamp).
Mutations include the expected version; mismatches return a 409 with the
current state. Last-write-wins is acceptable in practice — panels rarely
edit the same record simultaneously — but explicit detection avoids silent
overwrites.

Awareness ("Mark edited race 3 just now") is deferred. A later iteration
can add it via SSE or a Vercel Queues fan-out without changing the data
model.

## Authentication and accounts

- **Library:** **Better Auth** with the Drizzle adapter. Deviates from
  ADR-003's pre-resolved choice of Auth.js v5 because Auth.js has been
  in security-fixes-only maintenance mode through late 2024 / 2025,
  while Better Auth is actively developed and offers first-party
  plugins that match this ADR's needs unusually well:
  - **organizations** plugin → implements the workspaces model below
    (members, roles, invitations) without custom code.
  - **api-keys** plugin → covers the personal access token surface
    anticipated in *Public API forward-compatibility*.
  - **OIDC provider** plugin → replaces the "build OAuth provider on
    top of Auth.js" forward-compat note for third-party app sign-in.

  Tradeoff: Better Auth is younger and less battle-tested than Auth.js,
  and its plugin ecosystem is still evolving. The sustainability of
  both projects deserves scrutiny independently of this decision.
- **Login:** email magic link via Resend; optionally Google OAuth.
- **Sessions:** Postgres-backed via Better Auth's Drizzle adapter.
- **Auth enforcement.** Routing Middleware gates `/series/...` and
  `/settings` for UX (redirect-to-login). Authoritative auth checks live
  in route handlers and at the repository layer; middleware-only auth is
  the failure mode CVE-2025-29927 (March 2025) exploited and is
  explicitly avoided. `/public/...` and unauthenticated landing pages
  remain open.
- **Local development:** runs without external services aside from Resend
  (or a console-output dev provider) and Neon.

## Repository layer

The interfaces in `lib/repository.ts` survive unchanged. Implementations
are swapped:

- `lib/dexie-repository.ts` — retained briefly for the import flow only.
- `lib/postgres-repository.ts` — new, Drizzle-backed, server-only.
- `lib/api-repository.ts` — new, client-side wrapper that calls route
  handlers (preferred) or server actions for UI-only operations; the UI
  talks only to this. Calling route handlers wherever practical keeps the
  same surface available to a future public API — see Public API
  forward-compatibility below.

Direct `db.` imports in UI files (currently ~10 places — `app/page.tsx`,
`app/series/[id]/**`, `components/series-settings/*`,
`components/competitor-import.tsx`) are removed as part of the swap; the
repository pattern is enforced as an actual boundary, not a convention.

The pure scoring engine (`lib/scoring.ts`) is untouched.

## UI reactivity

`useLiveQuery` (Dexie's reactive primitive, used in ~10 components) is
replaced with **TanStack Query** hooks backed by server actions. Mutations
invalidate query keys explicitly; optimistic updates are added per mutation
where the UX warrants it.

TanStack Query's `persistQueryClient` against IndexedDB or localStorage
gives a **natural read-only offline posture** without committing to a sync
engine: cached series data remains visible while offline, writes fail with
a clear error. This is the "if it's natural" offline support called for in
this ADR's goals; it is not full offline editing.

## Publishing model

The full-stack app introduces an integrated publishing path that
**replaces bilge entirely**.

- A series in a workspace has a "Publish" action.
- Publishing renders the same HTML produced by `lib/results-renderer.ts`
  and serves it from the app at a stable URL — for example
  `app.sailscoring.ie/public/{workspace-slug}/{series-slug}`.
- Pages are generated on-demand and cached using Next.js 16 Cache
  Components (`use cache`, `cacheTag`); `updateTag` invalidates on each
  publish. Usage is isolated behind a thin internal helper (e.g.
  `lib/published-cache.ts`) so the cache-API surface is one file to
  revisit if it changes — see *Sustainability posture* below.
- Public URLs are read-only and unauthenticated.
- Visibility settings: **unlisted** (default; URL-only access) and
  **listed** (appears on the workspace's public index).

### bilge retirement

bilge was always a stopgap (ADR-004). Its retirement trigger fires when
this transition ships. Concretely:

1. The "Publish to bilge" action is removed from the app once the in-app
   publishing path ships. Subsequent publishes go through the new path
   only.
2. Existing bilge URLs stay reachable for a transition window. The series
   data already records `publishing.uuid` and `publishing.pages` (slug +
   URL) per ADR-004; on first publish through the new path, the app
   generates redirect mappings for those slugs. Implementation can be as
   light as overwriting each affected bilge slug's HTML with a
   meta-refresh + canonical link to the new app URL — no code change to
   bilge required.
3. After a defined transition window (e.g. 6 months from cutover), bilge
   is taken offline. Any remaining slugs return 410 Gone. The Vercel
   project, Blob storage, and KV are decommissioned.

## Public API forward-compatibility

A public API is out of scope for this transition (see Non-Goals), but the
horizon doc anticipates integrations that depend on one — a mobile
finish-recording app, live clubhouse displays, fetching ratings from
RYA/Irish Sailing, submitting results to handicap authorities. ADR-003
framed external API access as a post-MVP goal made possible precisely by
these architecture choices. This section records the shape the API will
likely take, so that day-one decisions in ADR-008 don't create later
friction.

### Implied shape

- **Versioned route handlers under `/api/v1/...`** serve the public
  API. Server actions remain internal to the app's own UI. The in-app
  data layer (`lib/api-repository.ts`) calls route handlers wherever
  practical, so the same surface serves both internal and external
  clients.
- **Token-based auth alongside Better Auth sessions.** Browser sessions
  use Better Auth as designed. External clients send `Authorization:
  Bearer <token>`. Two token kinds anticipated, both first-party Better
  Auth plugins rather than custom code:
  - **Personal access tokens** via the **api-keys** plugin —
    user-scoped, generated in account settings, optionally
    workspace-restricted, hashed at rest.
  - **OAuth 2.0** via the **OIDC provider** plugin — for third-party
    apps that sign users in via Sailscoring (e.g. a mobile
    finish-recording app).

  Both paths terminate at the same workspace-membership check the in-app
  code already uses.
- **Resource model = data model.** Workspaces, series, competitors,
  races, finishes, race starts. Public IDs are UUIDs; no
  database-internal identifiers leak.
- **Zod schemas at every route boundary,** doubling as the source for
  an OpenAPI document (e.g. via `@asteasolutions/zod-to-openapi`).
- **Pure scoring engine as a stateless endpoint.** `lib/scoring.ts`
  takes plain objects in, returns plain objects out. Exposing it as
  `POST /api/v1/score` is a small addition that makes the engine
  independently useful — supporting libscoring's goal of being a
  credible reference implementation of Appendix A.

### Choices worth making now

These cost little to get right during the transition and are expensive
to retrofit later:

| Choice | Why now |
|--------|---------|
| Zod (or equivalent) at every route boundary | Same schemas drive validation, types, and OpenAPI |
| `lib/api-repository.ts` calls route handlers, not server actions | Same surface, internal and external |
| UUID public identifiers throughout | No leaky internal IDs in URLs |
| Cursor-based pagination on list endpoints | Cheap to add up front; painful to retrofit |
| Idempotency-key header on write endpoints | Required for mobile / flaky-network clients |
| Authorization at the repository layer, keyed on workspace | One check, applies to both UI and API |

A dedicated public-API ADR will follow when a real third-party use case
(most likely the finish-recording app) is ready to exercise it. OAuth
provider details, webhooks, rate-limiting policies, and a typed SDK are
deferred to that ADR.

## Migration of local-first data

1. New users sign in and land on an empty workspace with an "Import from
   browser" wizard.
2. The wizard reads existing IndexedDB series via the retained Dexie
   repository, serialises each via the existing `lib/series-file.ts`, and
   POSTs them to a server import endpoint that writes to Postgres.
3. Local data is left in place; the wizard can be re-run.
4. After the user confirms, the local-first entry points are hidden behind
   a "Local archive" view.
5. After the beta period, local-first mode is removed.

The series file format already round-trips every persistent field. If it
doesn't, that's a CLAUDE.md violation and a bug — to be fixed in either
codebase.

## Rollout phasing

Phasing is for incremental verification, not a long parallel period.
Each phase produces a verifiable internal milestone. The
`USE_SERVER_DATA` feature flag (off by default until Phase 6) keeps
production users on the local-first build throughout Phases 1–5.

### Phase 1 — Foundation

**Goal.** Sign-in works against a Postgres database deployed on Vercel;
nothing in the existing app changes.

**Work.** Provision Neon via Vercel Marketplace. Provision Resend. Set
up Drizzle and Drizzle Kit, write the initial schema (users, sessions,
organizations, memberships, invitations, plus a `series.workspace_id`
placeholder). Wire Better Auth with the organizations plugin. Add
`/api/health` and a minimal `/account` page proving sign-in and session
round-tripping. Add the `USE_SERVER_DATA` feature flag, off by default.

**Exit criteria.** A developer can sign in via magic link, land in a
personal workspace, and the existing local-first app remains untouched.
CI runs the new auth/DB loop alongside the existing tests.

**Size.** ~1–2 weeks. **Rollback.** Drop the flag; no user-visible
change.

### Phase 2 — Postgres repositories and route handlers

**Goal.** The full data model is implemented server-side and reachable
via authenticated route handlers.

**Work.** Translate `lib/repository.ts` interfaces into
`lib/postgres-repository.ts` (Drizzle-backed, server-only). Build
`/api/v1/...` route handlers that wrap the repositories with
workspace-scoped authorization. Add Zod schemas at every handler
boundary. Build `lib/api-repository.ts` as the client-side wrapper that
calls the route handlers. UI not yet using it.

**Exit criteria.** API tests can sign in, create a series, add
competitors, enter finishes, and read standings — entirely server-side.
Authorization rejects cross-workspace access. The pure scoring engine
runs unchanged on server-shaped objects.

**Size.** ~2–3 weeks. **Rollback.** Code unused by production users;
revert the API repository if needed.

### Phase 3 — UI swap (Dexie → API)

**Goal.** The whole UI runs against the API behind the feature flag.

**Work.** Introduce TanStack Query. Refactor the ~10 UI files that
import `db` directly (`app/page.tsx`, `app/series/[id]/**`,
`components/series-settings/*`, `components/competitor-import.tsx`) to
use `lib/api-repository.ts`. Replace every `useLiveQuery` call with a
TanStack Query hook; mutations invalidate keys explicitly. Wire
`persistQueryClient` for read-only offline. Enforce the repository
boundary via a lint rule banning direct `db.` imports outside
`lib/dexie-repository.ts`.

**Exit criteria.** With `USE_SERVER_DATA=on`, the entire app works
end-to-end against Postgres in development; with it off, the existing
local-first app is unchanged. Side-by-side e2e runs in both modes.

**Size.** ~2 weeks. The largest UI-layer change of the transition.
**Rollback.** Flip the flag.

### Phase 4 — Collaboration and publishing

**Goal.** A panel of scorers can share a series; a series can be
published at a stable public URL.

**Work.** Workspace invitation flow (Better Auth invitations). Membership
management UI (add/remove, change role). Last-write-wins concurrency:
add `version` columns and surface 409s in the UI. New publishing path:
`/public/{workspace-slug}/{series-slug}` rendered from
`lib/results-renderer.ts` with Next.js Cache Components (`use cache` +
`cacheTag`); `updateTag` on publish. Replace the in-app "Publish to
bilge" action with the new publish action. Listed/unlisted visibility
toggle.

**Exit criteria.** Two test accounts in one workspace can both edit a
series and see each other's changes after a refresh. Publishing a series
produces a public URL that updates within seconds of the next publish
action.

**Size.** ~2 weeks. **Rollback.** Disable the publish UI; collaboration
is harder to roll back, so test thoroughly before this phase ships.

### Phase 5 — Migration UX

**Goal.** Existing beta users can move their local data into a workspace
without losing anything.

**Work.** "Import from browser" wizard reads IndexedDB via the retained
Dexie repository, serialises each series via `lib/series-file.ts`, POSTs
to a new `/api/v1/import` endpoint that writes via the Postgres
repositories. Idempotent re-runs. "Local archive" view for series
already imported. On the first publish of a migrated series, write
redirect HTML to its existing bilge slugs (meta-refresh + canonical
link) — no code change in bilge required. Validate with at least one
HYC beta user on a real historical series.

**Exit criteria.** A beta user with existing local data can sign up,
import, and continue working with full fidelity. Old bilge URLs redirect
to the new app URLs. Re-running the wizard is safe.

**Size.** ~1–2 weeks. **Rollback.** Wizard is opt-in and idempotent;
failed runs don't damage local data.

### Phase 6 — Cutover

**Goal.** Production runs against Postgres; local-first mode is no
longer the default.

**Work.** Flip `USE_SERVER_DATA` on by default. Hide the local-first
entry points behind a "Local archive" view. User comms to existing beta
scorers prompting them to import. Update help docs
(`app/help/page.tsx`), CLAUDE.md, and README. Remove the "Publish to
bilge" upload code path from the app entirely.

**Exit criteria.** Every active beta user is signed in and using the
server backend. Local code paths retained but not reachable from the
main nav.

**Size.** ~1 week of work plus a coordinated comms window.
**Rollback.** The flag remains in place during a stabilisation window so
individual users can revert if needed; local data is not deleted.

### Phase 7 — bilge decommission

**Goal.** ADR-004's retirement trigger fires.

**Work.** After ~6 months of redirect-only operation (or once
redirect-hit logs show negligible traffic), bilge slugs switch to
returning 410 Gone. The bilge Vercel project, Blob storage, KV, and
Resend templates are deleted. ADR-004 is marked **Superseded by
ADR-008**.

**Exit criteria.** `bilge.sailscoring.ie` returns 410. The bilge
repository is archived.

**Size.** ~2–3 days, mostly calendar-gated. **Rollback.** None —
irreversible.

### Sequencing notes

- Phases 1–3 can land at any point in the calendar; they're invisible
  to production users.
- Phase 4 should land before any HYC live race-day scoring begins, so
  scorers publish via the real path from day one.
- Phase 5 is gated on Phase 2's import endpoint and can be developed in
  parallel with Phase 4.
- Phase 6 should not happen mid-series — pick a quiet point in the
  racing calendar.
- Phase 7 is calendar-only; no engineering blocker once Phase 6 ships.

**Total active engineering: ~9–12 weeks of focused work** before
Phase 7's wait period. Only Phases 4 and 6 have hard external timing
constraints.

## Sustainability posture

Each non-trivially-replaceable dependency in this stack was reviewed in
[`docs/design/oss_health_report.md`](../oss_health_report.md) (April
2026). Findings most relevant to ADR-008:

- **Auth.js is in security-patch mode** and its maintainers explicitly
  direct new projects to Better Auth. This validates the deviation from
  ADR-003 already recorded above.
- **Concentration around Vercel/Meta** in five of seven critical
  dependencies. Not a reason to choose differently; a reason to
  preserve portability seams.
- **Operational-security overhead.** Two CVSS 9+ Next.js/React CVEs in
  13 months and the April 2026 Vercel supply-chain breach mean active
  patch discipline is a baseline expectation, not a nice-to-have.

ADR-008 adopts the report's concrete recommendations:

| Commitment | Why |
|------------|-----|
| Build with plain `next build` / `next start`; no Vercel-only `next.config` features | Keeps OpenNext / self-host migration available via the Next.js 16.2 stable Adapter API |
| Auth checks in route handlers and repositories, not only middleware | CVE-2025-29927 made middleware-only auth a known failure mode |
| Encrypt sensitive credentials at the application layer | The April 2026 Vercel breach exfiltrated plaintext "non-sensitive" env vars |
| Wrap Cache Components calls (`use cache`, `cacheTag`, `updateTag`) in a thin helper | The cache API has churned twice in 18 months; isolate the seam |
| Scheduled CI dump-and-restore of the database onto vanilla Postgres | Catches accidental dependence on Neon-specific extensions |
| Scheduled Next.js minor (quarterly) and major (annual) upgrade cadence | Drift is more expensive than churn |

Indicators to watch over the next 12 months — Tailwind Labs sponsorship
runway, React Foundation TSC independence, PlanetScale's treatment of
Drizzle, Better Auth's trajectory — are listed in the report and not
duplicated here.

## Consequences

### Positive

- Scorers can use the app from any device, share series with their panel,
  and update results without exchanging files.
- Server-of-record eliminates IndexedDB eviction risk on iOS Safari.
- Free read-only offline as a side effect of TanStack Query's persistent
  cache, without a sync engine.
- Better Auth + Drizzle + Postgres unblocks a public API as a follow-up
  rather than a rewrite; the api-keys and OIDC-provider plugins shorten
  that follow-up materially.
- ADR-003's pre-resolved choices are validated in execution rather than
  in the abstract.

### Negative

- Loss of "no infrastructure" simplicity. Neon, Resend, and Better Auth
  are now in the dev/test/prod loop.
- Auth, workspaces, and authorization checks are new code surface that
  must be tested and reviewed.
- Replacing `useLiveQuery` is a UI-wide change touching every data-bearing
  page.
- Existing bilge URLs need a redirect mechanism for the transition
  window; old links are otherwise broken.

### Risks

- **Cutover during beta.** Pulling local-first out from under HYC scorers
  before they've scored a live event adds risk on top of risk.
  Mitigation: the phasing above; do not cut over until the migration UX
  is solid and at least one panel has rehearsed it on a historical series.
- **Concurrency edge cases.** Last-write-wins plus version checks cover
  the common case; simultaneous edits to the same record may surface
  surprises. Mitigation: surface 409s clearly in the UI; schedule
  awareness work if problems are reported.
- **Authorization regressions.** Forgetting a workspace check is a
  tenancy bug. Mitigation: route every read/write through the repository
  layer; add Drizzle query helpers that require a `workspace_id`; cover
  in e2e.
- **Schema drift between Dexie and Postgres during the swap.** Mitigation:
  the JSON export format is the canonical schema; both backends round-trip
  through it.

## Open questions

- **Workspace creation UX.** Auto-create a personal workspace on signup?
  Allow renaming? Allow ownership transfer? Likely yes to all; deferred
  to implementation.
- **Public workspace index.** Does a workspace have a public landing page
  listing its public series? Probably yes — replaces what bilge's `/l/`
  prefix listing does today, for account-bound publishing.
- **Pricing.** Free during beta. Pricing model deferred to a separate
  ADR (tied to ADR-003's open-source-vs-commercial question).
- **Scorer attribution in scoring history.** Anticipated by the horizon
  doc once we have user emails; should be wired in this transition.

## Related Decisions

- [ADR-001: Database Choice](001-database-choice.md) — the Postgres half
  of the hybrid is now scheduled.
- [ADR-003: Application Architecture](003-application-architecture.md) —
  this ADR is the transition ADR-003 anticipated. ADR-003's "Future
  Decisions Pre-resolved" section is largely ratified here. ADR-008
  supersedes ADR-003's transition table by committing to specific
  technologies and a phased plan.
- [ADR-004: Results Publishing](004-results-publishing.md) — ADR-004's
  retirement trigger fires when this transition ships. The full-stack
  app's publishing path replaces bilge; bilge URLs are redirected for a
  transition window and then taken offline. The migration record
  (`publishing.uuid` and `publishing.pages` in the JSON export) is the
  basis for the redirect mappings, exactly as ADR-004 anticipated.
- [ADR-006: Testing and Logging](006-testing-and-logging.md) — unchanged;
  Vitest and Playwright remain the test stack.

## References

- ADR-003's "Future Decisions Pre-resolved" section — the starting point.
- [`docs/design/oss_health_report.md`](../oss_health_report.md) — April 2026
  sustainability review of every non-trivially-replaceable dependency in
  this stack; source of the *Sustainability posture* commitments.
- [Drizzle ORM](https://orm.drizzle.team/)
- [Better Auth](https://www.better-auth.com/)
- [Neon Postgres on Vercel Marketplace](https://vercel.com/marketplace/neon)
- [TanStack Query — persistent caching](https://tanstack.com/query/latest/docs/framework/react/plugins/persistQueryClient)
- [Next.js 16 Cache Components](https://nextjs.org/docs/app/building-your-application/caching)
