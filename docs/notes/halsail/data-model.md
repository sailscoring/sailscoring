# HalSail Data Model — and how DBSC uses it

> **Status: seed / in progress.** This is the Phase 1 deliverable of #235 (Output 2).
> It consolidates what we already know from the `sailscoring/dbsc-archive`
> reconstruction and the public HalSail documentation, and marks the gaps that the
> Phase 2 (DBSC walkthrough capture) and Phase 3 (HYC-in-HalSail reproduction) work
> will fill. **TODO** markers flag those gaps.
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

## Core entities

From the public API (`/HalApi`) and FAQ. **TODO:** verify field-by-field against
captured `GetSeries` / `GetSeriesResult` payloads.

| Entity | Notes |
|---|---|
| **Club** | Owns events and the boat register. |
| **Event** | A scheduled set of races under a club. |
| **Class** (= **Fleet**) | A grouping of boats that race together. A boat may belong to several classes. **A Series belongs to one class** — this is the structural root of per-class tandem membership (below). |
| **Series** | A collection of a *single class's* races with cumulative scoring. Up to 42 races; one handicap system and one scoring/discard config per series. |
| **Race / Heat** | One contest, assigned to one class. Has one or more **starts**. |
| **Boat** | Competitor with sail number and handicap(s). |
| **Result** | Links a boat to a race: `ElapsedSeconds` (or place, for level racing), `Handicap` (float), and a status code (`RET`, `OCS`, …). |

Public API endpoints seen: `GetSchedule`, `GetScheduleForEvent`, `GetClasses`,
`GetEvents`, `GetClass`, `GetBoat`, `GetRace`, `GetSeries`, `GetSeriesResult`,
`GetDiscards`, `GetScoreBases`, `GetStandardBoatTypes`, `GetParticipation`.
Read-only, unauthenticated, JSON. **TODO:** does the API expose tandem membership
directly, or only via the archive's `_CrsSeryDropDown` join? (In the archive,
which tandem a class is scored under is *only* exposed by a per-class AJAX call,
absent from any results page — `dbsc-archive/README.md`.)

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

### Operator mechanisms

DBSC manipulates per-class tandem membership through two operations (glossary
gives full definitions; both flagged as possibly DBSC-specific colloquialisms):

- **Flick (a race)** — delete an invalid race from a class's series (e.g. one that
  doesn't count under the SI). Used for the single-competitor exclusions — but see
  the note below: that usage is *manual SI enforcement, with misses*, not a rule.
- **Star (a race)** — retain a race but exclude its scores, so travellers to an
  away event aren't penalised while stay-behinds still race.

**TODO (Phase 2/3 capture):** the actual HalSail UI for creating a tandem,
assigning/removing a race per class, and starring — menu paths, button names,
screenshots. This is the highest-value thing to capture from memory + the DBSC
walkthrough before it fades.

## Handicap systems

Level (non-handicap), **PY** (Portsmouth Yardstick), **IRC**, **ECHO**, **NHC**.
ECHO/NHC are **progressive** — the rating adjusts race-by-race. In DBSC's archive,
fixed-handicap classes (IRC/VPRS) span several days within one series, whereas
**progressive ECHO classes are per-day** — the chain restarts each day
(`dbsc-archive/README.md`). Sail Scoring already implements the relevant
progressive maths (see `docs/design/handicap-scoring.md`); this doc is about
*structure*, not the rating formulae.

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

## Open questions / to capture

- **TODO (Phase 2):** the tandem-creation and per-class race-assignment UI, with
  screenshots. Confirm whether "flick" and "star" are HalSail features or DBSC
  conventions layered on generic operations.
- **TODO (Phase 2):** confirm Q3 — deliberate or a slip?
- **TODO (API):** does `/HalApi` expose tandem membership, or only the archive join?
- **TODO (Phase 3):** field notes from building HYC 2025 — where the per-class
  model forced manual work HYC's Sailwave setup doesn't.
