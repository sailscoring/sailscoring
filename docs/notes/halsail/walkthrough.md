# HalSail operator walkthrough

> **Status: capture in progress (#235).** A faithful record of operating HalSail,
> built up hands-on while mirroring DBSC's methodology to set up HYC's classes in a
> real HYC HalSail account. Serves Phase 2 (how the operator model actually works)
> and seeds Phase 3 (reproducing HYC 2025). Distilled model-level facts are
> promoted into [`data-model.md`](data-model.md); this doc keeps the step-by-step
> detail and UI specifics.
>
> Terminology (Tandem series, Star, Flick) is in `docs/requirements/glossary.md`.

## Mental model: HalSail is a *club* system

A DBSC scorer's framing, which colours the whole design: **"Sailwave was built for
regattas/events; HalSail was built for clubs."** The tells:

- HalSail centres on **boats** ("boats in the club"), not **competitors**. The boat
  register is the spine; a boat is enrolled into classes.
- **Series-within-a-series** (tandems) is native. Sailwave's *lack* of it is
  precisely what's seen as its "not built for clubs" flaw — a club runs many
  overlapping standings off one set of finishes all season.

This is the conceptual anchor for Output 3: Sail Scoring is competitor-centric like
Sailwave, but needs the club-season expressiveness HalSail gets from tandems.

## 1. Racing classes — `/RacingClass`

A **class** carries a name, a **flag** (e.g. `A`), a **handicap type**, and notes.
Handicap type seen: `Level` (non-handicap/scratch) and `NHC` — with a **"Local
Name" for the handicap** (HYC's NHC is locally branded **HPH**, Howth Performance
Handicap).

Classes created while mirroring DBSC for HYC Puppeteers:
- `Puppeteer Scratch` — `Level`, flag `A`.
- `Puppeteer HPH (Tue)` — `NHC`, local name HPH.
- `Puppeteer HPH (Sat)` — `NHC`, local name HPH.

On class creation: **"Do you want to copy boats into this class from any of your
other racing classes?"** — pointing it at a source class copies that class's boats
in. This is a **one-time copy, not a live mirror**: ongoing membership is managed
per boat — when you add a boat you're taken to a screen to enrol it in whichever
classes you want, supplying a handicap for each (§2).

**Classes menu:** Boat-Class Crosstab · List Classes · New Class · Import racing
classes (from *hal file* or spreadsheet) · Tools (email competitors; show classes
with no races / boats / results). → **Plan classes in a spreadsheet and import**
rather than hand-create.

## 2. Boats — `/Boat/BoatsInClub/{id}`

Boat-centric, as the framing predicts. Create flow captures sail number, boat name,
owner, **helm (defaults to owner)**, and club (it seems to detect new clubs). A
second screen confirms boat details **and which classes the boat is in**; per class
you set a **handicap**, via a screen that scopes the handicap to a **date range**.
A `Level`/Scratch class needs no TCF.

Colour-coding for **"Agreement with standard handicap"** — agrees / disagrees /
"there is no standard" (against the cached Standard Handicaps, §4). *Not fully
understood — open.*

- Import boats from spreadsheet, *hal file*, or **from SailEvent** (a third-party
  regatta-registration system holding an entry list).
