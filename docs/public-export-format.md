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
- Unresolved finish entries (a crossing recorded but matched to no
  competitor) are the scorer's work in progress and are not exported.
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

The format is a public API surface: field removals or meaning changes
bump the version; purely additive optional fields may not. The
authoritative field-by-field shape is `PublicSeriesExport` in
[`lib/public-export.ts`](../lib/public-export.ts), whose doc comments
are written to be read as the format's reference.
