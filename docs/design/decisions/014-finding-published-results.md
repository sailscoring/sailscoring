# ADR-014: Finding published results — indexes, the directory, and the race schedule

**Status:** Proposed. Decisions 1–3 (the publish-time summary, the
workspace and season `index.json`, and the public directory) are accepted
and implemented (#669, #670). Decision 4 (the race schedule, as a Schedule
page) is proposed; its open questions are listed at the end of the
Decision. Amended by [ADR-015](015-published-results-api.md), which serves
the schedule's JSON from the published results API.

**Date:** 2026-10-14

**Deciders:** Mark McLoughlin

## Context

[ADR-011](011-public-results-navigation.md) made the public results surface
a tree: workspace → season → event → page, browsable by a person through
index pages and one navigation cascade.
[ADR-012](012-data-behind-published-results.md) put the data behind every
published series beside its pages as a CORS-open `.sailscoring.json` file.
Between them, a person can browse anything published, and a program can read
any series it is given the URL of.

What neither covers is a program **finding** what is published. The prompt
was RaceOps (racing.gbsc.ie), the race-day app Galway Bay SC runs, written by
Fergal Lyons. It reads results and the club's racing schedule from HalSail's
public API, and he asked what the Sail Scoring equivalent would be. HalSail's
API (`halsail.com/HalApi`, read-only JSON) answers by listing:

| HalSail | What it returns |
|---|---|
| `GetEvents/{club}` | Event id, name, notes, web site |
| `GetSchedule/{club}`, `GetScheduleForEvent/{event}` | One row per race: class, series, race name, status, start date and time, notes, race id |
| `GetClasses/{club}`, `GetSeries/{id}`, `GetSeriesResult/{id}`, `GetRace/{id}`, … | The entities behind each listing, by id |

Three gaps followed:

1. **No listing of a workspace's publications.** An integrator had to scrape
   the HTML index pages or hard-code one data-file URL per series and update
   it every season.
2. **Nothing above a workspace.** `/p/` was a dead end; finding a club's
   results needed its link.
3. **No schedule.** HalSail's `GetSchedule` lists races before they are
   sailed: the demo club's returns `Provisional` rows beside `NoResultsYet`
   ones, each with a local start date and time. Sail Scoring has the same
   data — the Races tab's recurring generator creates a season's races in
   advance with their dates, and with a default start sequence each start's
   gun time — but publishing drops every race with no boat rows
   (`dropUnsailedRaces` in `lib/results-export.ts`), deliberately, so an
   unsailed race never prints as a column of DNCs. A series with no entries
   cannot be published at all.

### Scope: the schedule of the races it scores

The schedule request was framed as Sail Scoring becoming "the single source
of truth for all racing events". That is wider than this ADR goes, and the
boundary is worth stating once. HalSail's schedule is its races table: a race
exists before it is sailed because the scorer created it. It carries no
venue, no notice of race, no social or training events.

Sail Scoring takes the same line. It publishes **the schedule of the races
in the series it scores**: what the scorer has already entered in order to
score. Out of scope: events nobody scores (socials, training, prize-givings),
NoR and SI documents, entry and registration, and live race-day signals such
as a postponement announced on the water. A club calendar can be built from
this data; Sail Scoring is not one.

## Decision Drivers

- **Publishing is the consent.** Nothing becomes public except by a scorer
  publishing it ([ADR-008](008-full-stack-transition.md),
  [ADR-011](011-public-results-navigation.md)). A new public surface lists
  what is published; it does not reach past that.
- **Machine-readable output follows the latest publish.** The data file and
  the publish-time summary are rebuilt from the series every time anything
  is published, whichever pages were ticked. That is the one rule a scorer
  can hold in their head. The HTML pages are what lags: each changes only
  when it is ticked.
- **The same serving rules as the data file.** No auth, `Access-Control-
  Allow-Origin: *`, `application/json`, an `ETag` a poller can send back,
  the workspace's CDN purge tag. An integrator learns one set of rules.
- **Versioned like the public export.** Adding a field does not change the
  version; removing one or changing what one means does.
- **One document per question.** Prefer adding to an existing listing over a
  second endpoint that restates it.
- **Stay inside scoring.** See Scope above.

## Considered Options

