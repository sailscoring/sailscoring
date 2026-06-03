# Querying HalSail Public Results

Reverse-engineered notes on how [HalSail](https://halsail.com)'s public
results pages are structured and how to query them programmatically. The aim
is to enumerate and read a club's published results with the *fewest* HTTP
requests, so we don't re-probe the live site to re-learn this. Nothing here
is DBSC-specific.

HalSail is an ASP.NET MVC application. Results are public (no authentication
needed), but the pages are **JavaScript-rendered**: the initial HTML is a
shell that loads the actual results table over AJAX. That has direct
consequences for tooling — see [Practical notes](#practical-notes).

## The three ID types

| ID | Example | What it is |
|----|---------|------------|
| **clubId** | `3446` | A club. Appears only in the entry URL. |
| **fleetId** | `31861` | A "racing class" / scored fleet, e.g. *Cruisers 1 IRC*. One fleet can be scored across several day-series. |
| **seriesId** | `95450` | A published *(fleet × day-series)* result set, e.g. *Cruisers 1 IRC, Thursday Overall*. **This is the unit every results URL takes.** |

A fleet (`fleetId`) maps to one or more series (`seriesId`) — typically one
per day-of-week the fleet races (e.g. a "Thursday Overall" and a "Saturday
Overall" series share one `fleetId` but have distinct `seriesId`s).

> Terminology: HalSail's UI calls a `seriesId` a "sery" in places
> (`ShowSery(seryid)`, `<select class="ddsery">`). Treat "sery" = `seriesId`.

## Endpoints

| URL | Returns |
|-----|---------|
| `GET /Result/Club/{clubId}` | A ~8 KB redirect stub (see below). |
| `GET /Result/Public/{seriesId}` | The full ~56 KB page **shell** for a series. Server-rendered chrome + selectors; the results table itself is *not* in this HTML. |
| `GET /Result/_Boat/{seriesId}` | **The results table**, as an HTML fragment (boat-centric view). This is the payload you actually want. |
| `GET /Result/_Helm/{seriesId}` | Same results, helm-centric view (the JS swaps `_Boat`→`_Helm`). |

There is a CDN mirror host, `halsail-1e484.kxcdn.com`, that serves the same
paths as `halsail.com`.

### `/Result/Club/{clubId}` is just a redirect

It contains an inline script that, after a 2-second progress-bar delay,
sets `location.href` to the club's *latest-race* series page:

```js
var url = "https://halsail-1e484.kxcdn.com/Result/Public/95476";
// ... 2s delay ...
location.href = url;
```

So to bootstrap from a `clubId`, fetch this page and extract the
`/Result/Public/{seriesId}` URL from the inline `var url = "..."`. That
`seriesId` is just *a* valid series for the club (the most recently raced
one) — any series works as an entry point into the catalog below.

### `/Result/Public/{seriesId}` — the shell carries the whole catalog

The shell HTML is **identical regardless of which `seriesId`** you request,
except that the requested fleet/series options are marked
`selected="selected"`. Crucially, it embeds the club's **entire catalog of
fleets and series** in two kinds of `<select>`:

1. **`#ddRacingClasses`** — one `<option>` per fleet:

   ```html
   <option value="31861" class="c31861">Cruisers 1 IRC</option>
   ```

   `value` = `fleetId`; the text is the fleet's display name. The `class`
   is `c{fleetId}`.

2. **One hidden `<select class="ddsery" id="dd{fleetId}">` per fleet** —
   listing that fleet's series, grouped by whether results exist yet:

   ```html
   <select class="ddsery" id="dd31861" style="display: none;">
     <optgroup label="Series with results" class="optWithResults">
       <option value="95450" class="c31861 text-success">Thursday Overall</option>
       <option value="95449" class="c31861 text-success">Saturday Overall</option>
     </optgroup>
     <optgroup label="Series with no results yet" class="optWithoutResults">
     </optgroup>
   </select>
   ```

   `value` = `seriesId`; the text is the series name. The enclosing
   `<optgroup>` class tells you whether the series has results:
   `optWithResults` vs `optWithoutResults`. (Series with results also carry
   `text-success` on the option.)

**This means one fetch of any `/Result/Public/{id}` yields the full mapping
`fleetId → label` and `fleetId → [{seriesId, name, hasResults}]` for the
entire club** — no need to crawl page by page.

### `/Result/_Boat/{seriesId}` — the results fragment

This is the AJAX call the page makes to render the table (from the inline
`ShowSery` function):

```js
var urlResults = '/Result/_Boat/' + seryid;   // AJAX call for the results
// browser address bar is then rewritten to /Result/Public/{seryid}
$("#divResults").load(urlResults, ...);
```

It returns a large (~600 KB) HTML fragment containing:

- A **series summary table**: columns `Rank · Sail · Sel · Bow · Type ·
  Hcap · Name · Owner · Helm · Crew · Notes · Club`, then **one column per
  scored race** (`Race 1`, `Race 3`, …; race numbers may be
  non-contiguous when a race wasn't scored), then `Score`.
  - Discarded race scores are shown **in parentheses**, e.g. `(3)`.
  - Coded results render as `points/CODE`, e.g. `10/DNC`, `9/DNF`. The
    numeric part is the points actually awarded (so a DNC's points reveal
    the fleet's "starters + 1" count for that race, which can differ race to
    race).
- **Per-race detail tables**: columns `Place · Sail · Bow · Type · Hcap ·
  Name · … · Laps · Finish · Elapsed · Points`. One per scored race.
- The `Type` column is the boat's one-design class where applicable (e.g.
  `J109`); `Hcap` is the rating used (TCC for IRC, the progressive number for
  ECHO, etc.).

There is a `__RequestVerificationToken` hidden input and an auth-timeout
poller (`/Account/_CheckTimeout`) in the shell, but **none of the public
results endpoints require auth or the token** for `GET`.

### Result codes and the RDG type marker

The `Place` cell carries the result code for non-finishers (`DNC`, `DNF`,
`RET`, `OCS`, …) instead of a position. Redress is special: it renders as
`RDG` followed by the **redress type number**, e.g. `RDG 2` (the separator
byte in captured HTML is sometimes an underscore — `RDG_2`). The number is
*which of HalSail's five redress methods* was applied — it is not a footnote.

HalSail's five RDG types and how they map to Sail Scoring's `redressMethod`:

| HalSail RDG type | Meaning | Sail Scoring `redressMethod` |
|---|---|---|
| 1 — Av all races | mean of all other races, **including** DNC/OCS/etc. | `all_races` |
| 2 — Av excluding DNC | mean of all other races, excluding DNC up to the discard allowance (excess DNCs stay in) | `all_races_excl_dnc` |
| 3 — Av previous races | mean of races before this one | `races_before` |
| 4 — Place | points for a given finishing place | *unsupported — see horizon* |
| 5 — Points | a specific points value | *unsupported (≈ `stated`, but per-fleet) — see horizon* |

RDG 2 is the usual choice for compensating race-officer / hut duty. Types 4
and 5 have no faithful Sail Scoring equivalent yet (a `Place`/`stated` value
differs per fleet, but our model stores one shared finish) — see
`docs/design/horizon.md`. The redress **points value** HalSail displays is
per-fleet (the average within that fleet's own series), so the converter maps
the *method* and lets the engine recompute the value per fleet rather than
copying the published number.

## Recommended querying strategy (minimise requests)

To enumerate everything a club publishes and then read specific results:

1. **One** `GET /Result/Club/{clubId}` → scrape the `var url` redirect to get
   a seed `seriesId`. *(Skip this entirely if you already know any
   `seriesId` for the club.)*
2. **One** `GET /Result/Public/{seedSeriesId}` → parse `#ddRacingClasses` and
   every `#dd{fleetId}` select to build the full catalog: fleets, their
   series, names, and which have results. Cache this.
3. Per result set you actually want: **one** `GET /Result/_Boat/{seriesId}`
   and parse the tables.

So the full catalog costs **2 requests**, and each results table is **1**.
Cache the catalog and the fragments; re-fetch a fragment only when you expect
new races to have been scored.

## Practical notes

- **Don't use a markdown-converting fetcher** (e.g. a "fetch URL → markdown
  via small model" tool) on these pages. Because the results load via JS, such
  tools see only the loading shell ("Saturday Overall / …" placeholder + a
  spinner) and report no data. Use a plain HTTP `GET` and parse the HTML
  yourself.
- A normal browser `User-Agent` is sufficient; `X-Requested-With:
  XMLHttpRequest` on the `_Boat` call mirrors what the site does but does not
  appear to be required.
- The shells follow redirects to the kxcdn host; follow them (`curl -L`).
- Option-tag parsing: HalSail's markup is loose (unquoted attributes like
  `id=dd31861`, attributes in varying order, whitespace/newlines between the
  `<option>` tag and its text). Parse permissively — capture
  `value="(\d+)"` and the following text run up to `</option>` across
  newlines, rather than assuming a tidy single-line `<option>` element.
- The shell is the same bytes for every `seriesId`; only the
  `selected="selected"` marker and the anti-forgery token differ. Don't rely
  on the shell's *content* differing per series — rely on the `seriesId` you
  requested.

## Worked example (observed 2026-06-02)

Club `3446` (Dublin Bay Sailing Club):

- `GET /Result/Club/3446` → redirect to `/Result/Public/95476`.
- `GET /Result/Public/95476` → catalog including fleet `31861`
  *"Cruisers 1 IRC"*, whose `dd31861` select lists series `95450`
  *"Thursday Overall"* and `95449` *"Saturday Overall"* (both
  `optWithResults`).
- `GET /Result/_Boat/95450` → the *Cruisers 1 IRC, Thursday Overall* table:
  summary with race columns `Race 1/3/5/6` (4 scored), bracketed discards,
  `10/DNC` style coded scores, per-boat `Hcap` (IRC TCC) and `Type`.
