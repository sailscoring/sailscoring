# Screen Inventory

A complete enumeration of the screens (views/pages) in the Sail Scoring application.
This is the starting point for user flow and wireframe work.

**Scope:** Desktop-optimised MVP. Tablet/mobile is a future consideration noted
where it significantly affects design decisions.

**Stack context:** Next.js client-side SPA, local-first. Routes are client-side
only. No server rendering in MVP.

---

## Navigation Structure

The application has three levels of navigation:

1. **App-level** — settings that apply across all series (e.g. publishing
   email). Accessible from a persistent icon or link on the series list screen.
   Expected to stay small; no persistent chrome needed.

2. **Global** — the series list and series creation. No persistent chrome
   needed here; the scorer picks a series and enters it.

3. **Within a series** — persistent sidebar (desktop) with primary sections.
   The scorer spends most of their time inside a single series.

Primary sections within a series (sidebar navigation):

| Section | Purpose |
|---------|---------|
| Competitors | Competitor list, import, edit |
| Races | Race list, finish entry, race results |
| Standings | Series standings per fleet/scoring system |
| Settings | Series config, scoring config |

Opening a series lands on **Races** — the most frequent action during an
event. A dashboard screen is deferred until there is a clear need for one.

---

## App-Level Screens

### G-00: App Settings

**Route:** `/settings`
**Purpose:** Settings that apply across all series, not tied to any one event.

**Content/actions:**
- **Publishing email** — the email address bilge sends UUID verification links
  to. Set once; used for the first publish of every new series UUID. Not stored
  per-series and not included in series JSON exports.

**Notes:**
- Currently a single field. Expected to stay minimal for the MVP — if only one
  or two settings ever appear here, this may be better rendered as a small
  panel on G-01 rather than a dedicated route.
- Accessible from a settings icon or link on the Series List screen (G-01).
  Not part of the within-series sidebar.

---

## Global Screens

### G-01: Series List

**Route:** `/`
**Purpose:** Home screen. Lists all series stored on this device.

**Content:**
- List of series: name, venue, date range, last-modified
- Status indicator per series (e.g. number of races completed)

**Actions:**
- Create new series
- Import series from JSON file
- Open a series
- Delete a series (with confirmation)

**Notes:**
- This is the only screen a scorer sees before entering a specific series.
  It should be minimal — most time is spent inside a series.
- "Create new series" could be a modal (quick, opinionated defaults) or
  a dedicated setup screen (if series setup needs more steps). See S-06.

---

### G-02: New Series Setup

**Route:** `/series/[id]/settings` (same screen as S-01)
**Purpose:** Create and configure a new series.

Clicking "New Series" on G-01 immediately creates a series with a generated
placeholder name and navigates to `/series/[id]/settings`. There is no
upfront form. The setup screen and the series settings screen are the same
screen — see `flows/series-setup.md` for the full flow.

**Placeholder names** are generated from a small wordlist: *[Adjective] [Noun]
Series* (e.g. *Gusty Halyard Series*, *Briny Barnacle Series*). The name field
is auto-focused and selected on load.

---

## Within a Series

All routes below are scoped to `/series/[id]/`. Opening a series routes
to `/series/[id]/races`.

### S-01: Series Settings

**Route:** `/series/[id]/settings`

**Purpose:** Configure a series. Also serves as the new series setup screen
(G-02) — there is no separate setup screen. See `flows/series-setup.md`.

**Content/actions:**
- Series name (large, prominent editable field at top)
- Setup cards: Basics, Competitors, Fleets, Scoring, Discards, Publishing
- Export series as JSON
- Delete series (destructive, with confirmation)

**Publishing card:** The scorer sets the series publishing prefix here
(e.g. `hyc/autumn-league-2026`). The prefix defaults to a slugified version of
the series name and is locked after the first verified publish. The email
address used for UUID verification is an app-level setting, not per-series.
See `flows/publish-results.md` for the full configuration and UX details.

---

### S-03: Competitors List

**Route:** `/series/[id]/competitors`
**Purpose:** View and manage all competitors in the series.

**Content:**
- Table of competitors: sail number, name, boat name (if relevant),
  club, fleet, division, ratings (IRC TCC, NHC if applicable)
- Filter/group by fleet, division

**Actions:**
- Add competitor (inline row or modal form)
- Edit competitor (inline or modal)
- Delete competitor
- Import from CSV → S-04
- Exclude / reinstate competitor (CM-08)

**Notes:**
- Sail number is the primary identifier and is the most frequently
  referenced field. It should be the first/leftmost column.
- Rating columns (IRC TCC, NHC) should only appear for fleets that use them.
  A series with only scratch scoring shouldn't show rating columns.

---

### S-04: Competitor Import

