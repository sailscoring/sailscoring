# ADR-015: The published results API

**Status:** Accepted (2026-10-24)

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
  `echoByFleet`), scoring settings, and a per-competitor `ref` that is unique
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
- **Standings** per fleet, as published: rank, the competitor's
  displayed details, total and net, each race's score as printed.
- **Race results**: a race's finishing order, times and points per fleet.
- **The schedule**: races to come, with dates and gun times (ADR-014,
  Decision 4).
- **Change detection**: knowing cheaply when to fetch again.
- **Stable identity**: following a competitor from one publish to the next.

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

### Option 3: A versioned public results API over a published view

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
  the same published view.
- Resources can follow the pages that show them, as Option 1's files do,
  without taking the pages' shapes.

**Cons:**
- The most to build and maintain: routes, a published view, a spec, a
  policy.
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
- Better as renderings of the same published view than as the API itself.

## Decision

Adopt **Option 3: a versioned public results API over a published view.**

### 1. The published view

When a series is published, alongside the data file and the summary, Sail
Scoring computes its **published view**: the publication as the pages
present it, stored for the API to serve.

- **Display-shaped.** Standings rows carry rank, the competitor's displayed
  details, total, net and one cell per race. Each cell has its points, code,
  whether it was discarded, and `display`: the text the page prints
  (`"(4) DNF"`), so an app never reimplements the formatting.
- **What the pages show, and nothing more.** Only the competitor columns the
  series displays; officials and track data only when the series publishes
  them. Unsailed races stay out of standings and race results.
- **It follows the pages.** Every publish computes the published view from
  its snapshot, but a resource is replaced only when a page that shows its
  data is ticked: a fleet's standings with the standings page that shows
  that fleet, a race's results with the page that publishes them, the
  competitors with the Entries page, the schedule with the Schedule page.
  A resource goes when the
  last page showing it is unpublished. The publication resource changes on
  every publish and says when each of the others last did. So the API
  agrees with the pages, and can lag the data file and the index summary,
  which follow every publish whatever is ticked (ADR-014, Decision 1).
- **Stored per resource**, in Blob storage, replaced when its page is
  republished, and removed with the publication.
