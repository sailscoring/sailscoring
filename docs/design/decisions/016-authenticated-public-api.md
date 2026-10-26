# ADR-016: An authenticated public API

**Status:** Accepted (2026-10-25). Implemented by #695–#701. Amended
2026-10-26: the authenticated part is no longer a preview (§5); its calls
carry the same promise as the publications. Also amended 2026-10-26: a
`submissions` scope for finish sheet submissions (§4, #671).

**Date:** 2026-10-25

**Deciders:** Mark McLoughlin

## Context

Two outside apps want to write to Sail Scoring, not just read from it.

- **tradboats.ie/course**, Pat Tanner's course-plotting page, writes an ORC
  constructed course document for each start. Today he pastes each one into
  the race-start dialog (#667): one paste per start, nine for a day of two
  races with three starts each. He wants his page to set up the day's races
  and starts, and a course for each start, itself.
- **RaceOps** (racing.gbsc.ie), the race-day app Fergal Lyons runs for
  Galway Bay SC, records finishes on the water, offline, and exports them
  once it's back in range. It reads results through ADR-015's published
  results API; recording finishes is the next step. #671 proposes a design
  for that, which is set aside for a closer review and is not part of this
  decision.

What exists today:

- **`/api/v1`** is a complete, workspace-scoped REST API, and ADR-009 made it
  reachable with an API key. But ADR-009 kept it an internal contract with
  no stability promise, and left a documented public API to a follow-up ADR
  (its M8). The CLI and the archive repos' CI are its only callers apart from
  the app.
- **`/api/public/v1`** is ADR-015's published results API: unauthenticated,
  display-shaped, built at publish, with an OpenAPI description.

Opening `/api/v1` as it stands would promise far more than anyone could keep:

- **Its shapes are the internal model.** Every schema in `lib/validation/`
  is checked at compile time to equal its type in `lib/types.ts`. The
  `.sailscoring` format went from version 1 on 26 March to version 69 now,
  and several of those changes reshaped existing data (`crewName` to
  `crewNames`, `club` to `clubs`, `name`/`owner`/`helm` to people lists, the
  split-fleet configuration narrowed). Under a stability promise each would
  be a breaking change.
- **Updates replace whole rows.** `PUT` stores a missing optional field as
  null. A client that reads a finish into a typed struct, drops the fields
  it doesn't know and writes it back erases every field added after it was
  written, so even adding a field would not be safe.
- **It asks clients for what the server owns.** Creating a race requires a
  `createdAt` and a race number the server then ignores (#698), and the
  client must resolve fleet names to ids, compute finishing order, and so on.

And the way these apps would authenticate matters as much as the calls. A
key belongs to a user, so "a key for the app" means an account made for the
app, given a role in each club's workspace. Every write would then be
credited to the app rather than the person, the app would hold one secret
covering every club that uses it, and adding a club would mean asking Mark
for another key.

## Decision Drivers

- **A promise that can be kept.** Whatever is public must survive the
  internal model changing at the rate it does.
- **The person using the app is the one who authenticates.** Writes are
  credited to them, they can do only what their role allows, and losing
  their place in a workspace removes the app's access with it.
- **No shortcuts on authentication.** It's the part hardest to change once
  apps depend on it.
- **Start small.** A call or field can be added later; taking one away is
  what the promise forbids.
- **Reuse.** Public routes should reach the existing handlers, so tenancy,
  permissions and validation aren't restated.
- **One public API.** A developer should find the published results and the
  authenticated calls documented together.

## Considered Options

### Axis 1: What is public

#### Option 1a: Open `/api/v1` as it is

Document the existing routes and promise them.

**Pros:**
- No new routes; the CLI, the app and outside apps share one API.

**Cons:**
- Every internal model change becomes a public one.
- Whole-object `PUT` makes even additions unsafe for outside clients.
- About 115 route files to document and stand behind, most of which no
  outside app needs.

#### Option 1b: A small public API of its own, mapped onto the existing handlers (chosen)

Public calls with their own schemas, a handful of fields each, and writes
that are named actions taking only what the client knows. Each public route
maps its input, calls the existing handler, and maps the output.

**Pros:**
- An internal change touches the public API only when it touches a public
  field.
- No read-modify-write round trips, so no erasure.
- Only what an app needs is promised.

**Cons:**
- A second schema and a mapping per public resource, and tests that they
  agree with the app.
- A call an app wants that isn't public waits for us to add it.

#### Where the public calls live

The public calls could go under their own prefix, or under `/api/public/v1`
beside ADR-015's publications. **Under `/api/public/v1` (chosen)**: one
public API, one description, one version; the publications are the part that
needs no sign-in. The cost is that both parts share a version number, and that
"public" now means documented and stable rather than unauthenticated.

### Axis 2: How an outside app authenticates

#### Option 2a: One key per app

Mark creates an account for the app and issues a key for it.

**Pros:**
- Works today.

**Cons:**
- Writes credited to the app, not the person.
- One secret covering every club the app serves.
- A key, and a role, per club, issued by hand.

#### Option 2b: Personal keys

Each user creates a key in Sail Scoring and pastes it into the app.

**Pros:**
- Per-user, and the api-key plugin does most of it.

**Cons:**
- Asks ordinary users, race officers among them, to copy a long-lived
  secret into someone else's app.
- The key can do everything the user can, in every workspace they belong
  to, unless scoped.
- Nothing records which app holds which key, beyond the label the user typed.
- In a browser-only app the key sits in the page's storage.

#### Option 2c: OAuth, through Better Auth's OAuth provider plugin (chosen)

The app sends the user to Sail Scoring, where they sign in as usual and
approve what the app asks for; the app receives a short-lived access token
and a refresh token. `@better-auth/oauth-provider` is MIT-licensed, maintained
by Better Auth on the same version line as ours, and provides the
authorization code grant with PKCE, refresh tokens, scopes, revocation,
introspection, hooks for our own sign-in and consent pages, and the device
authorization grant.

**Pros:**
- The app never handles the user's sign-in.
- Tokens are short-lived, scoped, and revocable app by app.
- Every call says which app made it.
- PKCE lets a web page with no server of its own use it; refresh tokens let
  an offline app renew its access once it's back in range.
- The issuing, checking and renewal of tokens, where the security risk
  lives, is a maintained library, not our code.

**Cons:**
- A consent page, a scope list, a "Connected apps" card, and token handling
  in the route wrapper to build.
- More for an app developer than pasting a key: a redirect and a token
  refresh, through any standard OAuth library.
- A new plugin on the auth seam.

#### Option 2d: A home-made "connect" page

A page that mints a key and hands it to the app through a redirect.

**Pros:**
- Smaller than OAuth.

**Cons:**
- OAuth reinvented, without the scrutiny the standard has had.

## Decision

### 1. One public API, in two parts

`/api/public/v1` is the public API. Its publications (ADR-015) need no sign-in;
the calls in §3 need an OAuth access token. "Public" means documented and promised stable.
`/api/v1` stays the internal API: the app's, the CLI's and the archive repos'
CI's, free to change with the app. Nothing is public only because the CLI
uses it.

### 2. Public shapes and actions

- **Each public resource has its own schema**, mapped from the internal
  type. Field names follow ADR-015's where both parts show the same thing,
  so an app sees one competitor shape across the two.
- **Writes are actions.** Each takes only what the client knows; the server
  fills in the rest. There is no general update.
- **Ids are the internal ids.** This part writes, so it uses the ids writes
  need; ADR-015's hashed competitor ids stay in the publications part.
- **Public routes are thin.** Map the input, call the `lib/api-handlers`
  function, map the output. Tenancy, permissions, `Idempotency-Key` and
  `If-Match` behave as they do on `/api/v1`.

### 3. The calls

Paths are relative to `/api/public/v1`. Every call names its workspace in the
`x-sailscoring-workspace` header, by slug or id; when the grant covers a
single workspace, the header may be left out.

**Resources:**

| Resource | Fields |
|---|---|
| Workspace | `id`, `slug`, `name` |
| Season | `label`, `current` |
| Series | `id`, `name`, `venue`, `startDate`, `endDate`, `archived`, `asPublished` |
| Fleet | `id`, `name`, `scoringSystem` |
| Competitor | `id`, `fleetIds`, `sailNumber`, `bowNumber`, `alternativeSailNumbers`, `boatName`, `boatClass`, `names`, `helms`, `owners`, `crew`, `clubs`, `nationality`, `excluded` |
| Race | `id`, `number`, `name`, `date`, `starts` |
| Start | `id`, `fleetIds`, `startTime`, `course` |
| Course | `name`, `distanceNm`, `legs` (each `name`, `distanceNm`, `bearingDeg`, `windDirectionDeg`, `windSpeedKts`, in true) |
| Finish | `id`, `competitorId`, `sailNumber` (only when unmatched), `position`, `tiedWithPrevious`, `finishTime`, `elapsedSecs`, `resultCode`, `penaltyCode` |
| Publication | `id`, `seriesId`, `slug`, `url`, `publishedAt` |

A race carries its starts, so one call lists a series' races and the starts
on each. Course legs come back in true, as stored, so a client can check
what an applied course became. Finishes leave out redress and penalty
overrides; the standings carry their effect.

**Reads:**

| Method | Path | Returns | Scope |
|---|---|---|---|
| GET | `/workspaces` | The workspaces this grant can act in | `read` |
| GET | `/workspace/seasons` | Seasons, for publishing into | `read` |
| GET | `/series` | Series | `read` |
| GET | `/series/{id}` | A series | `read` |
| GET | `/series/{id}/fleets` | Fleets | `read` |
| GET | `/series/{id}/competitors` | Competitors | `read` |
| GET | `/series/{id}/races` | Races, with their starts | `read` |
| GET | `/series/{id}/races/{raceId}` | A race, with its starts | `read` |
| GET | `/races/{raceId}/finishes` | Finishes | `read` |
| GET | `/series/{id}/publish` | The series' publication | `read` |
| GET | `/publications` | Every publication in the workspace, each linking its `/publications/{id}` | `read` |

**Writes:**

| Method | Path | Input | Scope |
|---|---|---|---|
| POST | `/series/{id}/races` | Races to append, each `id?`, `date`, `name?`, `starts` (each `id?`, `fleetIds`, `startTime?`); numbered by the server | `races` |
| DELETE | `/series/{id}/races/{raceId}` | — (later races are renumbered) | `races` |
| PATCH | `/races/{raceId}/starts/{startId}` | Any of `startTime`, `fleetIds`; `null` clears (#696) | `races` |
| DELETE | `/races/{raceId}/starts/{startId}` | — | `races` |
| PUT | `/races/{raceId}/starts/{startId}/course` | An ORC constructed course document, as written; refuses to replace legs unless asked (#695) | `races` |
| POST | `/series/{id}/publish` | `season`, `folder`, `fleets`, `skipPages`, … | `publish` |
| DELETE | `/series/{id}/publish` | — | `publish` |

The server refuses a start whose fleets overlap another start of the same
race (#697), so a start can be found by its fleets.

**Standings are not in this part.** An app reads the published standings
from the publications part. Standings computed live, before publishing, can
be added later in ADR-015's `standings` shape, so apps see one standings
shape across both parts.

**Not public, for now:** general create, update and delete of series,
fleets, competitors and finishes; whole-object `PUT`; bulk operations;
scoring detail (rating overrides, redress, penalties, handicaps); series
setup (copy, follow-on, sub-series, scoring settings); feature-gated areas
(split fleets, competitor identities, the course library); revisions and
trash; workspace configuration; publishing extras (preferences, FTP, the RRS
organisation push); calls that pass on other people's data (`handicap-sources/*`,
the RaceSense regatta read, the World Sailing check); and what only the CLI
uses (importing and replacing series from files, archive, category, reorder,
rankings, the archive ingest calls). Each can be added, call by call, when
an app needs it.

### 4. Authentication

Three ways in, each for one kind of caller:

| Caller | How | Notes |
|---|---|---|
| An outside app | OAuth: authorization code with PKCE | The app's user signs in to Sail Scoring and approves |
| A person using the CLI | OAuth: device authorization grant (RFC 8628) | `sailscoring auth login` prints a code and a URL, as `gh auth login` does |
| Automation we run (the archive repos' CI) | An API key, issued by Mark | On `/api/v1` only, on an account made for it, with a narrow role such as `archivist` |

- **No accounts are made for outside apps.** Their users connect their own.
- **A grant names one workspace.** After signing in, the user chooses which
  of their workspaces the app may act in (the provider's post-login step),
  and the consent and every token issued under it carry that workspace. An
  app that should reach two workspaces is connected to each. The header may
  name the grant's workspace, or be left out; any other workspace is
  refused.
- **Only workspaces with the `connected-apps` gate on can be granted**, and
  the gate is checked on every call, so turning it off cuts every app off
  from the workspace at once. It's operator-managed: we switch it on
  workspace by workspace.
- **What a call may do is the user's role in that workspace, limited to the
  granted scopes.** The scopes start coarse:

  | Scope | Allows | Needs the role permission |
  |---|---|---|
  | `read` | The reads in §3 | `read` |
  | `races` | Creating and deleting races, changing and deleting starts, applying courses | `score` |
  | `publish` | Publishing and unpublishing | `score` |

  A narrower scope, such as finish submissions if #671 goes ahead, is added
  with the calls it covers. *Amended 2026-10-26:* #671 added `submissions`
  (submitting a race's finishes for a scorer to review), which needs the
  `submit-finishes` permission: the `recorder` role's, and every scoring
  role's.
- **Apps are registered by Mark**, each with its exact redirect URIs. There
  is no self-registration.
- **Writes are credited to the person and the app**: the activity log reads
  "Pat Tanner via tradboats.ie/course".
- **A "Connected apps" card on `/account`** lists each grant and revokes it.
- **The authenticated part accepts only OAuth access tokens**: never the
  session cookie, and never an API key. Each token resolves to a user, an
  app, scopes and a workspace. Without cookies it can answer cross-origin
  requests from any origin, for `Authorization`, `x-sailscoring-workspace`,
  `Idempotency-Key` and `If-Match`, so a browser-only app can call it.
- **`/api/v1` accepts OAuth access tokens as well, from the CLI only**, for
  its device sign-in, alongside the session cookie (the app) and API keys
  (our automation). The CLI's tokens carry no workspace: they act wherever
  their user is a member, chosen per call by the header, as a key does. An
  outside app's token is refused there.
- **Rate limits are per grant**, documented, and for the CLI's grant high
  enough for its bulk imports.

Personal API keys go no further: the device grant replaces them for people
using the CLI, so ADR-009's self-service key card (its M5) is no longer
needed. API keys remain only for automation we run, and only on `/api/v1`.

**The spike** (in #700) proved the plugin in our setup, with these
findings:

- **Tokens are opaque**, looked up on each call, so revoking a grant or
  disabling an app stops it at once; a JWT can't be revoked. Access tokens
  carry an `ssat_` prefix and refresh tokens `ssrt_`, which keeps the
  api-key plugin (which takes any bearer token as a key) from seeing them.
  Access tokens last an hour and refresh tokens 90 days, longer than an
  offline race day by far.
- **An access token is tied to the browser session it was approved in.** The
  provider checks that session on every call. Signing out of that browser
  ends the access token, but the app's refresh token gets it a new one that
  isn't tied to any session, so the app carries on. A session that lapses
  instead (90 days without using Sail Scoring in that browser) takes the
  app's access with it, and the app asks again.
- **Magic-link sign-in needed one change.** The provider resumes the app's
  request only when the session is created in the same request as the
  sign-in, which a magic link never does. The sign-in page makes the link's
  destination the authorization request itself.
- **The provider lets any signed-in user register apps unless told not to**,
  so a privileges hook allows client changes only from the operator's
  registration endpoint, used by `pnpm oauth-client`.
- **The device grant is refused to every client but our own**, so an
  outside app can't use it to get a token that reaches every workspace.

### 5. Stability

- **The authenticated part started as a preview**, labelled so in the
  documentation and the OpenAPI description, so that its calls could still
  change incompatibly. *Amended 2026-10-26:* the label is off. Both parts
  carry the promise below, the breaking-change check covers every
  operation, and the documentation leads with the authenticated part.
- **Within `v1`, changes are additive.** We never remove or rename a field,
  change what one means, add a required input, or narrow an input's
  validation, except to refuse data that was already invalid (such as
  #697's overlapping fleets).
- **Clients must tolerate additions**: response fields they don't know,
  enum values they don't know, and lists in an order they don't rely on.
- **A breaking change is a `v2`** for the whole prefix. A `v2` carries the
  unchanged part as it is, and `v1` is served for a year after, as ADR-015
  promises.
- **Errors share one envelope**: `{ "error": "<code>", … }` with the codes
  `/api/v1` uses (`invalid`, `not-found`, `conflict`, `forbidden`,
  `unauthenticated`, `archived`, `rate-limited`, `internal`). The codes are
  stable; messages are not. Validation failures carry our own list of
  problems, not Zod's internal structure.
- **One OpenAPI description**, `/api/public/v1/openapi.json`, generated from
  the public schemas, covers both parts and says which operations need a token
  and which scopes. It's committed, and CI fails a change that breaks it.

### 6. Changes to ADR-015's part

Made with this work, while the publications part is new enough to change
cheaply:

- Its errors move to the shared envelope (today `{ "error": "not found" }`
  and free-text messages).
- Its description becomes part of the shared one.
- The firewall's per-IP rate-limit rule for `/api/public/` (inactive) is
  narrowed to `/api/public/v1/publications/`, since the authenticated calls
  have per-grant limits.
- ADR-015 and `docs/public-api.md` stop describing `/api/public/v1` as
  unauthenticated as a whole; `docs/public-api.md` documents both parts.

### 7. What this replaces in ADR-009

ADR-009's CLI decisions stand, and the CLI stays a client of `/api/v1`.
Its M5 (a self-service key card) is replaced by the device grant; its M6
(one description, a TypeScript SDK, the CLI built on it) and M8 (a documented
public API) are replaced by this ADR, whose description covers the public
API only. Whether to publish an SDK for the public API is left until an app
asks for one.

## Consequences

### Positive

- Outside apps write to Sail Scoring as the people using them, with
  permissions those people already have.
- The internal model keeps changing at its own pace; the public part
  changes only when a public field does.
- A developer finds the published results and the authenticated calls in one
  place, under one description.
- Pat can set up a race day with a handful of calls, and the course call
  does the conversion the dialog does.
- The CLI gets a sign-in without raw keys, and no self-service key UI is
  needed.
- The activity log says which app made a change.

### Negative

- A second schema and mapping per public resource, kept in step with the
  app by tests.
- New auth machinery: the plugin, a consent page, a scope list, the
  "Connected apps" card, and token handling in the route wrapper.
- App developers implement OAuth, not just a header.
- Every call an app wants beyond §3 waits for us to make it public.
- The two parts share a version: a breaking change to either moves both.

### Risks

- **The plugin doesn't fit our setup.** Mitigated by the spike before
  anything is built on it; if it fails, this ADR is revisited before any app
  is told to use OAuth.
- **A public field's meaning has to change.** Mitigated by keeping the
  field lists short and by ADR-013's discipline of upgraders; if it happens,
  it's a `v2`.
- **Mapping drift**: a public read disagreeing with what the app shows.
  Mitigated by tests that build both from the same series.
- **A web page holding tokens.** A browser-only app keeps its tokens in the
  page; short access tokens, workspace-limited grants and per-app revocation
  bound the damage.
- **The first apps find the calls awkward.** Expected. The preview label
  lets their developers' feedback change the calls before the promise
  starts, while the registered apps are the only ones depending on them.
  With the label off (2026-10-26), an awkward call is fixed by adding to it,
  or waits for a `v2`.

## Related Decisions

- [ADR-009](009-api-and-cli.md): keyed access to `/api/v1` and the CLI;
  its M5, M6 and M8 are replaced here.
- [ADR-013](013-removing-meaning-from-stored-formats.md): the discipline for
  changing stored meaning, which public fields inherit.
- [ADR-014](014-finding-published-results.md): the indexes that find
  publications.
- [ADR-015](015-published-results-api.md): the publications part, amended as
  §6 describes.
- #701: implementing the authenticated part (§1–§3, §5, §6).
- #700: OAuth for outside apps and the CLI (§4).
- #695, #696, #697, #698: the calls and changes §3 depends on.
- #671: finish submissions, set aside from this decision and built on it
  afterwards: the `submissions` scope in §4.

## References

- Better Auth OAuth provider plugin:
  `https://www.better-auth.com/docs/plugins/oauth-provider`
  (`@better-auth/oauth-provider`, MIT).
- RFC 6749 (OAuth 2.0), RFC 7636 (PKCE), RFC 8628 (device authorization
  grant), RFC 8252 (OAuth for native apps).
- The ORC constructed course document reader: `lib/orc-constructed-course.ts`.