**Route:** `/series/[id]/competitors/import`
**Purpose:** Bulk import competitors from a CSV file.

See `flows/competitor-import.md` for the detailed flow.

**Steps:** Upload → Map & Preview (iterative, live) → Confirm.

**Key behaviours:**
- Upsert on sail number: existing competitors are updated, new ones added,
  unmentioned ones left alone. Re-import is safe and used for bulk rating updates.
- Partial import: valid rows go in; error rows are listed and skipped.
- Column mapping is auto-detected and saved per header set for future imports.
- Fleet derived from a fleet column; falls back to class, then division, then
  default fleet if none found.

---

### S-05: Races List

**Route:** `/series/[id]/races`
**Purpose:** View all races in the series; add and manage races. Default landing
screen when opening a series.

**Content:**
- List of races: race number, date, status (no finishes / partial / complete),
  fleet start times
- For each race: link to finish entry, link to race results view

**Actions:**
- Add race (minimal form: race number, date)
- Edit race (date; start times are set on the finish entry screen)
- Delete race (with confirmation — removes all finishes)

---

### S-06: Finish Entry

**Route:** `/series/[id]/races/[raceId]/entry`
**Purpose:** The core workflow. Enter finishing data for a race.

This is the most complex and most used screen in the application.
See `flows/finish-entry.md` for the detailed user flow.

**Two modes, same screen:**
The screen adapts based on the race's fleets:
- **Position mode** (scratch fleets): enter sail numbers in finishing order
- **Time mode** (IRC/NHC fleets): enter sail number + finish time per boat

If a series has both scratch and handicap fleets sharing a finish line (e.g.
IODAI Junior+Senior, or HYC offshore classes), the finish list is a single
mixed entry that the system splits by fleet for scoring.

**Content:**
- Start times panel (per fleet; editable before/during entry)
- Finish list: the ordered list of entries so far
- Entry input: focused text field for rapid keyboard entry
- Unresolved competitors: boats registered but not yet in the finish list
- Result codes: assign DNS/DNF/etc. to non-finishers

**Actions:**
- Enter a finish (sail number, optionally finish time)
- Remove or reorder a finish entry
- Assign a result code to a competitor
- Scoring runs automatically as finishes are recorded

> **Key design questions (to resolve in flows/finish-entry.md):**
> - How does the scorer correct a mistake mid-entry list?
> - How are non-finishers (DNS/DNF/etc.) handled relative to the finish list?

---

### S-07: Race Results

**Route:** `/series/[id]/races/[raceId]/results`
**Purpose:** Review scored results for a single race, by fleet and scoring system.

**Content:**
- Per fleet, per scoring system: ranked list of competitors with their
  place, corrected time (if applicable), and points
- Result codes shown in line with finishers (e.g. at the bottom)
- Flags: discarded race indicator (if this race will be discarded for any competitor)

**Actions:**
- Quick link back to finish entry (to correct a result)
- Navigate to series standings

**Notes:**
- This screen is primarily read-only. Corrections are made via S-06.
- May be combined with finish entry as two tabs on the same screen.

---

### S-08: Series Standings

**Route:** `/series/[id]/standings`
**Purpose:** Current series standings, per fleet and scoring system.

**Content:**
- Per fleet, per scoring system: ranked competitor list with:
  - Rank, sail number, name/boat name, points per race, total, discards, net points
- Division filter (e.g. show only Gold competitors within Junior fleet)
- Races sailed count

**Actions:**
- Filter by division
- Publish results → see `flows/publish-results.md`

**Notes:**
- For dual-scored fleets (IRC + NHC), standings for each scoring system
  appear as separate sub-sections or tabs within the fleet block.
- The scorer should be able to see standings update in near-real-time as
  finishes are entered (Dexie `liveQuery()` enables this without a page refresh).
- Publishing posts one HTML page per fleet per scoring system to bilge. The
  scorer shares a single listing URL (`/l/{prefix}/`) covering all pages.
  Publish configuration (email, prefix) is set in S-01 — not at publish time.

---

## Summary

| Screen | Route | Priority |
|--------|-------|---------|
| G-00: App Settings | `/settings` | P2 |
| G-01: Series List | `/` | P1 |
| G-02/S-01: Series Setup & Settings | `/series/[id]/settings` | P1 |
| S-03: Competitors List | `/series/[id]/competitors` | P1 |
| S-04: Competitor Import | `/series/[id]/competitors/import` | P1 |
| S-05: Races List | `/series/[id]/races` | P1 |
| S-06: Finish Entry | `/series/[id]/races/[raceId]/entry` | P1 (highest) |
| S-07: Race Results | `/series/[id]/races/[raceId]/results` | P1 |
| S-08: Series Standings | `/series/[id]/standings` | P1 |
