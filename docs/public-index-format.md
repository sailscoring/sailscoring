# The public index format (`index.json`)

Every published series serves its data beside its pages as a
`.sailscoring.json` file ([the public export format](public-export-format.md)).
The index is how an app *finds* those files: a machine-readable twin of the
workspace and season indexes the publication tree renders
([ADR-011](design/decisions/011-public-results-navigation.md)), listing every
published series with its pages and its data file.

## Where to find it

```
/p/{workspace}/index.json            every publication in the workspace
/p/{workspace}/{season}/index.json   the publications filed under one season
```

- Declared in the head of the workspace and season index pages as
  `<link rel="alternate" type="application/json">`, the way results pages
  declare their data file.
- Served with `Access-Control-Allow-Origin: *`, and `ETag` exposed
  (`Access-Control-Expose-Headers: ETag`), so a script can poll it with
  `If-None-Match` and get `304 Not Modified` while nothing has changed.
- Lists only what is already published. Unpublishing a series drops it from
  the index; a workspace with nothing published, or a season with nothing
  filed under it, is `404`.
- The [directory](#the-directory-pindexjson) at `/p/index.json` links each
  listed workspace's index, so an app can walk from the directory to any
  series' data without being given a URL.

## Shape

Every URL is absolute.

```jsonc
{
  "version": 1,
  "workspace": {
    "slug": "hyc",
    "name": "Howth Yacht Club",
    "url": "https://app.sailscoring.ie/p/hyc",
    "logo": "https://…"                    // absent when the workspace has none
  },
  "seasons": [                              // newest first; only seasons with publications
    {
      "label": "2026",
      "current": true,                      // the season the workspace marks current
      "url": "https://app.sailscoring.ie/p/hyc/2026",
      "index": "https://app.sailscoring.ie/p/hyc/2026/index.json"
    }
  ],
  "publications": [
    {
      "name": "Autumn League 2026",         // the series' name
      "season": "2026",                     // null when the publication has no season
      "folder": {                           // the top-level folder it is published into
        "slug": "autumn-league",
        "label": "Autumn League",
        "url": "https://app.sailscoring.ie/p/hyc/autumn-league"
      },
      "event": {                            // present when its pages share an event folder
        "segment": "ulsters",
        "label": "Ulsters",
        "url": "…"
      },
      "url": "https://app.sailscoring.ie/p/hyc/autumn-league",   // its own landing page
      "pages": [
        {
          "label": "Class 1",               // as the published navigation labels it
          "kind": "standings",              // standings | race-results | prizes | entry-list | other
          "fleet": "Class 1",               // present on a page holding one fleet's results
          "subSeries": "Block 1",           // present on a page covering one sub-series
          "url": "https://app.sailscoring.ie/p/hyc/autumn-league/class-1"
        }
      ],
      "data": "https://app.sailscoring.ie/p/hyc/autumn-league/autumn-league-2026.sailscoring.json",
      "fleets": [{ "name": "Class 1", "scoringSystem": "irc" }],
      "publishedAt": "2026-10-04T18:12:00.000Z",
      "firstRaceDate": "2026-09-06",
      "lastRaceDate": "2026-10-04",
      "races": 8,
      "boats": 31
    }
  ]
}
```

Field notes:

- **Order.** Publications follow the tree: newest season first, each
  season's folders in the order its index lists them, the series in a folder
  in the workspace's own order. Publications with no season come last.
- **`name`.** The series' name. A publication whose series has since been
  deleted keeps its pages public; it is named after its folder.
- **`data`.** `null` when the series opted out of the JSON export, or
  publishes none.
- **`publishedAt`.** When the series was last published. A poller can
  compare it with what it last saw and skip fetching an unchanged series'
  data file.
- **`fleets`.** The series' fleets as scored, with each one's scoring system
  (`scratch`, `irc`, `py`, `nhc`, `echo`, `vprs`, `orc`, `tcf`) where known.
  A series that never defined a fleet has none. An as-published archive
  series (results ingested as originally published, never re-scored) names
  its fleets without a scoring system.
- **`firstRaceDate`, `lastRaceDate`, `races`, `boats`.** Counted when the
  series was published, from what was published: sailed races only.
  `races` and `boats` are absent, and the dates `null`, for a publication
  made before Sail Scoring recorded them, until it is published again.
- **A season index** has the same shape, narrowed: `seasons` holds just
  that season and `publications` just the ones filed under it.

## The directory (`/p/index.json`)

The JSON twin of the public directory at `/p`: the club workspaces
publishing with Sail Scoring. A club workspace is listed once it has
published something, unless it opts out in its settings; personal
workspaces never are. Served the same way as the workspace index (CORS-open,
`ETag` exposed).

```jsonc
{
  "version": 1,
  "workspaces": [                           // most recently published first
    {
      "slug": "hyc",
      "name": "Howth Yacht Club",
      "url": "https://app.sailscoring.ie/p/hyc",
      "index": "https://app.sailscoring.ie/p/hyc/index.json",   // its workspace index, above
      "logo": "https://…",                  // absent when it has none
      "description": "…",                   // absent when it has none
      "lastPublishedAt": "2026-10-04T18:12:00.000Z",
      "currentSeason": "2026",              // null when nothing published has a season
      "latest": { "name": "Autumn League 2026", "url": "…", "publishedAt": "…" },
      "counts": { "seasons": 3, "series": 42, "races": 310, "entries": 1204 },
      "badges": ["IRC", "ECHO", "One-design"]
    }
  ],
  "recent": [                               // the latest publications across every workspace
    { "name": "Autumn League 2026", "url": "…", "publishedAt": "…", "workspace": "hyc" }
  ]
}
```

- **`counts`** sum the workspace's publications: `entries` counts a boat
  once per series it sailed, not once overall. Publications made before
  Sail Scoring recorded their races and entries count toward `series` only.
- **`badges`** name the kinds of racing the workspace has published:
  `IRC`, `ORC`, `ECHO`, `NHC`, `VPRS`, `PY`, `TCF` (handicap systems),
  `One-design` (scratch fleets), `Split-fleet` (split-fleet championships)
  and `Archive` (results ingested as originally published). More may be
  added without a version change.

The authoritative shape is `directoryJson` in
[`lib/published-directory.ts`](../lib/published-directory.ts). Its
`version` follows the same rules as the workspace index's, and is numbered
separately.

## Versioning

The top-level `version` field numbers the format, with the same rules as
the public export: adding an optional field does not change it; removing a
field or changing what one means does.

| Version | Change |
|---|---|
| 1 | Original shape. |

The authoritative field-by-field shape is `PublicIndex` in
[`lib/published-index-json.ts`](../lib/published-index-json.ts).