- **Scoring internals stay out.** No rating intermediates, no scoring
  settings beyond what a page states (the discard rule's wording, say). A
  new scoring feature adds a flag to a cell at most.
- **As-published archives are served too**
  ([ADR-010](010-as-published-archives.md)), in the same resources. Their
  tables are what the source printed, so a cell's `display` is the
  published text and its points and code are absent; a row's rank is the
  structured rank the archive already holds. Standings carry the source's
  column headings as published. Race results exist where the source
  published per-race tables. The publication says it is an archive, as
  the index entry already does.

### 2. The resources

Under `/api/public/v1/`. GET only, no authentication,
`Access-Control-Allow-Origin: *`, JSON:

| Resource | Holds |
|---|---|
| `…/v1/publications/{id}` | The publication: series name, season, folder, fleets, pages, `publishedAt`, links to the resources below and when each was last published |
| `…/v1/publications/{id}/standings` | Every fleet's standings; `…/standings/{fleet}` for one |
| `…/v1/publications/{id}/races` | The sailed races: number, name, date, starts |
| `…/v1/publications/{id}/races/{n}` | One race's results per fleet: finishing order, times, corrected times where scored on them, points and codes |
| `…/v1/publications/{id}/competitors` | The entry list: each competitor with the columns the series displays, while it publishes its Entries page |
| `…/v1/publications/{id}/schedule` | Every race, sailed or not, while the series publishes a Schedule page (ADR-014, Decision 4) |

- **`/api/public/`, not `/p/`.** `/p/` is the tree of published pages and
  files, where every path segment is a workspace, season, folder or page
  slug. An API inside it would claim names from that space, or read as
  though it belonged to whichever slug it sat under. A prefix of its own
  keeps it apart from the tree and from the keyed `/api/v1`, and needs its
  own Bot Protection bypass in `vercel-firewall.json`: without one every
  program gets the challenge as a 429 (DEPLOY.md).
- **A race's results follow the race.** `races/{n}` changes when the
  race's results are published: on the series' race results page where
  it has one (a split-fleet championship's), otherwise on the standings
  pages whose columns show it. It can be newer than `standings`, which follows the standings
  pages; `races` changes when any of its races does.
- **Shapes beyond a fleet table** fit the same resources. A split-fleet
  championship's standings are one ranking named "Championship", as its
  pages and the data file already present it; the repêchage and cut-from
  tables its page prints beside the ranking stay on the page. A sub-series
  publication's standings hold a table per sub-series and fleet, each
  naming its sub-series, rather than taking it as a parameter: the API
  takes no query parameters (§7).
- **Times are declared.** Every resource carries the instance's
  `timeZone`, as the indexes and the data file do; local dates and times
  are in it, and timestamps ending in `Z` are UTC.
- **Each resource has its own `ETag`**, and is served with the CDN floor and
  the workspace purge tag, as the `/p` JSON is today. A poller checking one
  fleet's standings pays for one fleet.
- **The publication id** is opaque and stable for the life of the
  publication. It is not a series id: unpublishing ends it.

### 3. Identity

Fleets are named and races numbered, as in the data file. Competitors need
more: an app following a competitor across publishes cannot use the data
file's `ref`.

- Each competitor carries an `id` that is **the same in every resource and
  every publish of the series**, and reveals nothing about internal ids: a
  keyed hash of the series and the competitor's internal id. The series is
  in the hash, so the same sailor's ids in two series are unrelated.
- **The key is per instance, and may be rotated.** A rotation changes every
  `id` at once, which an app sees as a series re-keyed between one fetch
  and the next. That needs no deprecation period: an `id` promises
  consistency within a series, and nothing an app should keep longer
  depends on it.
- Where the workspace publishes competitor pages, a competitor also carries
  its **cross-series identity**, the slug its public timeline already uses
  (`/p/{ws}/competitor/{slug}`). That is the identity to keep, and a key
  rotation never changes it.

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
- **A breaking change is a new version**, and the old one keeps serving
  for **a year** after the new one ships, with `Deprecation` and `Sunset`
  headers. Serving an old version is a second published view computed
  at publish, which costs little; a year covers a club app's off-season.
- **The spec is published**: an OpenAPI 3.1 description generated from the
  Zod schemas that define the responses, using the machinery ADR-009 §10
  set out, served beside the API.
- **The published view is versioned with the API**, not with the data file. The
  data file keeps its own versions, and can keep changing with the scoring
  model.

### 6. The data file

`.sailscoring.json` stays published: it is the transparency measure ADR-012
made it, it is what the read-only viewer and "Open in Sail Scoring" read, and
it is how a copy of a series is imported. Its format doc says it is not an
app API and points to this one. ADR-014's proposed per-page JSON is
superseded by this decision.

### 7. Serving cost and rate limiting

The infrastructure costs that move with load are Neon's compute, billed for
the time the database is awake, and Vercel's metered lines beyond the Pro
plan's allowances. A read API polled by race-day apps and clubhouse screens
should move neither. Three rules:

- **No database on the read path.** A resource is found from its URL alone:
  the publication id names its storage, so a request is one Blob read and
  never wakes Postgres. An unknown id or resource is a 404 from storage, not
  a query. Unknown query parameters are a 400, so varying them cannot be
  used to get past the cache.
- **The CDN takes the polling.** Resources are served with the `/p` JSON's
  CDN floor and the workspace purge tag, so polling faster than the floor
  costs edge requests only, and an `If-None-Match` poll costs a 304.
- **No rate-limit rule at the start.** The WAF meters every request a
  rate-limit rule inspects, cached ones included, beyond 1M a month on Pro;
  a rule over the API would make its cheapest requests the only billed
  ones. A per-IP limit also falls hardest on a clubhouse, where every phone
  on the club's wifi shares an address. Instead `vercel-firewall.json`
  carries the rule inactive, to enable if the usage graphs show abuse.
  Until then, keeping the database off the read path is what bounds the
  cost.

## Consequences

### Positive

- Apps get a contract shaped for what they show, with a spec and a
  deprecation policy, and can pin a version.
- The data file and the scoring model are free to change for their own
  reasons; ADR-013's careful removals no longer have third-party apps
  behind them.
- One app (RaceOps) to move now, rather than an ecosystem later.
- An app follows a competitor across publishes, and across series where
  the workspace publishes competitor pages.
- The same published view can later render as `.ics`, XRR, or a big-screen
  display without new data.

### Negative

- A new public surface to build, document and keep stable: routes, the
  published view, the spec, the policy.
- Three machine-readable products per publication (the data file, the
  summary, the published view) under two rules: the data file and the summary
  follow every publish, the API follows the pages. An app comparing the
  index's race count with the standings resource can find them apart.
- One publication's resources can come from different publishes (last
  week's standings, today's schedule); each says when it was published.
- Two public APIs with different rules: this one, unauthenticated and
  serving what was published, and ADR-009's keyed one, serving the live
  series.

### Risks

- **The published view drifts from the pages.** Two renderings of the same
  snapshot can disagree. Mitigated by building the HTML pages and the
  published view from shared row and cell models where they exist (the cell's
  `display` is the renderer's own text), and by tests comparing the two.
- **Display shape leaks presentation.** A layout change (a new page kind,
  a regrouped table) could still tempt an API change. Mitigated by keying
  resources on fleets and races, which outlive layouts, never on pages.
- **Apps keep reading the data file.** Mitigated by the format doc's
  pointer, by the index linking both, and by moving RaceOps first.
- **Uncached load.** A poller ignoring ETags, or a scraper walking every
  publication, costs function invocations and Blob reads. Bounded by
  keeping the database off the read path, and by the inactive rate-limit
  rule (§7).

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