- Listings: **BoatsInClub** and **BoatsInClass**.
- **Selectors** — a generic per-boat tag mechanism (e.g. "gold division", "female
  helm"). *Where they can be used in scoring/filtering is open — worth probing.*
- Tools to bulk-delete boats with no results or boats not in any class.

**Boat export schema** (`Boats.xlsx`): Sail Number · Bow · Selectors · Name · Type ·
Owner · Helm · Crew · Club · Email · Phone · Notes · Keel · Engine · Rig ·
Spinnaker · Persons · Category. (Note the boat-measurement fields — Keel/Rig/
Spinnaker/Persons — that a regatta tool wouldn't centre on.)

## 3. Standard handicaps — `/Handicap`

Cached standard handicap lists HalSail maintains: Australian Yardsticks, IRC, RYA
NHC, PY, Small Catamaran Racing System. **IRC** appears updated daily; **PY**
updated this year; the others look stale. These back the "agreement with standard
handicap" colour-coding.

## 4. Schedule — Events, Series, Races

Races and series live under a **Schedule** dropdown; there are also **Events**. The
top entry is a **Race Calendar** (calendar view). You can **List Series** and
**List Races** — but the only creation actions are **New series** and **New tandem
series**; *there is no standalone "New race"* — races exist only inside a series.

### Creating a series

The **first step is choosing the series name and its class** — so a series is
**N:1 with a class** (a class has many series; each series belongs to exactly one
class). This is the structural fact behind per-class tandems (`data-model.md`).

The setup screen then has three sections:

1. **Name, scoring, switches, discards**
2. **List of races**
3. **Copy / delete the series, or make a tandem series**

There's an **embargo** feature controlling when results go public:
**none / 5 minutes / 1 hour / midnight / "hidden, always embargoed."** DBSC sets
the **Master series to "hidden, always embargoed"** — that's how the base class
(§5, the `Master @ 1.000` pattern) is kept out of public view while its derived
tandems publish normally.

**Scoring methods:** Low point · High point · Bonus points · **P75** · RORC
(Cox–Sprague).

**Non-finisher scoring** — 12 codes, each configured as *"Add N points to"* one of:
`zero` / `finishers` / `competitors` / `InClass` / `InSeries`. All default to
**"InClass add 1"**. Built-in common schemes selectable by button:
- RRS A5.2 regatta default: boats **entered** + 1 (taken as boats in class + 1).
- RRS A5.3 long-series default: boats **in the race** + 1, except DNC = boats in
  the **series** + 1.
- Boats that took part in **any** race in the series + 1.
- **Competitors in the race** (boats that came to the starting area) + 1.

**Switches** (booleans, settable to club default): show sail number / country flag /
boat name / owner / helm / crew / boat notes / boat type / club / bow number /
selectors · **Mark provisional** · **Include DNC boats**.

**Discard profile** — set per series, but **only really configurable once races
exist**. Also settable to club default.

### Races within a series

A HalSail **race is a single start, usually for one class** (unlike Sailwave, where
a race can hold multiple starts, or Sail Scoring, where a start spans fleets — see
`data-model.md`, "What a race is").

- A default **Race 1** is created with the series.
- "Add a new race": offers **+1 hour / +1 day / +1 week after last race**, or a
  specific date/time.
- Races can carry a **name/alias** instead of "Race N".
- **List Races** columns: Class · Series · Race · Start.
- No Excel download of a series appears available (boats/classes/races do export).

**Race export schema** (`Races.xlsx`): Start · Class · Series · Race · Alt name ·
Start type (`Normal`) · **Sequence** (`5/4/1/go`) · **Weight** (`100%`) ·
**Excludable** (`1`) · Status (`NoResultsYet`/Provisional/Validated/Cancelled/
Abandoned) · Notes. Note the per-race **Weight** and **Excludable** flags — race
weighting and a per-race "may be discarded" toggle exist at the data level.

## 5. Tandem series — the crux

**New tandem series** asks for a **base class** and a **base series** to draw
results from, then a review step to name the tandem and pick its target class +
races. The on-screen guidance distinguishes the two modes:

> **Note — base class is redundant.** A series is N:1 with a class (§4), so the base
> *series* alone already implies the class; the base-class picker is almost
> certainly just a **UI funnel** to filter the base-series dropdown (the same
> class→series funnel as ordinary series creation). Don't confuse it with the
> *target* class chosen at the review step — that one is meaningful (the class the
> tandem produces results for). A small data point for Output 3's "essential vs
> incidental complexity" question, leaning *incidental UI* here.

- **Different target class** → *"results for any boats that are in **both** the base
  class and the other class"*, with different handicaps / a subset of boats. (This
  is the handicap-view / sub-fleet mode.)
- **Same target class** → *"only some of the races … to create a mini series, or
  different discards or scoring."* (This is the race-subset / discard mode — the
  Series A/B mechanism.)

### The "Master class @ 1.000" pattern (DBSC reproduction)

**A `Level`/Scratch class could not be used as the base class for a handicapped
tandem.** This appears to be exactly why DBSC builds a season as:

1. A **`Master` class, handicap 1.000** — the base that holds the real races and
   results.
