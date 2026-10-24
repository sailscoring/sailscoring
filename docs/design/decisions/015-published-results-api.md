# ADR-015: The published results API

**Status:** Proposed

**Date:** 2026-10-14

**Deciders:** Mark McLoughlin

## Context

[ADR-012](012-data-behind-published-results.md) published the data behind
every results page as a `.sailscoring.json` file beside it, and
[ADR-014](014-finding-published-results.md) gave programs a way to find
those files: the directory at `/p/index.json` and each workspace's and
season's `index.json`. Between them, an app can now reach every published
series' data without being given a URL.

Apps have started to. RaceOps, the race-day app Galway Bay SC runs
(racing.gbsc.ie, written by Fergal Lyons), reads results and its race
schedule from HalSail's API and asked what the Sail Scoring equivalent is.
The honest answer today is the data file, and the data file was not built
for that:

- **It is shaped for re-scoring.** ADR-012's contract is "everything needed
  to re-score the published results": per-race arrays positional against
  the race list, rating inputs and intermediates (`nhcByFleet`,
  `echoByFleet`), scoring settings, and a per-boat `ref` that is unique
  within one export and means nothing in the next. An app that wants a
  fleet's standings has to rebuild what the page already prints.
- **Its version follows the scoring model.** It went from v1 to v9 between
  29 August and 10 October 2026: the `clubs` list, the split-fleet carry
  settings, the repêchage, per-fleet ranking, magnetic courses. Each was
  right for the format's purpose. Each was a breaking change for a reader
  that only wanted to show a table.
- **Whatever an app reads becomes a field we cannot remove.**
  [ADR-013](013-removing-meaning-from-stored-formats.md) already makes
  removing meaning from a stored format careful work. An app ecosystem built
  on the data file would make the scoring model's evolution answer to
  whichever fields third parties happened to depend on.

ADR-014 recorded the first response to this. If apps tripped over HTML
pages lagging the data file, the answer would be a machine-readable version
of each page beside it. This ADR revisits that while there is one app to
move rather than many, and asks the larger question: what should apps build
on?

### What apps need

From RaceOps and the horizon's clubhouse big-screen display:

- **Find** a club's series: done by ADR-014's indexes.
- **Standings** per fleet, as published: rank, the boat's displayed
  details, total and net, each race's score as printed.
- **Race results**: a race's finishing order, times and points per fleet.
- **The schedule**: races to come, with dates and gun times (ADR-014,
  Decision 4).
- **Change detection**: knowing cheaply when to fetch again.
- **Stable identity**: following a boat from one publish to the next.

None of them needs the scoring inputs.

## Decision Drivers

- **A contract shaped for display.** Apps show results; they should not
  have to re-derive the printed table from scoring inputs.
- **Versioned apart from the scoring model.** A new scoring feature should
  rarely change what an app reads, and never break it.
