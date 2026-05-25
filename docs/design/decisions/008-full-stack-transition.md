# ADR-008: Full-Stack Transition

**Status:** Accepted

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

- **Offline editing.** Read-only offline was an aspiration in early
  drafts of this ADR; the `persistQueryClient` prototype in Phase 3
  caused more confusion than value and was removed. Both read-only and
  durable offline writes (sync engine, CRDTs) are now out of scope.
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
| Reactivity | TanStack Query | Replaces Dexie's `useLiveQuery`; explicit invalidation per mutation |
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

Each mutable row gets a `version` integer and `updated_at` timestamp.
Mutations include the expected version; mismatches return a 409 with the
current state and (once collaboration lands) the actor of the conflicting
change. Last-write-wins is acceptable in practice — panels rarely edit the
same record simultaneously — but explicit detection avoids silent
overwrites.

Awareness ("Mark edited race 3 just now") is delivered through the
activity log, not via SSE or Vercel Queues. The
[scorer-collaboration requirements](../../requirements/scorer-collaboration.md)
spell out the model: a chronological log of action-level events, surfaced
per-series and per-record, gives scorers enough confidence about the
current state without committing to real-time presence.

Concurrent editing requires a per-row autosave refactor of the race
finish-entry page (today a batch save model), so a stale-data refresh is
non-destructive when concurrent edits are in flight. This is the largest
UI-side change collaboration brings, and it is also where the silent
overwrite hole on `FinishRepository.saveMany` is closed. It lands as
Phase 6 (issue #111) — a dedicated refactor before the org-sharing work
in Phase 7.

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
replaced with **TanStack Query** hooks backed by route handlers via
`lib/api-repository.ts`. Mutations invalidate query keys explicitly;
optimistic updates are added per mutation where the UX warrants it.

`persistQueryClient` was prototyped during Phase 3 and removed: a stale
local cache without an explicit sync surface caused more confusion than
the read-only offline posture was worth. Offline support is no longer
claimed; this ADR's earlier goal of "read-only offline as a side effect"
is dropped.

## Publishing model

The full-stack app introduces an integrated publishing path that
**replaces bilge entirely**. It lands with bilge decommission, not earlier
— the existing local-mode publishing paths (HTML download, FTP upload,
publish-to-bilge) keep working through Phases 4–6.

When the new path lands:

- A series has an explicit "Publish" action.
- Publishing runs `lib/results-renderer.ts` against the current state to
  produce **static HTML** and stores the result in **Vercel Blob** (public
  access). Re-publishing overwrites the blob; edits do not auto-publish.
  This matches the scorer mental model — explicit publish, point-in-time
  results — and is what the
  [scorer-collaboration requirements](../../requirements/scorer-collaboration.md)
  imply for trust around "what is currently published."
- Public URLs: `/p/{slug}` where `slug` is the kebab-cased series name
  plus a short random suffix, set at first publish, stable forever. No
  user-typed slug; no namespace coordination with API routes; no
  prediction of future reserved words.
- The route handler at `/p/{slug}` reads the stored HTML and serves it
  with `Cache-Control` + `ETag` headers. No Cache Components, no
  render-on-demand, no `lib/published-cache.ts` helper.
- The in-app dialog shows the public URL, the publish timestamp, and an
  "X edits since last publish" hint sourced from the version delta on
  the series row.
- Multi-fleet bundles produce one blob per fleet, with a parent index
  page listing them — mirroring today's bilge layout so a re-publish to
  the same series produces the same URL shape.
- Public URLs are read-only and unauthenticated.

User and org slugs are out of scope until the org-based collaboration
phase. Personal workspaces never expose a vanity prefix; their published
series live under `/p/{slug}` only. Once orgs exist, they can claim
vanity URLs (e.g. `/o/{org-slug}/{series-slug}`) as aliases over the
canonical `/p/{slug}` — the original URL never changes identity.
Visibility (listed/unlisted) lands with orgs since "listed" needs a
public index destination.

### bilge retirement

bilge was always a stopgap (ADR-004). Its retirement is a single phase
that builds the replacement publishing path *and* drains old URLs:

1. Build the new publish-to-blob-storage path described above and ship
   it to workspaces.
2. The in-app "Publish to bilge" action is removed; subsequent publishes
   go through the new path only.
3. **Redirects, refined (issue #152).** The original plan auto-generated
   redirect mappings for *every* prior bilge slug from
   `publishing.pages`. In practice only one published URL has traffic
   worth preserving
   (`bilge.sailscoring.ie/r/2026-m15-westerns/standings`), so that
   machinery is dropped. Instead the event is re-imported into the app
   (the published HTML embeds the series JSON) and re-published to get
   its `/p/{slug}`, and a single **301 rule in the bilge service** points
   the old URL at it.
4. **Immediate decommission, not a 6-month window (issue #152).** With
   only one URL to preserve, the drain window buys nothing. Once the new
   path and the single 301 are live: take a static backup of all bilge
   Blob HTML + KV, delete Blob/KV/Resend and the upload/serve logic, and
   reduce bilge to a **redirect-only stub** — `bilge.sailscoring.ie`
   keeps serving the one 301 plus a catch-all 410 Gone. Archive the repo;
   the stub serves from its last deploy.

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
`USE_SERVER_DATA` feature flag (off by default until Phase 8) keeps
production users on the local-first build throughout Phases 1–7.

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
TanStack Query hook; mutations invalidate keys explicitly. Enforce the
repository boundary via a lint rule banning direct `db.` imports outside
`lib/dexie-repository.ts`.

(`persistQueryClient` was prototyped here and removed before merge —
see *UI reactivity* above.)

**Exit criteria.** With `USE_SERVER_DATA=on`, the entire app works
end-to-end against Postgres in development; with it off, the existing
local-first app is unchanged. Side-by-side e2e runs in both modes.

**Size.** ~2 weeks. The largest UI-layer change of the transition.
**Rollback.** Flip the flag.

### Phase 4 — Personal workspaces and concurrency *(complete)*

**Goal.** `USE_SERVER_DATA=on` runs the full IODAI and HYC scoring
workflows end-to-end against Postgres in personal workspaces, with the
same publishing UX as local mode (HTML download, FTP upload, publish to
bilge).

A deliberate KISS scope: collaboration features and the bilge
replacement were explicitly out, so the cutover and migration UX
(Phase 5) could ship without waiting on either.

**Work landed.** Optimistic concurrency: `expectedVersion` is threaded
through every single-row `save*` repository method, with 409s surfaced
as a generic "refresh-and-retry" toast — no merge dialog, no actor
attribution. End-to-end verification of every scoring workflow under
`USE_SERVER_DATA=on`, with side-by-side e2e suites in both modes. Small
`/account` pass.

`saveMany` paths (fleets, competitors, finishes, race-starts) were
deliberately left without per-row CAS — documented as
authoritative-by-construction in `lib/repository.ts:30-34`. The finish
entry hole this leaves is closed by the autosave refactor below
(issue #111).

**Outcome.** Multi-tab same-user 409s detected and surfaced cleanly.
Local-first build unchanged. Tracked by #103, closed `2026-05-02`,
landed `fd3e1f0`.

### Phase 5 — Migration UX *(in flight)*

**Goal.** Existing beta users can move their local data into a personal
workspace without losing anything.

**Work.** "Import from browser" wizard reads IndexedDB via the retained
Dexie repository, serialises each series via `lib/series-file.ts`, POSTs
to a new `/api/v1/import` endpoint that writes via the Postgres
repositories. Idempotent re-runs. "Local archive" view for series
already imported. Validate with at least one HYC beta user on a real
historical series.

Bilge URL redirect mappings move out of this phase to bilge
decommission (Phase 9), where they belong now that the bilge replacement
lives in the same phase.

**Exit criteria.** A beta user with existing local data can sign up,
import into their personal workspace, and continue working with full
fidelity. Re-running the wizard is safe.

**Size.** ~1–2 weeks. **Rollback.** Wizard is opt-in and idempotent;
failed runs don't damage local data.

### Phase 6 — Per-row autosave on finish entry *(complete)*

**Goal.** Replace the batch Save button on the race finish-entry page
with per-row autosave, and close the silent-overwrite hole on
`FinishRepository.saveMany` in the same pass.

**Why now.** Phase 4 deliberately left bulk-save paths without per-row
CAS, on the grounds that this refactor would land with org
collaboration. With HYC collaboration prioritised ahead of cutover, the
autosave refactor is the natural prerequisite — it's the largest single
chunk of UI work in the collaboration story, it stands alone, and
shipping it first lets Phase 7 focus on org-sharing infrastructure
rather than a finish-entry rewrite.

**Work.** Per-row autosave on every interaction except drag-reorder
(which stays bulk but gains per-row CAS). Status pill replaces the Save
button. Row-scoped conflict dialog (without rich actor attribution —
that lands in Phase 7). State model collapses; `isDirty` tracking goes
away.

**Exit criteria.** The finish-entry page has no Save button. Two-tab
same-user concurrent saves on the same race surface a row-scoped 409.
No silent-overwrite path remains on `FinishRepository.saveMany`.

**Size.** ~5 days. Tracked by #111, closed `2026-05-04`, landed
`3aaa301`. **Rollback.** Revertible deploy.

### Phase 7 — Org-sharing core *(complete)*

**Goal.** HYC's scoring panel can share a workspace and collaborate
safely on a series. Optimistic concurrency on every write, clean 409s
with actor attribution, no silent overwrites. Manual workspace
administration via CLI; no other publishing changes; no activity log.

The panel coordinates "who is scoring which series" out of band, so the
application's job is to make collisions visible and recoverable — not
to prevent them. The richer collaboration UX (full activity log,
self-service org admin, vanity URLs, listed/unlisted) lands in
Phase 10 once Phase 9 is in.

**Pre-requisite.** Phase 6 (#111) closes the silent-overwrite hole on
`FinishRepository.saveMany` and lands the row-scoped conflict dialog.
Phase 7 builds on both.

**Work.**

- **Workspace switcher** in the global header, wired to Better Auth's
  `setActiveOrganization`. Removes the `createdAt` membership fallback
  in `lib/auth/require-workspace.ts`.
- **Manual provisioning CLI** (`scripts/provision-org.ts`) for
  `create-org`, `add-member`, `set-role`, `list-members`,
  `remove-member`. Replaces the originally planned invitation/members
  management UI; self-service flows land in Phase 10. Operator runbook:
  [`docs/workspace-provisioning.md`](../../workspace-provisioning.md).
- **"Copy to workspace…" action** on a series. Copy rather than move so
  a botched copy is recoverable — the personal-workspace original stays
  intact. Generates fresh UUIDs, copies all child rows, strips
  workspace-scoped references (FTP server, publishing state).
- **Actor attribution on conflicts.** `updated_by` text column on every
  mutable row, populated by the `workspaceRoute` wrapper. 409 envelope
  grows `actor` (id + email/displayName) + `updatedAt`. The row-scoped
  conflict dialog from Phase 6 picks them up: "Edited by Sarah at
  14:23" instead of "someone."
- **CAS audit on remaining `saveMany` paths.** Walk every caller of the
  bulk paths (fleets, competitors, race-starts) and either confirm
  authoritative-by-construction or add per-row CAS. Likely no code
  change; closes the case rather than leaving it implicit.
- **`/workspace` settings hub.** Rename `/settings` → `/workspace`.
  Page titled "Workspace settings: *Workspace Name*", with FTP servers
  as a card and section structure ready to grow into members /
  invitations / danger-zone in Phase 10. `/account` remains the
  user-level page.

**Exit criteria.** HYC org workspace provisioned by hand; panel members
sign in and switch into it; same series and FTP credentials visible to
all members; concurrent edits anywhere surface clean 409s with actor
attribution; personal-workspace series can be copied into the HYC
workspace; local-first build unchanged.

**Size.** ~7 days end-to-end. Tracked by #112, closed `2026-05-04`,
landed `b0d856f`.
**Rollback.** Org features hide behind a flag; manual data unaffected.

### Phase 8 — Cutover

**Goal.** Production runs against Postgres; local-first mode is no
longer the default. Both IODAI and HYC are on the new stack — IODAI as
a personal-workspace user, HYC as a panel sharing the org workspace
provisioned in Phase 7.

**Work.** Flip `USE_SERVER_DATA` on by default. Hide the local-first
entry points behind a "Local archive" view. User comms to existing beta
scorers prompting them to import. Update help docs
(`app/help/page.tsx`), CLAUDE.md, and README.

With Phase 7 in place, cutover delivers server-of-record *and* panel
collaboration in the same flag flip rather than leaving HYC scorers in
a `.sailscoring` file-exchange gap. The "Publish to bilge" code path
stays in tree until Phase 9 — that's the phase that builds the
replacement and removes bilge upload.

**Exit criteria.** Every active beta user is signed in and using the
server backend. Local code paths retained but not reachable from the
main nav. HYC's panel works against the shared org workspace from day
one of cutover.

**Size.** ~1 week of work plus a coordinated comms window.
**Rollback.** The flag remains in place during a stabilisation window so
individual users can revert if needed; local data is not deleted.

**Post-cutover delete pass.** After the stabilisation window the
`USE_SERVER_DATA` flag, the Dexie repository, the IndexedDB schema, the
"Move to my account" migration banner, the dual Playwright projects,
and the lint carve-outs were removed. The series file format and
`/import` link flow stayed (backup / hand-off use case). The "Local
archive" view referenced above never shipped — the migration banner
covered the same ground and was deleted with the rest.

### Phase 9 — Bilge replacement and decommission

**Goal.** The new publish-to-blob-storage path is live; bilge is
retired.

**Work.** Build the new publish-to-blob-storage path described in the
*Publishing model* section. The explicit "Publish" action runs
`lib/results-renderer.ts`, uploads to Vercel Blob (public access), and
writes a `published_series` row with the slug, blob locator, and content
hash. New public route `/p/{slug}` serves the stored HTML with
`Cache-Control` + `ETag`. Standings UI swaps to the new dialog. The
in-app "Publish to bilge" action is removed.

Storage is fronted by `lib/blob-storage.ts`: Vercel Blob in production,
and a `published_blobs` Postgres table as a fallback when
`BLOB_READ_WRITE_TOKEN` is unset — so local dev, CI, and e2e exercise the
full publish flow with only Postgres, matching the "local dev needs no
external services beyond Resend + Neon" goal.

The bilge redirect and decommission are scoped down per issue #152 (see
*bilge retirement* above): a single 301 for the one live URL, then
immediate decommission to a redirect-only stub rather than a 6-month
drain. ADR-004 is marked **Superseded by ADR-008** at decommission.

**Exit criteria.** Workspace publishing produces a public `/p/{slug}` URL
served from Vercel Blob. `…/r/2026-m15-westerns/standings` 301s to the
new URL; all other bilge slugs return 410. The bilge Blob/KV/Resend
resources are deleted and the repo is archived to a redirect-only stub.

**Size.** ~1–2 weeks of build, plus the ~6-month calendar window before
final decommission. **Rollback.** Final 410 cutover is irreversible;
the build phase rolls back like any other (revert the deploy).

### Phase 10 — Publishing-coupled and self-service collaboration

**Goal.** Everything from the original Phase 8 backlog that was either
deferred from Phase 7 or genuinely depends on Phase 9's `/p/{slug}`
publishing path being live.

**Work.**

- **Self-service org creation** via an admin-approved, out-of-band
  review process: a user submits a request from `/account`, project
  owner approves manually. Replaces the manual CLI from Phase 7.
- **Invitation flow** (Better Auth invitations plugin), members
  management UI, role changes — the full administration surface
  Phase 7 deferred.
- **Activity log proper.** Workspace-scoped, action-vocabulary-driven
  log written in the `workspaceRoute` wrapper for every mutation.
  Surfaced as a per-series Activity tab, recency strips on the series
  list, and per-record stamps in the competitor edit dialog. The log
  is the primary collaboration affordance per the
  [scorer-collaboration requirements](../../requirements/scorer-collaboration.md).
  Phase 7's `updated_by` column is the foundation; Phase 10 adds the
  explicit log table and the surfaces.
- User and org slug claim flows, in **separate namespaces**. User slugs
  drive attribution (e.g. profile route under `/u/{slug}`); org slugs
  can claim vanity URLs as aliases over the canonical `/p/{slug}`
  publishing path from Phase 9.
- Listed/unlisted visibility toggle and a workspace public index.

**Exit criteria.** Two test accounts in one workspace can both edit a
series and see each other's changes through the activity log. Org
admins can self-serve invitations and member management. Org-slug
vanity URLs alias `/p/{slug}` correctly. HYC scoring panel can score a
live race day on the new stack with multiple scorers concurrently with
the full collaboration UX — Phase 7 covered the safety floor; Phase 10
covers the rich UX.

**Size.** ~3–4 weeks (the residual after Phase 7 + Phase 6 are deducted
from the original Phase 8 estimate).
**Rollback.** Activity log + slug surfaces hide behind flags; Phase 7
collaboration remains usable independently.

### Sequencing notes

The original ADR ordered cutover → bilge replacement → org
collaboration as Phases 6 → 7 → 8. That order was reshuffled to
prioritise HYC panel collaboration: the panel was going to live through
a `.sailscoring` file-exchange gap between cutover and the original
Phase 8. The collaboration phase split into a safety-critical half
(now Phase 7) and a richer-UX half (now Phase 10), with the
safety-critical half landing *before* cutover. The autosave refactor
that Phase 4 deferred became a standalone Phase 6.

Current order: **5 → 6 (#111) → 7 (#112) → 8 → 9 → 10.**

- Phases 1–4, 6, and 7 are complete; 5 is in flight in parallel.
- Phase 6 (#111) closes the silent-overwrite hole on
  `FinishRepository.saveMany` that Phase 4 deferred. It also fixes the
  long-standing Save-button UX wart on finish entry. Lands as a
  standalone refactor before Phase 7 so the org-sharing work can focus
  on infrastructure rather than a finish-entry rewrite.
- Phase 5 is gated on Phase 2's import endpoint and was developed in
  parallel with Phase 4.
- Phase 7 is gated on Phase 6 (autosave + row-scoped conflict dialog)
  and on Phase 5 being far enough along that beta users can move
  existing series into the new org workspace.
- Phase 8 should not happen mid-series — pick a quiet point in the
  racing calendar. With Phase 7 in place, cutover delivers
  server-of-record *and* panel collaboration in the same flag flip.
- Phase 9 (bilge replacement and decommission) lands after cutover:
  the new publishing path is a pre-requisite for Phase 10's org-slug
  vanity URLs and listed/unlisted toggle.
- Phase 10 lands when the residual collaboration UX (full activity log,
  self-service org admin, vanity URLs) becomes the next priority. Not
  blocked on the calendar gate for final bilge takedown.

**Total active engineering: ~10–13 weeks of focused work** before final
bilge takedown — unchanged in aggregate, redistributed in order.
Phase 8 (cutover) is the only phase with a hard external timing
constraint; the rest ladder cleanly.

## Sustainability posture

Each non-trivially-replaceable dependency in this stack was reviewed in
[`docs/design/oss-health-report.md`](../oss-health-report.md) (April
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
| Scheduled CI dump-and-restore of the database onto vanilla Postgres | Catches accidental dependence on Neon-specific extensions |
| Scheduled Next.js minor (quarterly) and major (annual) upgrade cadence | Drift is more expensive than churn |

Indicators to watch over the next 12 months — Tailwind Labs sponsorship
runway, React Foundation TSC independence, PlanetScale's treatment of
Drizzle, Better Auth's trajectory — are listed in the report and not
duplicated here.

## Consequences

### Positive

- Scorers can use the app from any device. From Phase 7, panels can
  share series and update results without exchanging files; richer
  collaboration affordances (activity log, self-service org admin)
  follow in Phase 10.
- Server-of-record eliminates IndexedDB eviction risk on iOS Safari.
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

- **Workspace creation UX.** Personal workspace is auto-created on
  signup (settled — Phase 1). Org creation is manual via CLI in Phase 7
  (a small admin script over the Better Auth organization API);
  self-service request + admin-approved review lands in Phase 10.
  Renaming, ownership transfer, and members management are all
  Phase 10.
- **Public workspace index.** A workspace has a public landing page
  listing its listed series — lands in Phase 10 alongside the
  listed/unlisted toggle. Replaces what bilge's `/l/` prefix listing
  does today.
- **Pricing.** Free during beta. Pricing model deferred to a separate
  ADR (tied to ADR-003's open-source-vs-commercial question).
- **Scorer attribution in scoring history.** Down-payment in Phase 7
  via an `updated_by` text column on every mutable row, surfaced in the
  409 envelope and the row-scoped conflict dialog. Full activity log
  (per-series Activity tab, recency strips, per-record stamps) lands in
  Phase 10 on top of that foundation.

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
- [`docs/design/oss-health-report.md`](../oss-health-report.md) — April 2026
  sustainability review of every non-trivially-replaceable dependency in
  this stack; source of the *Sustainability posture* commitments.
- [Drizzle ORM](https://orm.drizzle.team/)
- [Better Auth](https://www.better-auth.com/)
- [Neon Postgres on Vercel Marketplace](https://vercel.com/marketplace/neon)
- [TanStack Query — persistent caching](https://tanstack.com/query/latest/docs/framework/react/plugins/persistQueryClient)
- [Next.js 16 Cache Components](https://nextjs.org/docs/app/building-your-application/caching)
