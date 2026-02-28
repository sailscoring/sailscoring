# Screen Inventory

A complete enumeration of the screens (views/pages) in the Sail Scoring application.
This is the starting point for user flow and wireframe work.

**Scope:** Desktop-optimised MVP. Tablet/mobile is a future consideration noted
where it significantly affects design decisions.

**Stack context:** Next.js client-side SPA, local-first. Routes are client-side
only. No server rendering in MVP.

---

## Navigation Structure

The application has two levels of navigation:

1. **Global** — the series list and series creation. No persistent chrome
   needed here; the scorer picks a series and enters it.

2. **Within a series** — persistent sidebar (desktop) with primary sections.
   The scorer spends most of their time inside a single series.

Primary sections within a series (sidebar navigation):

| Section | Purpose |
|---------|---------|
| Competitors | Competitor list, import, edit |
| Races | Race list, finish entry, race results |
| Standings | Series standings per fleet/scoring system |
| Settings | Series config, fleet config |

Opening a series lands on **Races** — the most frequent action during an
event. A dashboard screen is deferred until there is a clear need for one.

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

**Route:** `/series/new` (or modal from G-01)
**Purpose:** Create a new series with its initial configuration.

**Content/steps:**
- Series name, venue, start/end date
- Add fleets: fleet name, scoring system(s) per fleet
- Discard profile

> **Open question:** Is this a single form or a multi-step wizard? The
> fleet/scoring config is non-trivial (each fleet needs scoring systems,
> and each system implies required ratings). A wizard might guide new
> scorers better; a single form is faster for experienced scorers.

> **Open question:** At what point does the scorer enter competitors?
> Series setup and competitor import are logically sequential but the
> scorer may want to start them separately (e.g. set up the series today,
> import competitors tomorrow morning from the registration file).

---

## Within a Series

All routes below are scoped to `/series/[id]/`. Opening a series routes
to `/series/[id]/races`.

### S-01: Series Settings

**Route:** `/series/[id]/settings`

**Purpose:** Edit series-level configuration.

**Content/actions:**
- Edit series name, venue, start/end date
- Discard profile (e.g. "0 discards < 4 races; 1 discard 4–9 races")
- Result code scoring overrides (e.g. A5.3 — codes not excludable)
- Export series as JSON
- Delete series (destructive, with confirmation)

---

### S-02: Fleet Settings

**Route:** `/series/[id]/settings/fleets` (or tab within S-01)
**Purpose:** Add, edit, and remove fleets within the series.

**Content per fleet:**
- Fleet name
- Scoring systems: one or more of Scratch, IRC, NHC
  (selection determines which rating fields competitors require)

**Actions:**
- Add fleet
- Edit fleet name and scoring systems
- Reorder fleets (affects display order in standings/results)
- Delete fleet (destructive — removes all competitors in that fleet)

> **Open question:** How much friction should deleting a fleet have?
> Deleting a fleet with competitors is very destructive. A confirmation
> that states what will be lost seems essential.

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

**Steps:**
1. Upload CSV file
2. Map CSV columns to competitor fields (sail number, name, club, fleet, division, ratings)
3. Preview: table of parsed competitors with validation errors highlighted
4. Confirm import

**Notes:**
- Column mapping needs to be flexible — registration exports vary widely
  in column names and ordering.
- Validation: sail number required; sail number must be unique within series;
  fleet name must match an existing fleet in the series (or create one?).
- Import should be additive (does not delete existing competitors) unless
  the scorer explicitly requests a full replace.

> **Open question:** Should the import support a "replace all" mode, or
> always be additive? Additive is safer; replace is needed if the scorer
> re-exports a corrected registration list.

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
- Publish results → (publishing flow, TBD)
- Export as HTML page

**Notes:**
- For dual-scored fleets (IRC + NHC), standings for each scoring system
  appear as separate sub-sections or tabs within the fleet block.
- The scorer should be able to see standings update in near-real-time as
  finishes are entered (Dexie `liveQuery()` enables this without a page refresh).

---

## Summary

| Screen | Route | Priority |
|--------|-------|---------|
| G-01: Series List | `/` | P1 |
| G-02: New Series Setup | `/series/new` | P1 |
| S-01: Series Settings | `/series/[id]/settings` | P1 |
| S-02: Fleet Settings | `/series/[id]/settings/fleets` | P1 |
| S-03: Competitors List | `/series/[id]/competitors` | P1 |
| S-04: Competitor Import | `/series/[id]/competitors/import` | P1 |
| S-05: Races List | `/series/[id]/races` | P1 |
| S-06: Finish Entry | `/series/[id]/races/[raceId]/entry` | P1 (highest) |
| S-07: Race Results | `/series/[id]/races/[raceId]/results` | P1 |
| S-08: Series Standings | `/series/[id]/standings` | P1 |
