# The public export format (`.sailscoring.json`)

The public export is the data behind a published results page
([ADR-012](design/decisions/012-data-behind-published-results.md)): a
sanitized, portable snapshot of a series, published beside the pages and
free for anyone to fetch.

## Stability

The format is documented so that it can be read, but it is **not a stable
public API**. It exists so that published results can be re-scored and
imported, and it changes as the scoring model does.

- **A new version may be unreadable by an existing reader.** Any release of
  Sail Scoring may start publishing files that a reader written against an
  earlier version cannot read, without notice, a deprecation period, or a
  guarantee that the change is additive.
- **The one compatibility promise runs the other way.** Sail Scoring's own
  reader keeps reading every earlier version.
- **Versions are mixed in the wild.** A published file stays at the version
  it was written at until its series is republished, and republishing writes
  the current version. A reader meets old and new files side by side.
- **Reading tolerantly is at the reader's own risk.** An app that ignores
  fields it does not know and checks the ones it uses will often keep working
  across a new version. Nothing guarantees it. Such an app should fail
  visibly when a field it relies on is missing or reshaped, rather than show
  a half-read table.

This stance may change. The stable, display-shaped contract for apps is the
[published results API](public-api.md)
([ADR-015](design/decisions/015-published-results-api.md)).

Every export names this document in its top-level `formatDoc` field, so a
reader handed only the file can find the contract. Exports written before
the field was added lack it.

## When it changes

Publishing **any** page of a series rebuilds the file from the series as it
stands at that moment, whichever pages are ticked
([ADR-014](design/decisions/014-finding-published-results.md), Decision 1).
Publishing only the entry list rebuilds it. Between publishes it does not
change.

So the file can hold results that no page shows yet, and that the scorer
has not finished entering. A scorer who republishes the entry list halfway
through entering a race publishes that race as entered so far: the finishes
typed in, and the standings scored with them. Nothing in the file marks a
race as incomplete. The only status is the series' `resultsStatus`, which
is `final` once the scorer marks the results final, and absent while they
are provisional.

For the same reason the file can be newer than some pages beside it: a page
left unticked keeps the results it was last published with.

A series can leave the file out altogether: its Publishing settings have an
opt-out.

## Where to find it

