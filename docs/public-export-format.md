# The public export format (`.sailscoring.json`)

The public export is the data behind a published results page
([ADR-012](design/decisions/012-data-behind-published-results.md)): a
sanitized, portable snapshot of a series, published beside the pages and
free for anyone to fetch and build on.

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
- **Snapshot-pinned**: the file holds exactly the data the pages were
  rendered from, updated only by a re-publish. Unpublishing removes it.
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
- The course library behind ORC constructed courses travels: `marks`
  and `courses` (keyed by name, as fleets are), and each start's own
  `course` snapshot — the waypoints, the wind, and whether the legs were
  edited — which the published drawing is rendered from. Course facts
  are what competitors check their tracks against.
- Unresolved finish entries (a crossing recorded but matched to no
  competitor) are the scorer's work in progress and are not exported.
- `standings` is what the published pages show, scored by the engine that
  rendered them. A split-fleet championship is one ranking across its
  fleets rather than a table per fleet, so it exports a single entry named
  "Championship", holding every boat in championship order; the carried
  score that belongs to no race — a qualifying position carried into the
  final series, the medal boats' compressed opening score — travels beside
  the per-race arrays as `carriedPoints`.
- A race still waiting for the course its ORC option corrects over is not
  scored at all: it carries 0 points and `raceExcluded` for every boat, and
  `raceNotScored` alongside says that is why. A reader adding up the totals
  reads it the same way either flag reads; a reader showing the table should
  say the race is not scored yet rather than that nobody sailed it.
- The scorer's explanatory notes (`seriesNote`, `pageNotes`) travel: they
  are printed on the pages this file sits beside, so a reader who takes
  the data still has the sentence that said why the figures read as they
  do. `pageNotes` keys each note by page name, as the publication does.
- Never included: internal UUIDs (competitors are keyed by sail number,
  fleets and races by name/number), FTP configuration, revision history,
  workspace organisation.

## Versioning

The top-level `version` field numbers the format. Readers accept every
version up to their own; writers write the current one.

| Version | Change |
|---|---|
| 1 | Original shape: every competitor field carried regardless of displayed columns; unresolved finish rows included. |
| 2 | The contract above: hidden non-scoring competitor fields dropped, unresolved rows dropped. |
| 3 | A competitor's single `club` becomes the ordered `clubs` list — entry lists routinely carry a club and a second affiliation, and all of them are published. |

The format is a public API surface: field removals or meaning changes
bump the version; purely additive optional fields may not. The
authoritative field-by-field shape is `PublicSeriesExport` in
[`lib/public-export.ts`](../lib/public-export.ts), whose doc comments
are written to be read as the format's reference.