Decisions 1–3 were settled in #669 and #670 and are recorded below as
decided. The options here are for the schedule.

### Option 1: A separate `calendar.json`

`/p/{ws}/calendar.json` and `/p/{ws}/{season}/calendar.json`: a flat,
time-ordered list of races across every published series, shaped like
HalSail's `GetSchedule`.

**Pros:**
- Closest to what RaceOps reads today; no sorting or merging client-side.

**Cons:**
- Half of each entry restates `index.json` (series name, URL, data file,
  fleets, when published). A mock built to review the shape had a `series`
  section that was `index.json`'s publication list cut down.
- A second endpoint, document and version to maintain for the same data.

### Option 2: A live, opt-in schedule

A per-series "publish the race schedule" setting that serves the live
series' races publicly, so a changed date shows without republishing.

**Pros:**
- A postponement is visible as soon as the scorer edits the date.

**Cons:**
- A second consent act beside publishing, and a second thing a scorer has
  to remember is public.
- A scorer generating a tentative run of dates has them public at once.

### Option 3: Unsailed races in the data file

Stop dropping unsailed races from the `.sailscoring.json` file and mark
them unsailed.

**Pros:**
- No change to the indexes at all.

**Cons:**
- An integrator has to fetch every series' data file to build a schedule —
  the problem #669 solved for results.
- Every existing reader of the data file meets races with no results and
  has to learn to skip them.
- No way to publish a schedule without publishing it for every series.

### Option 4: A schedule in the summary, always present

Every publish records every race, sailed or not, as a `schedule` field on
each publication in `index.json`.

**Pros:**
- No new endpoint; inherits the serving rules and the ETag.

**Cons:**
- Publishing results publishes the schedule too, whether the scorer meant
  to or not; there is nothing to untick.
- A scorer who only wants to push a date change has to publish results
  pages to do it.

### Option 5: A Schedule page, with its JSON in `index.json`

Schedule becomes a page in the publish dialog, beside Prizes and Entries:
an HTML view of the series' races, and a `schedule` field on the
publication in `index.json` while the page is published.

**Pros:**
- The scorer decides, with the control they already use for every other
  page. Ticking only Schedule pushes a schedule update and leaves every
  other page as it was.
- No new endpoint; `/p/{ws}/{season}/index.json` already serves the URL
  RaceOps asked for, with the serving rules and the ETag.
- Sailors get a page too, not just apps.
- An app wanting a flat calendar merges each publication's `schedule` and
  sorts by date — a few lines.

**Cons:**
- The indexes get bigger. A race entry is roughly 200 bytes, so a club
  season of a few hundred races adds tens of kilobytes to that season's
  index, and the workspace index, which spans every season, grows by the
  same amount each year.
- A changed date needs a publish to show (as a changed result does).

## Decision

### 1. A publish-time summary (accepted, implemented — #669)

`published_series.summary` (jsonb) is computed when a series is published,
on the live and the as-published archive paths alike, from the same snapshot
the data file is built from: first and last race date, races sailed, boats,
fleets with their scoring systems, and whether it is a split-fleet
championship or an as-published archive. Public indexes read only this
column, never the live series. Rows published before the column existed are
filled by the `publication-summaries` operator script from each row's own
data file, its as-published tables, or the live series where that is
unchanged since the publish; the rest read `null` until republished.

The summary and the data file are rebuilt on **every** publish, whichever
pages are ticked; only the ticked HTML pages change. So the machine-readable
outputs always agree with each other and with the series as it was last
published, while an unticked page can show older results than the data
file beside it. That is deliberate: "the data file is updated whenever you
publish anything" is the rule a scorer can predict. The data file began as
a transparency measure ([ADR-012](012-data-behind-published-results.md))
and is becoming an API; if apps built on it start to trip over pages
lagging the file, the answer is a machine-readable version of each page
beside the full file, not a data file that follows the ticks.

> **Superseded in part by [ADR-015](015-published-results-api.md):** rather
> than a JSON twin of each page, apps get a versioned, display-shaped
> published results API, and the data file stops being the app-facing
> format. The rule above — machine-readable output follows the latest
> publish — stands, and applies to that API.

### 2. Workspace and season indexes (accepted, implemented — #669)