- **Publishing is the consent.** The API serves what was published, never
  the live series ([ADR-008](008-full-stack-transition.md)), and only what
  the pages show (ADR-012's privacy contract).
- **The API shows what the pages show.** A resource changes when the page
  that shows its data is published, and exists only while that page does.
  Publishing only the entry list changes no results. An app then agrees
  with the pages it links to, and the scorer's ticks mean the same to an
  app as to a sailor.
- **Documented and stable.** Apps need a spec, a version they can pin,
  and notice before anything goes away.
- **Cheap to serve.** Unauthenticated, polled, CDN-cached: the cost model of
  the existing `/p` JSON, not of an authenticated live API.
- **Find from what exists.** Discovery already works; do not build it twice.

## Considered Options

### Option 1: A `.json` beside every HTML page

Each published page gains a JSON twin at its own path, rendered from the
same input as the page.

**Pros:**
- Agrees with its page by construction, including the per-page lag.
- Static, simple to serve, simple to explain.

**Cons:**
- The API takes the shape of the page layout. Publishing groups, combined
  pages, sub-series grids, split-fleet pages, prize sheets and entry lists
  each become their own JSON shape, and a layout change becomes an API
  change.
- An app wanting "the standings for Class 1" has to know which page that
  fleet landed on in this series' layout.
- Versioning is spread across as many shapes as there are page kinds.

### Option 2: One display-shaped results file per publication

Split today's data file in two: `.sailscoring.json` keeps transparency and
import, and a new results file per publication holds standings and race
results as the pages show them. Static, linked from `index.json`.

**Pros:**
- Cheap: the same pattern as the data file and the indexes.
- Display-shaped and versioned on its own, so the scoring model can move
  freely.

**Cons:**
- One whole-series fetch whatever the app wants; a big championship's file
  is large and a phone app wants one fleet.
- A file, not an API: no resource model, no spec, no obvious place for the
  schedule, change detection per resource, or the next resource.

### Option 3: A versioned public results API over a publish-time projection

Option 2's display-shaped document, computed at publish and stored, served
as read-only resources under a versioned path: a publication, its standings,
its races, a race's results, its schedule. Documented with OpenAPI, with a
stability and deprecation policy.

**Pros:**
- A real contract: version in the path, a published spec, a deprecation
  policy.
- Apps fetch what they show; ETags per resource make polling cheap.
- Display-shaped and decoupled from the scoring model, as Option 2.
- Room to grow: the schedule, an entry list, an `.ics` or XRR rendering of
  the same projection.
- Resources can follow the pages that show them, as Option 1's files do,
  without taking the pages' shapes.

**Cons:**
- The most to build and maintain: routes, a projection, a spec, a policy.
- A request whose CDN cache has expired reads storage, where a static file
  would not.

### Option 4: Open the keyed `/api/v1` to third parties

[ADR-009](009-api-and-cli.md)'s API already serves series, races and
standings to the CLI.

**Pros:**
- Exists; M6 and M8 already plan its spec and its public documentation.

**Cons:**
- It reads the live series. A result entered but not published would reach
  the app, which breaks publishing as the consent.
- Each app needs a key from each club, and the API's shape is the editing
  model, not what a results page shows.
- Right for a club's own tools; wrong for public results.

### Option 5: A standard interchange format

World Sailing's XRR for results, iCal for the schedule.

**Pros:**
- Existing parsers; no format of our own to document.

**Cons:**
- XRR is XML and shaped for regattas; club handicap series, sub-series and
  split-fleet championships fit it badly.
- Neither covers discovery, standings as printed, or change detection.
- Better as renderings of the same projection than as the API itself.

## Decision

Adopt **Option 3: a versioned public results API over a publish-time
projection.**

### 1. The projection

When a series is published, alongside the data file and the summary, Sail
Scoring computes a **results projection**: the publication as the pages
present it.

- **Display-shaped.** Standings rows carry rank, the boat's displayed
  details, total, net and one cell per race. Each cell has its points, code,
  whether it was discarded, and `display`: the text the page prints
  (`"(4) DNF"`), so an app never reimplements the formatting.
- **What the pages show, and nothing more.** Only the competitor columns the
  series displays; officials and track data only when the series publishes
  them. Unsailed races stay out of standings and race results.
- **It follows the pages.** Every publish computes the projection from
  its snapshot, but a resource is replaced only when a page that shows its
  data is ticked: a fleet's standings with the standings page that shows
  that fleet, the schedule with the Schedule page. A resource goes when the
  last page showing it is unpublished. The publication resource changes on
  every publish and says when each of the others last did. So the API
  agrees with the pages, and can lag the data file and the index summary,
  which follow every publish whatever is ticked (ADR-014, Decision 1).
- **Stored per resource**, content-addressed, superseded when its page is
  republished, and removed with the publication.
- **Scoring internals stay out.** No rating intermediates, no scoring
  settings beyond what a page states (the discard rule's wording, say). A
  new scoring feature adds a flag to a cell at most.

### 2. The resources

GET only, no authentication, `Access-Control-Allow-Origin: *`, JSON:

| Resource | Holds |
|---|---|
| `…/v1/publications/{id}` | The publication: series name, season, folder, fleets, pages, `publishedAt`, links to the resources below and when each was last published |
| `…/v1/publications/{id}/standings` | Every fleet's standings; `…/standings/{fleet}` for one |
| `…/v1/publications/{id}/races` | The sailed races: number, name, date, starts |
| `…/v1/publications/{id}/races/{n}` | One race's results per fleet: finishing order, times, corrected times where scored on them, points and codes |
| `…/v1/publications/{id}/schedule` | Every race, sailed or not, while the series publishes a Schedule page (ADR-014, Decision 4) |

- **Shapes beyond a fleet table** fit the same resources. A split-fleet
  championship's standings are one ranking named "Championship", as its
  pages and the data file already present it. A sub-series publication's
  standings take the sub-series as a parameter.
- **Times are declared.** Every resource carries the instance's
  `timeZone`, as the indexes and the data file do; local dates and times
  are in it, and timestamps ending in `Z` are UTC.
- **Each resource has its own `ETag`**, and is served with the CDN floor and
  the workspace purge tag, as the `/p` JSON is today. A poller checking one
  fleet's standings pays for one fleet.
- **The publication id** is opaque and stable for the life of the
  publication. It is not a series id: unpublishing ends it.

### 3. Identity

Fleets are named and races numbered, as in the data file. Boats need more:
an app following a boat across publishes cannot use the data file's `ref`.

- Each boat carries an `id` that is **stable across every publish of the
  series** and reveals nothing about internal ids: derived from the
  competitor's internal id with a keyed hash.
- Where the workspace publishes competitor pages, a boat also carries its
  **cross-series identity**, the slug its public timeline already uses
  (`/p/{ws}/competitor/{slug}`).

### 4. Discovery

ADR-014's documents remain the way in: `/p/index.json`, `/p/{ws}/index.json`
and `/p/{ws}/{season}/index.json`. Each publication entry gains an `api`
link to its publication resource, beside the `data` link it already
carries. The API does not restate the indexes.

The schedule is the `schedule` resource, not a field in `index.json` (ADR-014,
Decision 4, Option 6). The index stays a listing and does not grow with every
race.

### 5. Versioning and stability

- **The version is in the path.** Within `v1`, changes are additive:
  new resources, new optional fields, new values where a field is documented
  as open-ended.
- **A breaking change is a new version**, served beside the old one for an
  announced period, with `Deprecation` and `Sunset` headers on the old.
- **The spec is published**: an OpenAPI 3.1 description generated from the
  Zod schemas that define the responses, using the machinery ADR-009 §10
  set out, served beside the API.
- **The projection is versioned with the API**, not with the data file. The
  data file keeps its own versions, and can keep changing with the scoring
  model.

### 6. The data file

`.sailscoring.json` stays published: it is the transparency measure ADR-012
made it, it is what the read-only viewer and "Open in Sail Scoring" read, and
it is how a copy of a series is imported. Its format doc says it is not an
app API and points to this one. ADR-014's proposed per-page JSON is
superseded by this decision.

### To finalise

- **Which page a resource follows where two show the same data.** A race's
  results appear in the standings pages' race columns and, where the
  series publishes them, on the race's own page; publishing one of those
  without the other must leave `races/{n}` meaning something definite.
- **The URL prefix.** `/api/public/v1/` keeps the API apart from both the
  page tree and the keyed `/api/v1`; under `/p/` it would share the existing
  public-path caching. Either way the index links it, and the API needs
  its own Bot Protection bypass in `vercel-firewall.json`: the existing
  `/p/` rules name the data files and indexes, not the whole tree, and
  without one every program gets the challenge as a 429 (DEPLOY.md).
- **As-published archives.** Their results are tables as originally
  published, with whatever columns the source printed. Whether v1 serves
  them in the same shapes, in a looser one, or not at all.
- **The entry list.** A `competitors` resource while the series publishes
  its Entries page.
- **The deprecation period.** How long an old version keeps serving.
- **Rate limiting.** The CDN absorbs polling. The bypass above takes the
  API out of Bot Protection, so an uncached client meets nothing beyond
  that today.
- **The keyed hash's key.** Per instance or per workspace, and what rotating
  it would mean (every boat's `id` changes).

## Consequences

### Positive

- Apps get a contract shaped for what they show, with a spec and a
  deprecation policy, and can pin a version.
- The data file and the scoring model are free to change for their own
  reasons; ADR-013's careful removals no longer have third-party apps
  behind them.
- One app (RaceOps) to move now, rather than an ecosystem later.
- An app follows a boat across publishes, and across series where the
  workspace has identities.
- The same projection can later render as `.ics`, XRR, or a big-screen
  display without new data.

### Negative

- A new public surface to build, document and keep stable: routes, the
  projection, the spec, the policy.
- Three machine-readable products per publication (the data file, the
  summary, the projection) under two rules: the data file and the summary
  follow every publish, the API follows the pages. An app comparing the
  index's race count with the standings resource can find them apart.
- One publication's resources can come from different publishes (last
  week's standings, today's schedule); each says when it was published.
- Two public APIs with different rules: this one, unauthenticated and
  serving what was published, and ADR-009's keyed one, serving the live
  series.

### Risks

- **The projection drifts from the pages.** Two renderings of the same
  snapshot can disagree. Mitigated by building the HTML pages and the
  projection from shared row and cell models where they exist (the cell's
  `display` is the renderer's own text), and by tests comparing the two.
- **Display shape leaks presentation.** A layout change (a new page kind,
  a regrouped table) could still tempt an API change. Mitigated by keying
  resources on fleets and races, which outlive layouts, never on pages.
- **Apps keep reading the data file.** Mitigated by the format doc's
  pointer, by the index linking both, and by moving RaceOps first.
- **Uncached load.** A poller ignoring ETags or the CDN costs storage reads.
  Mitigated by the CDN floor and per-resource ETags; rate limiting is
  listed to finalise.

## Related Decisions

- [ADR-014](014-finding-published-results.md): the indexes this API is
  found from. Its rule that the data file and summary follow every publish
  does not extend to this API, which follows the pages as its per-page JSON
  direction intended; this ADR supersedes that direction's per-page shapes
  and serves its Schedule page's JSON as the `schedule` resource.
- [ADR-012](012-data-behind-published-results.md): the data file, which
  keeps its transparency, viewer and import roles and stops being the
  app-facing format.
- [ADR-013](013-removing-meaning-from-stored-formats.md): the removal rules
  the data file follows, which this API keeps third parties out of.
- [ADR-009](009-api-and-cli.md): the keyed API and its OpenAPI machinery
  (§10), reused here. Its M8 (a documented keyed API) remains its own
  decision; this ADR's stability policy is a candidate for it.
- [ADR-008](008-full-stack-transition.md): publishing as the consent.

## References

- #685 — this API.
- #669, #670 — the indexes and directory it is found from.
- #684 — the instance time zone the API's times are declared in.
- [`docs/public-export-format.md`](../../public-export-format.md) — the data
  file's version history (v1–v9).
- [`docs/public-index-format.md`](../../public-index-format.md).
- HalSail API documentation, `https://halsail.com/HalApi` — the API RaceOps
  reads today.
