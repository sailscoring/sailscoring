# Results Renderer

The results renderer is a pure TypeScript function that produces a self-contained
HTML results page from series scoring data. It is the shared rendering layer for
both local HTML export (issue #13) and future in-app bilge publishing.

**Status:** Design complete — ready to implement

**Related:** [issue #13](https://github.com/sailscoring/sailscoring/issues/13),
[Sailwave HTML template analysis](sailwave-html-template.md),
[Publish Results flow](ux/flows/publish-results.md)

---

## Scope

### What the renderer produces

A single self-contained `.htm` file per series. The file contains:

1. **Series standings table** — all competitors ranked, with per-race points and totals
2. **Race detail tables** — one table per race, showing finishing order

This mirrors the Sailwave output format exactly, giving scorers a familiar artefact that
their clubs already know how to read and host.

### Evolution

| Phase | Output |
|-------|--------|
| Now (no fleets) | One file per series |
| When fleets land | Default to one file per fleet |
| Later | Option to publish a combined file: all fleet standings first, then all race results |

---

## Renderer function

```typescript
// lib/results-renderer.ts

export function renderSeriesHtml(data: SeriesResultsData): string
```

The function is pure: no side effects, no I/O, no DB access. It returns a complete
HTML string ready to save or upload.

---

## Input type

The caller assembles `SeriesResultsData` from Dexie entities and scoring output.
The renderer never reads from the database directly.

```typescript
export interface SeriesResultsData {
  // Header
  series: {
    name: string;
    venue: string;
  };
  leftLogoUrl?: string;    // optional: club or venue logo (left side of header)
  rightLogoUrl?: string;   // optional: event or sponsor logo (right side of header)

  // Status line — shown as "Results are provisional as of HH:MM on Month D, YYYY"
  // Omit for final results
  generatedAt?: Date;

  // Races in series order (used for column headers and race detail sections)
  races: RaceData[];

  // Series standings (sorted by rank, ascending)
  standings: StandingRowData[];
}

export interface RaceData {
  raceNumber: number;
  date: string;        // ISO date string, e.g. "2025-06-14"
  label: string;       // column header, e.g. "R1" or "R3 Jul 23"
  anchorId: string;    // used for in-page links, e.g. "r1"
  results: RaceResultData[];
}

export interface RaceResultData {
  rank: number;
  sailNumber: string;
  helm: string;
  place: number | null;        // finishing position (scratch); null for coded
  points: number;
  resultCode: ResultCode | null;
}

export interface StandingRowData {
  rank: number;
  sailNumber: string;
  helm: string;
  raceScores: RaceScoreData[];  // one entry per race, in race order
  totalPoints: number;
  netPoints: number;            // equal to totalPoints until discards are implemented
}

export interface RaceScoreData {
  points: number;
  resultCode: ResultCode | null;
  isDiscard: boolean;           // always false until discards are implemented
  podiumRank: 1 | 2 | 3 | null; // null if result code present or rank > 3
}
```

### Notes on `podiumRank`

`podiumRank` is pre-computed by the caller (not derived by the renderer). For scratch
scoring, it is the competitor's finishing place within the race (1st, 2nd, 3rd), set to
`null` for result codes or places 4 and above. When handicap scoring arrives, the caller
sets it from corrected-time rank, not from points — the renderer stays unchanged.

### Notes on discards

`isDiscard` and `netPoints` are included in the type now so the renderer interface is
stable. Both carry their "not yet" values (all-false and totalPoints respectively) until
the discards feature lands. At that point the caller populates them correctly and the
renderer already knows what to do with them.

---

## HTML output

The renderer produces output that matches the Sailwave new template (v3) as documented
in [sailwave-html-template.md](sailwave-html-template.md).

### Self-containment

| Dependency | Approach |
|-----------|---------|
| CSS | Inlined in `<style>` — identical to Sailwave stylesheet |
| JS | None — highlight effects implemented with static CSS classes |
| Images (logos) | External URLs — same as Sailwave; not embedded |
| Fonts | System stack (Arial/Helvetica/sans-serif) — no web font load |

The file is viewable without a server or internet connection as long as logo images
are hosted somewhere reachable. Logo images are optional; the layout degrades
gracefully when absent.

### Highlight effects (CSS, no JS)

The Sailwave JS effects (HighlightWins3v3, HighlightDiscards) are replaced by static
CSS rules. The renderer emits `class="rank1"`, `class="rank2"`, `class="rank3"` on
summary table cells where `podiumRank` is set, and `class="discard"` where `isDiscard`
is true. No jQuery, no DOM scanning.

```css
td.rank1 { background: #ffd700; }   /* gold */
td.rank2 { background: #6a91c5; }   /* steel blue */
td.rank3 { background: #da6841; }   /* burnt orange */
td.discard { background: #f2f2f2; } /* grey — overrides rank colours */
```

### Summary table columns (current, scratch-only)

| Col class | Header | Content |
|-----------|--------|---------|
| `rank` | Rank | Ordinal: "1st", "2nd", "3rd" |
| `sailno` | Sail | `sailNumber` |
| `helmname` | Helm | `helm` |
| `race` × N | R1 … Rn | Points + optional code; discard wrapped in `()`; rank1/rank2/rank3 class |
| `total` | Total | `totalPoints` |
| `nett` | Nett | `netPoints` (hidden when equal to totalPoints and no discards exist) |

Alternating row classes: `.odd` / `.even` on each `<tr class="... summaryrow">`.

### Race detail table columns (current, scratch-only)

| Col class | Header | Content |
|-----------|--------|---------|
| `rank` | Rank | Integer |
| `sailno` | Sail | `sailNumber` |
| `helmname` | Helm | `helm` |
| `place` | Place | Finishing position, or result code |
| `points` | Points | Points value |

Result-code rows: `place` cell shows the code, `points` cell shows the penalty points.

### Footer

```html
<p>Sail Scoring — <a href="https://app.sailscoring.ie">app.sailscoring.ie</a></p>
```

No bilge retirement note (this file is a local export, not a bilge page).

---

## Caller responsibilities

The page assembling `SeriesResultsData` must:

1. Load `Series`, `Race[]`, `Competitor[]`, `Finish[]` from Dexie
2. Call `calculateRaceScores()` for each race → per-race `Map<competitorId, RaceScore>`
3. Call `calculateStandings()` → `Standing[]`
4. Pivot per-race scores to build `RaceData[].results` (rank competitors within each race)
5. Map `Standing[]` → `StandingRowData[]`, computing `podiumRank` for each `RaceScoreData`
6. Pass assembled data to `renderSeriesHtml()`

This assembly logic lives in a helper alongside the export trigger — not inside the
renderer and not inside a React component.

---

## Export UI

An **Export HTML** button on **S-08 (Series Standings)**.

**Behaviour:**
1. Click Export HTML
2. App assembles `SeriesResultsData` from current DB state
3. Calls `renderSeriesHtml(data)`
4. Triggers a browser download of the resulting string as `{series-name-slug}.htm`

The download uses a `<a href="data:text/html,...">` or `URL.createObjectURL(blob)`
approach — no server required. File System Access API (directory picker) is out of
scope for now; a single-file download is sufficient.

**Filename:** slugified series name + `.htm`, e.g. `hyc-autumn-league-2025.htm`.

---

## Relationship to bilge publishing

For now, the scorer exports an `.htm` file and uploads it manually using the
[bilge client](bilge-client.md). The renderer is unaware of bilge.

When bilge publishing is embedded in the app (future), the publish flow calls
`renderSeriesHtml()` and POSTs the resulting string to bilge `/upload` — same
renderer, different delivery.

---

## Out of scope

| Item | Reason |
|------|--------|
| Discards in output | No discard support in scoring engine yet; interface is ready |
| Handicap columns (times, ratings) | Handicap scoring not yet implemented |
| Per-fleet output | No fleet model yet; one file per series for now |
| Embedded images (base64) | Adds complexity; external URLs match Sailwave behaviour |
| Custom templates / branding per series | One standard template for MVP |
| Printing / PDF | Browser print works on the generated HTML; no special handling needed |