`/p/{ws}/index.json` lists every publication in the workspace;
`/p/{ws}/{season}/index.json` the ones filed under one season, for both the
live and the archive (slug-is-season) shape. One entry per publication (per
series), not per slug, because an archive year files dozens of series under
one slug. Each entry carries the series name, season, folder and event, its
pages (labelled and classified as the published navigation does), its data
file URL or `null`, its fleets, `publishedAt`, and the summary's dates and
counts. Slugs cannot contain a dot, so `index.json` cannot shadow a page.
Declared on the HTML index pages as `<link rel="alternate"
type="application/json">`. The format is documented in
[`public-index-format.md`](../../public-index-format.md), `version: 1`.

### 3. The public directory (accepted, implemented — #670)

`/p` lists the club workspaces publishing with Sail Scoring, and
`/p/index.json` is its machine-readable twin, linking each workspace's
`index.json`. A program can walk from the directory to any series' data
without being given a URL.

- Club workspaces with at least one publication are listed; personal
  workspaces never are.
- Listing defaults on. A workspace can opt out, and give a one-line
  description, in workspace settings (stored in `organization.metadata`).
  An unlisted workspace's pages stay public at their own URLs.
- The directory is built from the summaries, so it never opens page lists or
  data files. It has its own CDN tag (`p:directory`), purged on publish,
  unpublish and directory-setting changes.
- The directory page is indexable; the workspace pages beneath stay
  `noindex`.

### 4. The race schedule (proposed)

> **Amended by [ADR-015](015-published-results-api.md):** the schedule's JSON
> is served as the published results API's `schedule` resource, and the
> publication's entry in `index.json` links it rather than carrying the
> races. The Schedule page, its consent model and the race shape below
> stand.

**A Schedule page.** The publish dialog gains a Schedule page, a fixed page
like Prizes and Entries (`kind: 'schedule'`), which the scorer ticks or
leaves unticked like any other. It lists the series' races by date, grouped
by month: the date, the race number and name, and each start's gun time and
fleets. A race with results links to them. A dated list rather than a month
grid: a weekly series leaves a grid mostly empty, and a list reads on a
phone.

To push a schedule change, the scorer ticks only Schedule. Every other page
stays as it was; the data file and the summary are rebuilt, as on any
publish (Decision 1).

**Its JSON in `index.json`.** While a publication's Schedule page is
published, its entry in `index.json` carries a `schedule`: every race in the
series, sailed or not, in race order. The page appears in the entry's
`pages` with `kind: "schedule"`.

```jsonc
"schedule": [
  {
    "race": 4,
    "name": null,                         // the race's own label, e.g. "Round the Islands"
    "date": "2026-10-11",                 // local date
    "starts": [                           // one per gun; the fleets that go on it
      { "time": "10:55:00", "fleets": ["Cruisers 1"] },
      { "time": "11:00:00", "fleets": ["Cruisers 2", "White Sails"] }
    ],
    "status": "sailed",                   // sailed | scheduled
    "results": "https://app.sailscoring.ie/p/gbsc/autumn-league/race-4"
  },
  {
    "race": 5, "name": null, "date": "2026-10-18",
    "starts": [{ "time": null, "fleets": ["Cruisers 1", "Cruisers 2", "White Sails"] }],
    "status": "scheduled"
  }
]
```

- **Present while the Schedule page is.** Absent means the series does not
  publish a schedule; an empty list means it publishes one with no races.
  Unpublishing the page drops the field.
- **Rebuilt with the summary**, on every publish once the page has been
  published, so it follows the same rule as the data file: a race is
  `sailed` exactly when the data file has its results.