Every publication that includes the JSON export (on by default; the
series' Publishing settings can opt out) serves one file:

```
/p/{workspace}/{slug}/{series-name}.sailscoring.json
```

- Linked from every page footer ("Data (.sailscoring.json)") and declared
  in each page's head as `<link rel="alternate" type="application/json">`.
- Also what the page's "Open in Sail Scoring" link reads: it points at
  `/open?from={path}`, which shows the series read-only with no account
  (#475). Saving a copy imports it through `/import?from={path}`.
- Served with `Access-Control-Allow-Origin: *` — browser-based tools may
  read it cross-origin.
- Listed, with every other publication of the workspace, in the
  workspace's `index.json` — see
  [the public index format](public-index-format.md) — so an app can find
  each series' file without being given its URL.
- **Rebuilt on every publish**, from the series as it stands at that
  moment — see [When it changes](#when-it-changes). Unpublishing removes
  it.
- Standalone artifacts (a downloaded page, an FTP page of a
  never-published series) carry the same JSON inline instead, base64url-
  encoded in the footer's `/import#data=` link, so they stay
  self-contained.

The suffix distinguishes the tiers: `.sailscoring.json` is the public,
sanitized view; a bare `.sailscoring` file is the scorer's private
working file, which additionally holds internal ids, FTP configuration,
and revision history and is never published.

## Contract

The export carries **everything needed to re-score the published
results, and beyond that nothing that is not in the published HTML**:

- Scoring and rating inputs travel unconditionally — finish order,
  elapsed times, result and penalty codes, redress configuration,
  ratings, discard and scoring settings — whether or not a column
  displays them. A re-import must score every race identically.
- Display-gated data follows its publish opt-in: race officials
  (`publishOfficials`) and RaceSense track data (`publishTrackData`)
  appear only when the series publishes them.
- A competitor column the series does not display is dropped, unless
  something published reads it: a prize clause keeps the field it
  selects on (club, gender, nationality, subdivision axis), and a
  split-fleet series keeps its seeding record (`seed`, `initialFleet`).
- A race start's constructed course travels: its `courseLegs`, which are
  scored, and where they came as a course, its `course` — the name, the legs
  it gave, whether the legs were then edited, and the wind — which the
  published drawing is rendered from. A course imported as an ORC
  constructed course carries the race committee's label for each leg
  (`courseLegs[*].name`) and, where it came with one, the position the first
  leg starts from (`course.anchor`). Where nothing said where such a course
  was — no anchor, and no venue position — its figures are kept as the
  document gave them, and `course.north` is `"magnetic"`: that start's leg
  bearings, winds and currents, and its course wind, are magnetic rather
  than true. Course facts are what competitors check their tracks against.
- Unresolved finish entries (a crossing recorded but matched to no
  competitor) are the scorer's work in progress and are not exported.
- `standings` is what the published pages show, scored by the engine that
  rendered them. A split-fleet championship is one ranking across its
  fleets rather than a table per fleet, so it exports a single entry named
  "Championship", holding every boat in championship order; the carried
  score that belongs to no race — a qualifying position carried into the
  final series, the medal boats' compressed opening score — travels beside
  the per-race arrays as `carriedPoints`. Where nothing is carried into the
  medal races and none has been sailed, the medal boats hold no score:
  their rows are marked `unranked`, and their `rank` is only the order they
  qualified in.
- A race still waiting for the course its ORC option corrects over is not
  scored at all: it carries 0 points and `raceExcluded` for every boat, and
  `raceNotScored` alongside says that is why. A reader adding up the totals
  reads it the same way either flag reads; a reader showing the table should
  say the race is not scored yet rather than that nobody sailed it.
- The scorer's explanatory notes (`seriesNote`, `pageNotes`) travel: they
  are printed on the pages this file sits beside, so a reader who takes
  the data still has the sentence that said why the figures read as they
  do. `pageNotes` keys each note by page name, as the publication does.
- A championship that supplies its boats and redraws them each stage
  carries each entry's boat per fleet (`fleetSailNumbers`, by fleet name).
  In a race that fleet sails, that is the sail number she carries;
  `sailNumber` is then her own entry number.
- Never included: internal UUIDs (competitors are keyed by an export-local
  `ref`, fleets and races by name/number), FTP configuration, revision
  history, workspace organisation.

## Dates and times

Every date and time a scorer enters is a local clock time, written as they
entered it: race dates, gun times, finish times. The top-level `timeZone`
field names the zone they are local to, as an IANA name (`Europe/Dublin`).
One zone covers everything an instance of Sail Scoring publishes.

- A date or time without an offset (`"2026-10-11"`, `"10:55:00"`) is local
  to `timeZone`.
- A timestamp ending in `Z` (`exportedAt`) is UTC.

Files written before the field was added lack it. Their times are local all
the same, just undeclared; a file published by `app.sailscoring.ie` is in
`Europe/Dublin`.

## Versioning

The top-level `version` field numbers the format. Sail Scoring's reader
accepts every version up to its own and refuses a newer one; writers write
the current one.

| Version | Change |
|---|---|
| 1 | Original shape: every competitor field carried regardless of displayed columns; unresolved finish rows included. |
| 2 | The contract above: hidden non-scoring competitor fields dropped, unresolved rows dropped. |
| 3 | A competitor's single `club` becomes the ordered `clubs` list — entry lists routinely carry a club and a second affiliation, and all of them are published. |
| 4 | `splitFleets.config` narrows to the settings the championships scored with it used ([ADR-013](design/decisions/013-removing-meaning-from-stored-formats.md)). Removed settings are either fixed behaviour or gone; race labels follow `vocabulary`. A reader brings a v1–v3 championship forward, and refuses one that scores with a setting that is gone, naming it. |
| 5 | `splitFleets.config` gains the score a boat takes into each stage: `final.carry` and `final.tieBreak`, and `medal.carry` in place of `medal.carryTransform` (which meant `carry: 'halved'`). A carry is `net`, `halved`, `nothing` or `rank`. `medal` may be absent: a championship with no medal stage. A reader renames a v4 configuration's `carryTransform` on import. |
| 6 | Each competitor carries a `ref`, unique within the file, and finishes (`competitorRef`), split-fleet round `overrides` (now keyed by `ref`) and sub-series `competitorOverrides` (`competitorRef`) point at it: a sail number need not name one boat. Competitors gain `fleetSailNumbers`, the boat drawn for them in each fleet. A reader matches a v1–v5 export by sail number, as before. |
| 7 | The repêchage: `repechage` as a split-fleet round's `stage` and a race start's `stage`. It is a short series for boats who missed the medal cut, ranked on its own races alone, and nothing it scores counts in the championship. Rounds gain `overrideReasons` (competitor `ref` → `redress`, `repechage` or `cut-ranking`), saying how a boat placed in a round by hand got there; absent means redress. |
| 8 | `splitFleets.config` gains `fleetRanking` (`combined` or `per-fleet`): whether an undivided championship with more than one fleet ranks its fleets as one list or each on its own — each boat ranked within her fleet, a race counting for a fleet once that fleet has sailed it, a non-finisher scored from her own fleet — and `medal.fromEachFleet`, how many of each fleet's leaders go through directly. Absent is `combined`. |
| 9 | A race start's `course` gains `north`: `"magnetic"` where that start's directions — its `courseLegs` bearings, winds and currents, and the course's wind — are magnetic rather than true. It marks a constructed course imported in magnetic with nowhere to read the variation at. Absent, every direction is true, as before. ORC scores a leg on its wind and current relative to its course, so either north scores the same; an older reader would label the figures wrongly, so the version changes. |
| 10 | A prize clause can be `not-awarded`: a boat already placed in another prize is passed over and the places move down ("a boat winning a prize under IRC shall not be eligible for the ECHO prize"). `prize` is the other prize's 0-based position in `series.prizes`, since prizes carry no id; absent, it means any prize listed above this one. `places` limits it to that prize's top N (1 = its winner only); absent, any place. An older reader doesn't know the clause and would award the prize to boats it rules out, so the version changes. |
| 11 | The course library is removed ([ADR-013](design/decisions/013-removing-meaning-from-stored-formats.md)). Exports from v2 on could carry it, though no version said so: top-level `marks` and `courses`, and on a start whose course was picked from it, the library course by name (`course.course`) and its marks' positions (`course.waypoints`). A v11 export carries none of them. A reader drops the library from an older export and brings such a start forward: anchored where its first waypoint was, with its own `courseLegs` as the legs the course gave where they were never edited, each named after the marks it runs between where they are the waypoints' own one for one. It scores identically. |

A change that an older reader would misread bumps the version: a field
removed, renamed or reshaped, or a new field or value that changes what
existing ones mean. A purely additive optional field may not. Either kind
can reach readers without notice (see [Stability](#stability)). `formatDoc`
and `timeZone` are two such additions: both appear in version-9 files from
2026-10-23 on. The
authoritative field-by-field shape is `PublicSeriesExport` in
[`lib/public-export.ts`](../lib/public-export.ts), whose doc comments
are written to be read as the format's reference.
