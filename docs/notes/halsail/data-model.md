# HalSail Data Model — and how DBSC uses it

> **Status: Phase 1 deliverable of #235 (Output 2).** Consolidates the
> `sailscoring/dbsc-archive` reconstruction, the public HalSail documentation, and
> the hands-on HYC-in-HalSail walkthrough ([`walkthrough.md`](walkthrough.md)).
> The remaining **TODO** markers are minor, non-blocking confirmations.
>
> Terminology (Tandem series, Star, Flick) is defined once in
> `docs/requirements/glossary.md` — this doc references those entries rather than
> restating them. Source catalogue: [`references.md`](references.md).

HalSail is the hosted race-management + scoring system used by Dublin Bay Sailing
Club (and many UK/IE clubs). We care about its model because DBSC's season
structure is the richest real-world test of how Sail Scoring should handle
per-fleet sub-series (#235, #203).

There are **two distinct HalSail apps** sharing a brand:

- **Live site** (`halsail.com`) — the current operational system.
- **Archive** (`archive.halsail.com`) — a separate, older app holding historic
  results (DBSC's 2022–2025 are here). Different HTML, a four-level AJAX cascade.
  See `dbsc-archive/SOURCES.md` for the endpoint family.

There was also an **offline desktop predecessor** ("HRR Mk2", `halsraceresults.com`)
whose 2018 manual still documents the underlying scoring concepts — see
[`references.md`](references.md).

## Framing: a *club* system, not a regatta tool

A DBSC scorer's framing, and the sharpest lens on the whole model: **"Sailwave was
built for regattas/events; HalSail was built for clubs."** Concretely:

- HalSail centres on the **boat register** — *boats in the club* — not on
  per-event competitors. A boat is a durable club entity enrolled into classes.
- **Series-within-a-series** (tandems) is native, because a club runs many
  overlapping standings off one set of finishes all season. Sailwave's *lack* of
  this is exactly what's read as "not built for clubs."

This is the design tension for Output 3: Sail Scoring is competitor-centric (like
Sailwave) but needs the club-season expressiveness HalSail gets from tandems —
without inheriting HalSail's manual, materialised mechanics (below). The
operator-side detail behind this section lives in [`walkthrough.md`](walkthrough.md).

## Core entities

From the public API (`/HalApi`) and FAQ. **TODO:** verify field-by-field against
captured `GetSeries` / `GetSeriesResult` payloads.

| Entity | Notes |
|---|---|
| **Club** | Owns events and the boat register. |
| **Event** | A scheduled set of races under a club. |
| **Class** (= **Fleet**) | A grouping of boats that race together. A boat may belong to several classes. **A Series belongs to one class** — this is the structural root of per-class tandem membership (below). |
| **Series** | A collection of a *single class's* races with cumulative scoring. Up to 42 races; one handicap system and one scoring/discard config per series. |
| **Race / Heat** | **A single start, usually for a single class** — see "What a race is" below. Carries a `Start` datetime, a `Start type` (Normal / Staggered / Pursuit), `Weight`, and `Excludable`. |
| **Boat** | The durable club entity (not a per-event competitor). Sail number, name, owner, helm/crew, club, plus measurement fields (keel, rig, spinnaker, persons) and **selectors** (generic tags). Enrolled into one or more classes, with a per-class, date-ranged handicap. |
| **Result** | Links a boat to a race: `ElapsedSeconds` (or place, for level racing), `Handicap` (float), and a status code (`RET`, `OCS`, …). |

Public API endpoints seen: `GetSchedule`, `GetScheduleForEvent`, `GetClasses`,
`GetEvents`, `GetClass`, `GetBoat`, `GetRace`, `GetSeries`, `GetSeriesResult`,
`GetDiscards`, `GetScoreBases`, `GetStandardBoatTypes`, `GetParticipation`.
Read-only, unauthenticated, JSON. **TODO:** does the API expose tandem membership
directly, or only via the archive's `_CrsSeryDropDown` join? (In the archive,
which tandem a class is scored under is *only* exposed by a per-class AJAX call,
absent from any results page — `dbsc-archive/README.md`.)

## What a "race" is — granularity differs across the three tools

A pivotal modelling difference, and a first-class concern for Output 3:

- **HalSail** — a **race is a single start**, usually for a single class. The
  per-class race import (one row per `(Class, Series, Start)`, [`walkthrough.md`](walkthrough.md)
  §9) and the materialised derived races both follow from this: the race *is* the
  finest unit. `Start type` (Normal/Staggered/Pursuit) describes how that one start
  runs, not multiple starts.
- **Sailwave** — a **race can have multiple starts** (several fleets/classes
  flighted off one race).
- **Sail Scoring** — a **start covers multiple fleets**, and finish entry is one
  timesheet sorted by finish time across those fleets (the opposite granularity to
  HalSail).

So the same physical "Thursday 18:30 gun" is: one HalSail race per class, possibly
one Sailwave race with several starts, and one Sail Scoring start spanning fleets.
Any mapping between the systems (and the Output 3 design) has to be explicit about
which of these it means by "race." This is also *why* HalSail needs materialised
per-class races where Sail Scoring can treat fleets as views over one start.

## Tandem series — the crux

A **tandem series** (glossary) is an alternative *view* of the same underlying
race data, re-scored under a different handicap, a **subset of races**, or a
different discard rule. Confirmed verbatim by the FAQ: *"alternative result views
derived from the same underlying race data, showing outcomes under different
handicaps, subsets of races, or varied discard rules."*

The decisive fact, and the whole reason for #235:

> **A tandem's race membership is per-class.** Because a Series is per-class, the
> results manager chooses — class by class — exactly which heats land in each
> `(class × tandem)` cell.

Sail Scoring's nearest analogue is a **sub-series**, but a sub-series shares **one
race set across all fleets** (#203). It cannot, today, place the same physical
start in different tandems for different classes. That single gap is the root of
the `dbsc-archive/CLARIFICATIONS.md` divergences (Q1–Q5) and the design driver for
Output 3.

### A tandem draws from a base class + base series — and *materialises* its races

Confirmed live (see [`walkthrough.md`](walkthrough.md) §5). Creating a tandem
selects a **base class** and **base series** to draw results from, in one of two
modes:

- **Different target class** → results for boats in *both* the base and target
  class, under the target's handicap / a subset of boats (the handicap-view /
  sub-fleet mode).
- **Same target class** → a subset of races (a "mini series"), or different
  discards / scoring (the Series A/B mode).

**The decisive mechanic:** a tandem's race membership is **not a filter or pointer
— each included race is instantiated as a derived race row.** Creating three
tandems over a 6-race base series produced **24 races**, three of every four marked
*"derived from Race_N … for class \<base\>."* Results are entered **once, against
the base race**; the derived rows carry them. So including/excluding a race for a
class is literally adding/removing that class's derived row — which is *why*
membership is independent per class, and why DBSC's per-class control (Q1–Q5)
exists at all.

### The "Master class @ 1.000" pattern

A `Level`/Scratch class **cannot be the base** of a handicapped tandem. So DBSC (and
our HYC reproduction) builds a season as: a **`Master` class at handicap 1.000**
holding the real races/results, with **Scratch and the handicap classes (HPH / ECHO
/ NHC) all derived from Master as tandems.** This is a structural workaround, not an
intrinsic concept — worth remembering when judging how much of HalSail's model is
essential vs incidental. The Master series itself is kept off the public results
via the **"hidden, always embargoed"** embargo setting (see
[`walkthrough.md`](walkthrough.md) §4); only the derived tandems publish.

**Confirmed:** deleting a race from a tandem removes only that tandem's derived
row; the base series and sibling tandems retain it. So per-class membership is real
and operated by **row deletion**, scoped to the one tandem — this is how DBSC
flicks/stars a race for a single class (see [`walkthrough.md`](walkthrough.md) §5).

### Per-race flags

The race export exposes two per-race levers beyond membership: **`Weight`** (e.g.
`100%` — race weighting) and **`Excludable`** (`0/1` — whether the race may be
discarded). **Open:** whether a "keep the row but exclude its scores" operation
(a true *star*, or the `Excludable` flag) exists distinct from the delete-from-
tandem above.

### Operator mechanisms

DBSC manipulates per-class tandem membership through two operations (glossary
gives full definitions; both flagged as possibly DBSC-specific colloquialisms):

- **Flick (a race)** — delete an invalid race from a class's series (e.g. one that
  doesn't count under the SI). Used for the single-competitor exclusions — but see
  the note below: that usage is *manual SI enforcement, with misses*, not a rule.
- **Star (a race)** — retain a race but exclude its scores, so travellers to an
  away event aren't penalised while stay-behinds still race.

The tandem-creation and per-class race add/remove UI is documented in
[`walkthrough.md`](walkthrough.md) §5. **Open (minor):** whether a true *star*
("keep the race, exclude its scores") exists distinct from the confirmed
delete-race-from-tandem.

## Handicap systems

Level (non-handicap), **PY** (Portsmouth Yardstick), **IRC**, **ECHO**, **NHC**.
ECHO/NHC are **progressive** — the rating adjusts race-by-race. In DBSC's archive,
fixed-handicap classes (IRC/VPRS) span several days within one series, whereas
**progressive ECHO classes are per-day** — the chain restarts each day
(`dbsc-archive/README.md`). Sail Scoring already implements the relevant
progressive maths (see `docs/design/handicap-scoring.md`); this doc is about
*structure*, not the rating formulae.

Handicap-type tokens (from the class/boat import specs, [`walkthrough.md`](walkthrough.md) §9):
`level`, `TCF`, `IRC`, `NHC`, `RYA_PY`, `ORC` (the last carries wind-strength
`HandicapHigh`/`HandicapLow` variants). A class's local label can differ from its
type — HYC's `NHC` is branded **HPH**. Handicap value format follows the type
(`0.922` for IRC, `1100`/`942` for RYA_PY).

## Discards & scoring

Low-point scoring. A series carries a **discard table** keyed on races sailed
("if 5+ sailed, 2 may be excluded") — the same shape as Sail Scoring's
`getDiscardCount(raceCount, thresholds)`. Each tandem can carry its own discard
rule, which is one of the three things a tandem is allowed to vary.

## How DBSC maps onto Sail Scoring

From the `dbsc-archive` reconstruction (one `.sailscoring` per finish-sheet
day-group, tandems carried as sub-series):

- **One "Overall" per class per day.**
- **Fixed vs progressive split** — fixed (IRC/VPRS) span days; progressive (ECHO)
  restart each day.
- **Named race-subset tandems** — `Thursday/Saturday Series A & B`,
  `Tuesday Series A/B/C`, the whole-event `Summer Series`.
- **Cross-day pools only when explicitly named** — `Thursday & Saturday Combined`,
  `RAYC Super League 1/2`. Never inferred by collapsing a finish-sheet boundary.

### The divergences the shared-race-set model can't reproduce

See `dbsc-archive/CLARIFICATIONS.md` for the evidence. Tagged in #235 by whether
the divergence is a **legitimate need** or a **manual artifact we should not
reproduce**:

| # | What | Legit / artifact |
|---|---|---|
| Q1 / Q5 | Single-competitor "flick" | **artifact** — manual SI enforcement, with misses (#232 closed not-planned) |
| Q2 | Sigma 33 one-design wound up mid-season | **legitimate** (fleet-scoped sub-series) |
| Q3 | Abandoned heat in Series A but not Overall | **probably artifact** — confirm with DBSC |
| Q4 | Shared start → different A/B per class | **legitimate** — the real driver |

## Open questions (minor, non-blocking)

- Whether a true *star* exists distinct from delete-race-from-tandem; what
  **selectors** can drive in scoring/filtering; the "agreement with standard
  handicap" colour logic.
- Whether `/HalApi` exposes tandem membership directly, or only via the archive
  `_CrsSeryDropDown` join.
- Q3 (abandoned heat in Series A not Overall) — deliberate or a slip. Not material
  to the design; would just confirm the "legitimate vs artifact" tag.
- Phase 3 will add field notes from building HYC 2025 — where the per-class model
  forces manual work Sail Scoring's view-over-one-start model would not.