- **One entry per race, not per start.** A Sail Scoring race is one start
  sequence across fleets (#346); its `starts` list each gun. A start may
  have no time (a second race "as soon as possible after") and a race may
  have no starts (dates generated without a start sequence).
- **`status` is derived, not stored.** `sailed` means the race has boat
  rows; `scheduled` means it has none. A past race still `scheduled` was
  blown out, abandoned, or not yet entered; the schedule does not say which.
- **`results`** links the race's own results page where the series
  publishes one per race (#654), otherwise its standings. Absent while
  scheduled.
- **Times are local clock times**, as the scorer entered them, in the
  instance's time zone. One zone applies to every workspace and series on
  an instance, and the indexes and the data file declare it in a top-level
  `timeZone` field (#684). HalSail's times are local too, but undeclared.
- **The other pages and the data file are unchanged.** An unsailed race
  still never prints on a results page or appears in the data file.
- **`races`, `firstRaceDate` and `lastRaceDate` keep their meaning**
  (sailed races only). The new field is named `schedule` because `races` is
  already the count.
- **Adding it does not change `version`.** A v1 reader ignores it.

**Publishing before the season.** A series can publish its Schedule page
before any race is sailed and before it has entries — today a series with
no competitors cannot be published at all. Before the first race the
build makes no data file, so a schedule-only publication lists its
`schedule`, its one page, and `data: null`.

#### To finalise

- **A publication that is only a schedule.** Where its landing URL points
  (it has no standings page), and how the season and event index pages
  list it.
- **Cancelled and abandoned races.** Not modelled. Worth adding only if a
  scorer or integrator needs to tell a cancelled race from one awaiting
  results.
- **An `.ics` feed.** Sailors could subscribe to a season in a phone
  calendar. It would be generated from the same `schedule`, so needs no
  data of its own; whether it belongs inside the scope above is a separate
  call.

## Consequences

### Positive

- An integrator reaches any published series' data, and its schedule, from
  `/p/index.json` without being given a URL — the HalSail listing endpoints'
  job, done by documents the tree already implied.
- The machine-readable outputs — the data file, the indexes, the directory
  — always agree with one another.
- RaceOps can replace HalSail's `GetSchedule` with the season `index.json`
  it already polls for results.
- A scorer can push a schedule change without touching any results page.
- The directory puts real, scored events in front of anyone weighing up the
  app.

### Negative

- An HTML page can lag the data file beside it: the results pages a scorer
  leaves unticked keep showing what they last published, while the file
  moves on. Publishing only the Schedule mid-season publishes the latest
  results in the data file.
- Publishing before racing starts is a new state the index pages must
  render sensibly.
- A schedule change needs a publish to reach the public indexes.
- The indexes grow with every race scheduled; the workspace index, spanning
  every season, most of all.

### Risks

- **Scope drift toward event management.** Each step (venues, notices,
  cancellations, entries) is small and plausible. Mitigated by the Scope
  section: the schedule is what the scorer enters to score, and nothing is
  entered only for the calendar.
- **A stale schedule.** A scorer who postpones a race but forgets to
  publish leaves the old date public. The same is true of results today.
  Mitigated by the Races tab saying when an unsailed race's date or gun
  time differs from the published schedule.
- **Apps reading the data file against the pages.** An app that shows the
  data file next to links to the HTML pages will sometimes show newer
  results than the page it links to. If that starts to matter, publish a
  machine-readable version of each page beside the full file (Decision 1).

## Related Decisions

- [ADR-011](011-public-results-navigation.md): the publication tree these
  indexes are the machine-readable twin of; seasons and folders as defined
  there.
- [ADR-012](012-data-behind-published-results.md): the data file every
  index entry links. Unsailed races stay out of it. Decision 1 records that
  it follows the latest publish, and the per-page direction if that stops
  being enough.
- [ADR-010](010-as-published-archives.md): archive publications carry a
  summary like any other, built from their as-published tables. They
  publish no Schedule page.
- [ADR-008](008-full-stack-transition.md): the publishing model and its
  consent rule.
- [ADR-015](015-published-results-api.md): the published results API, which
  supersedes the per-page JSON direction and serves the schedule.

## References

- #669 — the workspace and season `index.json`, and the publish-time
  summary.
- #670 — the public directory at `/p` and `/p/index.json`.
- #671 — finish sheet submissions, the race-day write path that the same
  integrator asked about.
- #684 — declaring the instance time zone in the data file and indexes.
- #237 — the recurring race generator that creates a season's races ahead.
- #556, #513 — why publishing drops unsailed races.
- [`docs/public-index-format.md`](../../public-index-format.md),
  [`docs/public-export-format.md`](../../public-export-format.md).
- HalSail API documentation, `https://halsail.com/HalApi` — now states an
  API key is required, though its sample endpoints answer without one.