2. A **Scratch** tandem and the **handicap** tandems (HPH/ECHO/NHC) all derived from
   Master.

Reproduced for HYC: base `Puppeteer Master` / series `2026 Summer Series`, with
tandems named **`Series 1`** targeting `Puppeteer Scratch`, `Puppeteer HPH (Tue)`,
and `Puppeteer HPH (Sat)`. Each tandem chooses which races to include.

### Derived races are *materialized*

After creating the three tandems, the **6 base races became 24** in List Races —
3 of every 4 marked *"derived from Race_N in series 2026 Summer Series for class
Puppeteer Master."* So a tandem's race membership isn't a pointer/filter; each
included race is **instantiated as a derived race row** sharing the base race's
`Start` and `Race_N`. (Confirmed in `Races.xlsx`: one row per `(class × series)` for
the same `Race_1` / start time.) **Results are entered once, against the base
(Master) race; the derived races carry them.** When entering results you only see
the Master race, not the derivatives.

→ This is the mechanism behind per-class tandem membership (and CLARIFICATIONS
Q1–Q5): including/excluding a race for a class = adding/removing that class's
derived race row, independently of other classes.

**Confirmed:** deleting a race **from a tandem series** removes only that tandem's
derived row — the **base series and the other tandem series keep it.** So this is
how DBSC "flicks"/"stars" a race for one class without touching the others: from
that tandem's results the race is simply gone, while it survives everywhere else.
Per-tandem independent membership is therefore real and operated by row deletion,
not by a shared flag. (**Still open:** whether there's also a distinct "exclude
scores but keep the row" operation — i.e. the `Excludable` flag or a star proper —
versus this outright delete-from-tandem.)

## 6. User roles

- **Race officer** — enter/alter results while races are provisional (not
  validated).
- **Boat Admin** — + add boats to existing classes, alter handicaps.
- **Sailing secretary** — + create classes, schedule races, **validate** races.
- **Club administrator** — + declare races validated, manage users/account.

## 7. Entering results

Pick a **date**, then select the subset of races on that date. You only see/choose
the **base (Master)** race, not derived ones. Optionally **preselect boats** (record
which boats were seen in the start area — this is what "selecting" a boat means).
Per race you can record race-officer name, wind speed range, wind direction, notes
(e.g. course). Then go boat-by-boat entering a **finish time** or a **scoring code**
(default `OK`).

- **Review/print results** → list (class/series/Race N) + a button to the live
  public results.
- **Edit Results** → pick a class/series; all races' results on one page for
  individual editing.
- Race statuses: **Provisional / Validated / NoResultsYet / Cancelled / Abandoned**.

**Results export schema** (`PuppeteerMaster_2026SummerSeries.xlsx`): per-race sheets
— Place · Sail No · Hcap · Helm · Finish · Elapsed · Elapsed seconds · Corrected ·
Corrected seconds · Points · Result note — plus an overall sheet (Rank · Sail No ·
Helm · Hcap · Race N… · Net pts).

## 8. Other outputs

- **Round sheet / spotter sheet** — a printable sheet for scribes to record finish
  times **and lap completion**, plus wind speed, course, number of starters, and
  **time of last finisher** (protest time-limit).
- **QR codes** for links to individual class or series results.

## 9. Import / export everywhere

Classes, boats, and races each export to Excel (with a **"pre-2007 .xls"** toggle);
classes and boats import from spreadsheet or *hal file*, boats also from
**SailEvent**. Series/results export but there's no obvious series *import*.
Downloads captured this session: `RacingClasses.xlsx`, `Boats.xlsx`, `Races.xlsx`,
`PuppeteerMaster_2026SummerSeries.xlsx` (schemas inlined above).

Each import page carries instructions + a downloadable sample spreadsheet. Common
conventions: data may sit anywhere in the **first 26 columns**; a **title row** in
row 1, 2 or 3 names each column; rows are read from under the title row **until a
mandatory column is blank** (so no blank rows mid-data).

### Race import (`SampleRaceSpreadsheet.xlsx`)

One row per **(Class, Series, Start)** — i.e. races are created per class; the
sample staggers four classes (`Squibs`, `IRC 3`, `IRC 4`, `Dinghies`) a few minutes
apart, all sharing series `Thursday 1`. Columns:

| Column | Mandatory | Notes |
|---|---|---|
| **Start** | yes | Excel date/time. |
| **Series** | yes | Series name. |
| **Class** | yes | Racing class (fleet) name. |
| Start type | no | `Normal` (default) / `Pursuit` / `Staggered`. |
| Weight | no | Series-score weight; `100`(%) default, e.g. `200` for a medal race. |
| Excludable | no | `TRUE` default; `FALSE` if the race must count (not discardable). |
| Sequence | no | Start sequence, e.g. `5/4/1/go` (default) or `3/2/1/go`. |
| Alt name | no | Alternative race name, e.g. `Squib Bowl`. |
| Notes | no | Free text. |

Note this creates **base** races per class directly — the tandem/derive step (§5)
is separate. **Open:** can importing races onto an existing season feed tandems, or
only seed base series?

### Boat import (`SampleBoatSpreadsheet.xlsx`)

One row per boat; CSV also accepted. Only **Sail Number** is mandatory (set to `0`
if unknown). The full column set, in three groups:

- **Boat itself** — Sail Number (≤20 chars) · Bow number (≤10) · **Selectors**
  (alpha/numeric flags, e.g. `O`, `LO`, for Youth / Gold Fleet / etc.) · Boat name ·
  Type (≤20, e.g. `J 109`, `ILCA 7`) · Owner · Helm · Crew · Phone · Email
  (`;`-separated) · Club · Notes.
- **Configuration** — Category · Rig · Keel · Engine · Spinnaker · Persons.
- **Class membership** — **Class** (must match a class-register name *exactly* or
  it's ignored) · **Handicap** (only if a class is given; format must match the
  class's handicap type — `0.922` for IRC, `1100`/`942` for RYA_PY) · HandicapNotes ·
  **HandicapHigh** / **HandicapLow** (ORC only — wind-strength variants).

So a single import row both creates the boat **and** enrols it in one class with a
handicap. (Enrolling one boat in several classes presumably needs a row per class,
or the per-boat class screen — **open**.)

### Class import (`SampleRaceSpreadsheet (1).xlsx` — misnamed; content is classes)

Only **Name** is mandatory. Columns: **Name** · **Handicap Type** (default
`level`) · **Flag** (alphanumeric, used in the start sequence) · **Notes**. The
sample's handicap-type tokens — `level`, `TCF`, `IRC`, `NHC`, `RYA_PY` (plus `ORC`
from the boat sheet) — are the identifiers to use. Telling sample row: a class
*"Hot Shots — IRC — IRC fleet for tandem results"*, i.e. a class created **purely to
hold tandem results**, matching the Master-class pattern (§5).

> HalSail's sample downloads share generic filenames (`SampleRaceSpreadsheet.xlsx`),
> so a second download lands as `… (1).xlsx` regardless of content — check the
> header row, not the filename.

### Results import (`SampleResultsSpreadsheet.xlsx`)

One row per finisher. Only **Sail number** is mandatory. Columns: Sail number ·
**Finish time** (`hh:mm:ss`) **or Elapsed time** (alternative) · **Laps** (average-
lap racing only) · **Status** (blank = `OK`; else `OCS`/`RET`/…) · Notes ·
**Start delay** (seconds; staggered starts only). For **level** races (no times),
**rows must be in finishing order**.

The race itself is chosen in the UI before import (the sheet has no
date/series/race columns) — but the sample adds an undocumented **`Class`** column,
letting **one sheet carry finishers across several fleets** (`Dinghies`,
`Small Cats` in the sample). That's the HalSail analogue of DBSC's **combined
day-file** — a single finish sheet split across classes on import. (Finish values
are Excel time-of-day fractions.)

## Still to capture / confirm

- Whether a true **star** ("keep the row, exclude its scores", or the `Excludable`
  flag) exists distinct from the confirmed delete-race-from-tandem (§5). The
  add/remove-race UI on an existing tandem is otherwise resolved (§5).
- What **selectors** can drive (scoring splits? filtered tandems?).
- The "agreement with standard handicap" colour logic.
- The per-case intent behind CLARIFICATIONS Q1–Q5 (deliberate vs slip) — not
  material to the design, but would confirm the "legitimate vs artifact" tags.
