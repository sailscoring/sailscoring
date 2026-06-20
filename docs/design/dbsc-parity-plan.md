# DBSC Parity Plan

> **Note (tooling moved):** the parity tooling and data described here now live
> in the sibling **`dbsc-archive`** repo. Commands shown as `pnpm halsail:<x>`
> run there as `pnpm <x>` (e.g. `pnpm compare <day>`), `lib/halsail/` is
> `../dbsc-archive/lib/halsail/`, and the fragments / generated `.sailscoring`
> are under `../dbsc-archive/sources/2026-live/`. The engine they re-score with
> (`lib/scoring.ts`) stays here and is imported across repos. This doc remains
> the design/status record.

## Goal

Demonstrate that Sail Scoring can reproduce Dublin Bay Sailing Club's
published results — exactly — and keep doing so week by week as DBSC scores
new races. The working loop: import each new race from a DBSC finish sheet,
re-score, publish, and confirm our standings match HalSail's for the same
fleets.

DBSC is large (see [the use case](../requirements/dbsc-use-case.md): ~20
classes, six rating systems, season-long series). We are *not* trying to
cover all of it at once. We climb in milestones, each adding a slice of
classes/systems and ending in a demonstrable parity result against
[HalSail](../notes/halsail/querying-public-results.md). Early milestones
prove the existing engine suffices for a real subset; later ones add the
genuinely-new systems (VPRS/ORC/YTC) and structures (WOW, the Super League).

**Parity bar.** For each fleet in scope: same competitors, same per-race
points (including coded results and the per-race "starters + 1" DNC value),
same discards, same net scores, and same finishing order, matched against
the corresponding HalSail `/Result/_Boat/{seriesId}` table.

## Milestone 1 — Thursday Blue cruisers, IRC + ECHO

The smallest slice that exercises the core of the use case on **features the
engine already has** (time entry, per-class starts, IRC, ECHO, scratch,
multi-fleet dual scoring, the sliding discard table, modified A5.3).

### Why this slice

The **Thursday Blue** fleet group is one committee vessel (Corinthian), one
finish sheet, all cruisers — the textbook case for the entry rule (several
class starts, one sheet, entered once, split by registration). It avoids the
Saturday two-vessel complication and the Green-fleet VPRS classes entirely.

### Scope

One Sail Scoring Series modelling the Thursday Blue finish sheet, with these
fleets (each a HalSail series we replicate):

| Fleet | System | HalSail series (Thu) |
|-------|--------|----------------------|
| Cruisers 0 IRC | IRC (fixed TCC) | `95446` |
| Cruisers 1 IRC | IRC | `95450` |
| Cruisers 2 IRC | IRC | `95458` |
| Cruisers 0 ECHO | ECHO (progressive) | `95445` |
| Cruisers 1 ECHO | ECHO | `95452` |
| Cruisers 2 ECHO | ECHO | `95460` |
| Cruisers 3 ECHO | ECHO | `95466` |
| J/109 (within C1) | one-design scratch | `95454` |
| Sigma 33 (within C2) | one-design scratch | `95462` |

A boat appears in every fleet that applies to it (e.g. a Sigma 33 is in
`C2-IRC`, `C2-ECHO`, `Sigma33-OD`) via `Competitor.fleetIds[]`; one finish
entry scores it everywhere. **IRC exists only for Cruisers 0/1/2** — there is
no Cruisers 3 IRC series; C3 is ECHO-only.

### Series model

Model the fleet's racing as a **single season-long Thursday series** that
accumulates every scored Thursday race — this is what HalSail publishes as
"Thursday Overall" (the Racing Programme's Series A/B appear to be prize
sub-divisions, not separate HalSail series). The DBSC sliding discard ladder
(SI A13.4) applies across the whole series and is plain `discardThresholds`
configuration.

### Scoring config to confirm against HalSail

- `dnfScoring = 'startingAreaInclDnc'` — DNC = (boats that came to the
  starting area) + 1, computed **per race** (observed `10/DNC` and `9/DNC` in
  different races of the same series). DBSC SI A13.2; added for this milestone.
- Discard ladder per SI A13.4 (`<4`→0, `4–6`→1, `7–11`→2, … `32+`→6).
- IRC: fixed `Competitor.ircTcc` from the published `Hcap` column.
- ECHO: alpha 0.25 (club), scored **per cruiser class** on Thursday (the
  `Combined Cruisers` pooling is a Tuesday-only thing).

### Sequencing within M1 (de-risking)

1. **IRC first.** Deterministic — TCCs come from certificates / the HalSail
   `Hcap` column, no seed dependency. This should match exactly and proves
   the entry model, the discard ladder, and modified A5.3 end to end.
2. **ECHO next, same series.** The progressive algorithm is the real
   replication risk, and it has a data dependency: to reproduce ECHO from
   race 1 we need each boat's **seed `echoStartingTcf`** (DBSC's 2025
   end-of-season value) and confirmation that DBSC's ECHO is the Irish
   Sailing 2022 progressive method the engine implements.

### Done when

We import the sailed Thursday Blue races, publish, and our IRC and ECHO
standings for C0/1/2/3 (plus J/109 and Sigma 33 scratch) match the
corresponding HalSail tables — and the same holds for the next race once
DBSC scores it.

### Status — achieved (verified by `pnpm halsail:compare`)

The generated file reproduces the Thursday Blue IRC + ECHO standings exactly:
net points, per-race places, codes, discards, and finishing order, matched
against the HalSail tables. `pnpm halsail:compare` confirms this
automatically — green on all nine fleets (Cruisers 0/1/2 IRC, Cruisers
0/1/2/3 ECHO, J/109, Sigma 33). Reaching parity needed five engine changes
and one converter fix, all landed:

1. **`startingAreaInclDnc` `dnfScoring` mode** — modified A5.3 where DNC also
   scores as (came to the starting area) + 1, per race (DBSC SI A13.2). The
   existing `startingArea` mode left DNC on the A5.2 (entries + 1) value.
2. **Redress in handicap fleets** — redress (RDG) previously resolved only in
   scratch fleets; the engine now computes the per-fleet redress average in
   IRC/ECHO fleets too, including the circular-redress aggregation.
3. **RDG types from HalSail + a new method** — the parser reads the RDG type
   from the Place cell; type 2 maps to a new `all_races_excl_dnc` redress
   method (average excluding DNC, up to the discard allowance), with types 1
   (`all_races`) and 3 (`races_before`) mapped to existing methods. Types 4/5
   are noted in `docs/design/horizon.md`.
4. **Per-race rating overrides** — a mid-series fixed-rating (IRC/PY) change
   is modelled exactly: the boat carries its current rating and earlier races
   pin the old value via a per-race override (new `race_rating_overrides`
   table, engine resolution of the per-race applied TCF, a freeze-past
   workflow on handicap update, a per-race Ratings tab, and an override marker
   in the published per-race detail). Boat 2160 (Chimaera), which re-rated
   1.008 → 1.001 mid-series, now reproduces the right *corrected time* in each
   race, not just the right placing — closing what was a latent discrepancy.
5. **RRS A8.1 series tie-break** — surfaced by `halsail:compare` once the
   other four landed: the shared tie-break skipped A8.1 (sorted race scores,
   discards excluded) and mis-ordered boats on equal net points. Now applies
   the A8 ladder in order (A8.1 → A8.2 last-race countback). Affected scratch
   and handicap series alike, not just DBSC (#173).

Converter fix: snapshot lineage ids are now valid RFC 4122 UUIDs, so the file
imports cleanly through the app's `z.uuid()` API boundary (Postgres' `uuid`
column had been lenient and masked the invalid ids).

### Open inputs — resolved for M1

- ECHO seeds and method: confirmed — the engine's Irish Sailing 2022
  progressive ECHO (club alpha 0.25, scored per cruiser class on Thursday)
  reproduces HalSail's ECHO standings; seeds are recovered from the HalSail
  per-race detail (the rating going into each boat's first scored race).
- Finish-sheet data: reconstructed from the HalSail per-race detail tables
  (`Elapsed`/`Finish` columns) via `lib/halsail/parse-results.ts`. A real DBSC
  finish sheet would substitute cleanly for the same import.

## Milestone 2 — Tuesday and Saturday cruisers

Extends M1's working loop to the other two keelboat days, staying within the
**same cruiser classes and rating systems M1 proved** (IRC, ECHO, scratch). No
new corrected-time system — Cruisers 4/5 and the sportsboats, which need VPRS,
wait for M3. The catalog enumeration (`_catalog-public-95476.html`) settled
both open structural questions, and both turned out benign:

- **Tuesday ECHO is pooled.** There are no per-class `Cruisers 0/1/2 Echo (Tue)`
  series — C0/1/2 collapse into one **Combined Cruisers** series (`95502`); C3
  keeps its own Tuesday ECHO (`95467`). There is **no Tuesday IRC** at all, and
  no Tuesday J/109 or Sigma series (those boats fold into the pool on Tuesday).
- **The Saturday "two-vessel" problem does not exist at the results layer.**
  HalSail publishes Saturday **per class**, exactly like Thursday — there is no
  "Saturday Blue/Red" or merged non-Green series. The Hut/Corinthian split is
  an operational start-line detail; scoring is per class and vessel-agnostic.

So M2 reduces to: **Saturday = a second Thursday-Blue-shaped series** (the
existing per-class builder, new fragments), plus a **Tuesday series whose only
novelty is the pooled Combined Cruisers ECHO fleet**. It still exercises
**per-day progressive ECHO** for real — the same boat carrying a different,
independently-evolving ECHO number on each day.

### Scope (concrete series, from the catalog)

**Tuesday** (one vessel, one sheet) — ECHO only, two fleets:

| Fleet | System | HalSail series |
|-------|--------|----------------|
| Combined Cruisers (C0/1/2 pooled) | ECHO | `95502` |
| Cruisers 3 | ECHO | `95467` |

**Saturday** (per class, same shape as Thursday Blue):

| Fleet | System | HalSail series |
|-------|--------|----------------|
| Cruisers 0 IRC | IRC | `95443` |
| Cruisers 1 IRC | IRC | `95449` |
| Cruisers 2 IRC | IRC | `95457` |
| Cruisers 0 ECHO | ECHO | `95444` |
| Cruisers 1 ECHO | ECHO | `95451` |
| Cruisers 2 ECHO | ECHO | `95459` |
| Cruisers 3 ECHO | ECHO | `95465` |
| J/109 | scratch | `95453` |
| Sigma 33 | scratch | `95461` |

Deferred to later milestones: Beneteau 31.7 (its own ECHO + scratch fleets) and
Beneteau 211 (Tuesday ECHO) — both cruiser-adjacent one-designs, folded in with
the other one-designs in M4; the VPRS cruisers C4/5 (M3); WOW (M5). The
catalog's per-class Tuesday/Saturday fleet IDs and series IDs for these are
recorded for when we reach them.

### The one genuinely new piece

**Combined Cruisers pooled ECHO (Tuesday).** Thursday/Saturday score ECHO per
cruiser class; Tuesday pools C0/1/2 into one ECHO fleet for the adjustment and
ranking. The existing per-fleet ECHO models this directly — a single ECHO fleet
holding the pooled roster — so it is a converter/modelling change (one fleet
instead of three), **not an engine change**. Worth confirming the `95502`
roster is exactly C0/1/2 (C3 being separate) when the fragment is captured.

### Sequencing (de-risking)

1. **Saturday first** — now the trivial case: the M1 per-class builder reused
   on Saturday fragments, proving the loop generalises to a second day with no
   new modelling.
2. **Tuesday next** — the pooled Combined Cruisers ECHO fleet, the only new
   modelling in M2.

### Tooling

`halsail-to-sailscoring` and `halsail:compare` were Thursday-Blue-specific. M2
makes them **day-aware** (`pnpm halsail:to-sailscoring <day>` /
`pnpm halsail:compare <day>`), each day with its own fragment set, builder
config, fleet pairings, and output `.sailscoring` carrying its own `seriesId` +
lineage per the M1 update workflow. The per-class builder generalises to
`buildCruiserDaySeries` (Thursday + Saturday); Tuesday gets a small pooled
builder.

### Open inputs

- **Per-day ECHO seeds** are recovered, as for Thursday, from the rating going
  into each boat's first scored race of that day (`firstAppliedHcap`) — no
  external seed file needed.
- **`95502` roster** confirmation (C0/1/2 only) once the fragment is captured.

### Done when

We fetch, generate and compare the Tuesday and Saturday cruiser series, and
`pnpm halsail:compare saturday` / `pnpm halsail:compare tuesday` are green as
Thursday Blue is, and stay green once DBSC scores the next race.

### Status — achieved (verified by `pnpm halsail:compare`)

The tooling is day-aware (`pnpm halsail:to-sailscoring <day>` /
`pnpm halsail:compare <day>`); the per-class builder is `buildCruiserDaySeries`
(Thursday + Saturday) and Tuesday uses `buildCombinedCruisersSeries`.

- **Tuesday — done.** Combined Cruisers (pooled C0/1/2 ECHO, `95502`) and
  Cruisers 3 ECHO (`95467`) both green. The pooled ECHO needed only a fleet
  definition, no engine change, as predicted.
- **Saturday — done, 9/9 fleets green.** Getting there surfaced four
  scoring issues (#174), all fixed — and notably all four were **engine**
  corrections that benefit every handicap series, not converter quirks:
  1. **Per-fleet race exclusion** (refines #129) — a validly-held race with no
     finishers in one fleet was wrongly dropped; now a fleet that came and all
     retired/DNF'd still scores it (came-to-start + 1).
  2. **Additive penalties in handicap fleets** — SCP/ZFP/DPI were applied only
     in the scratch path; now applied in the handicap path too, and rounded to
     the nearest tenth per RRS 44.3(c) (was rounding to a whole point).
  3. **Redress pool** — a boat with RDG in two races got order-dependent values;
     now each redress excludes the boat's other RDG races, equalling the mean of
     its sailed races.
  4. **ECHO 3 dp carry** — the progressive handicap carried full precision
     between races and drifted from the published 3 dp rating; now rounded each
     race like NHC, so a tight corrected-time finish orders correctly.

**M2 is complete: `pnpm halsail:compare {thursday,tuesday,saturday}` is green on
every fleet.**

## Milestone 3 — VPRS, completing the cruiser picture (Cruisers 4/5)

The first milestone to add a **new rating system** to the engine. M1/M2 stayed
within IRC/ECHO/scratch; M3 brings in **VPRS**, the system DBSC uses for the
non-spinnaker Cruisers 4/5 (and, later, the Mixed Sportsboats). It rides the
**finish sheets we already process** — Thursday Blue and Saturday — so no new
sheets are needed; it adds fleets to the existing day series and, with C4/5 in,
**completes the cruiser picture (C0–5)** on those sheets.

### Why this slice

VPRS is the smallest step that exercises a brand-new corrected-time system end
to end, on data we already capture, against the existing compare harness. It
also de-risks M4/M6, which need VPRS for the Mixed Sportsboats and lean on the
same "add a rating system" machinery.

### Scope (concrete series, from the catalog)

On the existing Thursday Blue and Saturday cruiser sheets:

| Fleet | System | HalSail series (Thu / Sat) |
|-------|--------|----------------------------|
| Cruisers 4-5A NS (pools C4A + C5A) | VPRS | `95884` / `95883` |
| Cruisers 4-5B NS (pools C4B + C5B) | VPRS | `95886` / `95885` |
| Cruisers 5A | ECHO | `95473` / `95472` |
| Cruisers 5B | ECHO | `95475` / `95474` |

Multi-fleet membership as before: a C5A boat sits in `Cruisers 4-5A VPRS` *and*
`Cruisers 5A ECHO`; **C4 is VPRS-only** (DBSC publishes no C4 ECHO fleet — ECHO
applies to C0–3 and C5A/5B, not C4). The VPRS pools combine the spinnaker-band
4 and 5 sub-divisions (4A+5A, 4B+5B).

Deferred: **Mixed Sportsboats** (also VPRS) ride the Thursday Red / Saturday
Green sheets, which M4 captures — by then VPRS already exists, so they come
along for free. ORC Club and YTC (the other new rating systems) stay in M4.

### The genuinely new piece — and its one unknown

The engine work to add VPRS as a rating system (independent of DBSC) is tracked
in **#175**.

**A `vprs` scoring system.** VPRS is a **fixed, measured rating** (use-case
classifies it alongside IRC, not progressive), so if it is time-on-time —
`corrected = elapsed × rating` — it reuses the existing static-handicap path
almost verbatim, with a new `vprsRating` competitor field and a fleet
`scoringSystem: 'vprs'`. The **open unknown is the VPRS corrected-time formula**:
the rule isn't in `reference/` and we haven't read a VPRS result yet. Two
shapes to distinguish:

- **time-on-time** (like IRC/ECHO) — a per-boat coefficient; trivial to add.
- **time-on-distance** — needs per-race course distance, which the model does
  not carry; a materially bigger change.

The HalSail per-race detail settles it: `corrected ÷ elapsed` per boat reveals a
time-on-time coefficient (constant per boat across races) versus a
distance-dependent one. Capture a couple of VPRS fragments (`95883`/`95884`) and
deduce the formula before building.

### Sequencing (de-risking)

1. **Source the formula first.** Capture the VPRS fragments, deduce the
   corrected-time formula from `Elapsed`/`Corrected`/rating columns, and find
   the VPRS rule to confirm it. This is the milestone's whole risk; everything
   else is mechanical.
2. **Add the engine system**, mirroring IRC if time-on-time. Fixtures for the
   VPRS corrected-time math (and the 4A+5A / 4B+5B pooling, which is just fleet
   membership).
3. **Extend the converter + compare** for the new fleets on the existing
   Thursday/Saturday builds; confirm `halsail:compare` stays green and the new
   VPRS fleets match.

### Tooling

Reuses the day-aware converter/compare. Adds the VPRS fragments to
`halsail/`, a VPRS branch in `buildCruiserDaySeries` (a measured rating field,
like `ircTcc`), and the new fleet pairings. No new `.sailscoring` files — the
fleets fold into the Thursday and Saturday series.

### Open inputs

- **The VPRS corrected-time formula** (headline) — sourced from the captured
  fragments + the VPRS rule. Determines whether this is a near-trivial IRC-style
  addition or a larger time-on-distance change.
- **Per-boat VPRS ratings** — read from the HalSail `Hcap` column, as for IRC.
- **Static vs progressive** — expected static (a measured certificate); confirm
  from the fragments (does the applied rating change race to race?). If static,
  it inherits the per-race override workflow for a mid-season re-rate, exactly
  like IRC — note the use-case currently lists VPRS as "progressive" in the
  mid-series-rating section, which should be corrected to "fixed".

### Done when

We fetch, generate and compare the Cruisers 4/5 VPRS and 5A/5B ECHO fleets on
the Thursday and Saturday sheets, and `pnpm halsail:compare` is green for them —
giving full C0–5 cruiser parity on both days.

### Status — achieved (verified by `pnpm halsail:compare`)

The VPRS engine system shipped under #175 (static, time-on-time:
`corrected = elapsed × vprsTcc`), confirmed against the real fragments
(`corrected ÷ elapsed` is a constant per-boat coefficient). The converter gained
a `vprsClasses` input on `buildCruiserDaySeries`: each VPRS pool unions its VPRS
roster (C4 VPRS-only + rated C5) with the ECHO sub-fleet roster (C5, including
ECHO-only boats), pulling finishes from both fragments. A mid-season re-rate
becomes a per-race `vprsTcc` override, like IRC. Output bumped to format v7.

`halsail:compare` is now **green on every fleet across all three days** —
Thursday 13/13, Tuesday 2/2, Saturday 13/13 — full cruiser parity C0–5, and the
first new rating system reconciled against real published results. Mixed
Sportsboats VPRS now needs only the Red/Green sheets (M4); the system is built.

## Milestone 4 — the remaining fleets (one-designs, sportsboats, PY)

Everything DBSC publishes that isn't a Cruisers 0–5 fleet: the one-designs, the
Mixed Sportsboats, and the Portsmouth Yardstick classes, across all three days
plus the Water Wags.

**The headline finding from the catalog: there are no ORC Club or YTC fleets in
2026.** No class opted into either system this season, so they have no consumer
— every remaining fleet runs on a system the engine already has (scratch, ECHO,
VPRS, PY). ORC Club and YTC therefore move to **deferred** (revisit only if a
class requests them in a future season); they are no longer M4 blockers. M4
turned out to need **no new engine work at all**: the one suspected exception —
a Water Wags DNC variant — was disproven by the published 2026 results (see M4b
status below).

### Sequencing

1. **M4a — everything except Water Wags, in one shot.** All the one-design,
   sportsboat and PY fleets, on existing systems. No engine change; the work is
   capturing the remaining sheets and generalising the converter.
2. **M4b — Water Wags.** Suspected to need an A5.3 "+2" `dnfScoring` mode; the
   published results showed Water Wags actually score DNC = came + 1, identical
   to the keelboats, so no engine change was needed (see M4b status).

### M4a scope (existing systems only)

The non-cruiser fleets, by system (per-day `seriesId`s are in the catalog,
`_catalog-public-95476.html` — e.g. Dragon Thu `95483` / Sat `95482` /
Tue `95484`):

| System (built) | Fleets |
|----------------|--------|
| **scratch** one-design | Dragon, Flying Fifteen, Ruffian 23, SB20, Shipman, Dublin Bay 21, Fireball, IDRA 14, ILCA 6, ILCA 7, J/80, Glen, Beneteau 211 (scratch), Beneteau 31.7 (scratch) |
| **ECHO** | Beneteau 211, Beneteau 31.7 (each also ECHO, per day) |
| **VPRS** | Mixed Sportsboats (confirmed time-on-time; mixes 1720/J80/etc. on one rating) |
| **PY** | Glen-Mermaid PY (combined when Mermaid numbers are low), PY Class |

Finish-sheet / series structure to settle at execution (no new systems needed):
- **Thursday Red** (Freebird) is its own series — the Thursday one-designs +
  sportsboats + Glen-Mermaid PY.
- **Saturday Green** (Freebird: SB20, Sportsboats, Flying Fifteen, Beneteau
  211) is its own series; the other Saturday one-designs ride the non-Green
  sheet alongside the cruisers (fold into the existing Saturday series or a
  sibling, per the Race Times make-up).
- **Tuesday** is one vessel / one sheet for all keelboats, so its one-designs
  and sportsboats extend the existing Tuesday series (the four starts already
  modelled as per-fleet start times).
- Multi-fleet overlaps recur: e.g. a J/80 is in the **J/80** one-design fleet
  *and* the **Mixed Sportsboats** VPRS fleet — the same `fleetIds[]` trick used
  for Sigma 33 / the C5 boats.

The genuinely-new M4a work is therefore **tooling, not scoring**: capture the
Red/Green (and remaining Tuesday) fragments, and generalise the converter for
one-design-heavy sheets — the current builders are cruiser-shaped, so this
wants a general "day series from a set of fleets" builder (or new day configs),
reusing the multi-fleet, redress, penalty and DNC machinery already in place.

### M4b scope (Water Wags)

- **A5.3 DNC** — the NoR was read as scoring a Water Wag that did not come to the
  start as (boats entered in the series) **+ 2**, versus the keelboats' + 1,
  which would have wanted a new `dnfScoring` mode. The published 2026 results
  disprove this: DNC = (boats that came to the start) **+ 1**, identical to the
  keelboats. No engine change needed — the existing `startingAreaInclDnc` mode is
  correct (see M4b status).
- **Divisions** — up to three Water Wag divisions, some series mixing them; a
  per-fleet subdivision within the one Wags series. The 2026 Summer Series scored
  the Wags as a single fleet, so no divisions were needed for parity.

### Deferred (no 2026 consumer)

- **ORC Club** — time-on-time/distance with an RC-selected wind band per race.
  No DBSC fleet uses it in 2026; defer until a class requests it (then it's a
  new rating system, scoped like VPRS was).
- **YTC** — optional IRC/VPRS substitute; likewise no 2026 fleet. See #175's
  sibling territory and `docs/design/horizon.md`.

### Done when

`pnpm halsail:compare` is green for the M4a fleets across their days, then for
the Water Wags series once M4b lands — leaving only the composite/cross-series
milestones (M5/M6) outstanding.

### Status — M4a achieved (verified by `pnpm halsail:compare`)

M4a is done with **no engine change**, via a general `buildFleetSeries` day
builder (`thursday-red`, `saturday-od`, `tuesday-od` day configs). It scopes
competitors **per fleet** (`comp-{fleetId}-{sail}`) rather than unioning by
sail — sail numbers aren't unique across a mixed keelboat/dinghy sheet (a Dragon
and an ILCA can both be "161"), and a boat genuinely in two fleets scores in
each, matching HalSail's per-fleet publishing. Mixed Sportsboats confirmed VPRS;
PY is `corrected = elapsed × 1000/pyNumber`.

`halsail:compare` across all six day-series: **69 fleets green, 0 diffs** (8
SKIP — fleets with no scored races yet). The compare also learned HalSail's
tied-rank marker (`22=`) and to SKIP fleets with no published results.

### Status — M4b achieved (verified by `pnpm halsail:compare`)

**Also no engine change.** The suspected Water Wags "+2" DNC variant turned out
not to exist: the published 2026 Summer Series scores a Water Wag that did not
come to the start as came + 1, the same as every other DBSC fleet. The clean
proof is race 3, which had no DNS — 21 finishers, came = 21, DNC = 22 = came + 1
(not entries + 2 = 23). So the Wags are an ordinary scratch one-design series
under the existing `startingAreaInclDnc` mode, built via the same
`buildFleetSeries` day builder (a `water-wags` day config, one `Water Wag`
fleet, `dbsc-water-wags-2026.sailscoring`).

`halsail:compare water-wags`: **1 fleet green, 0 diffs** (27 boats, races 1/3/7).
The use-case doc's earlier "DNC = entries + 2" claim has been corrected.

**Milestone 4 is complete.** Every fleet DBSC publishes in 2026 except the
composite series (M5, now also done) and the series-of-series (M6) scores to
parity with no engine change beyond what M1–M3 already landed.

## Milestone 5 — Women on the Water (the Tuesday combine)

The NoR (§4.4) describes WOW as a *separate* women-only series scored under
**ECHO**, fed off the same Tuesday races as the boats' class series — which read
like the project's first genuine **cross-series shared-finish** requirement.

**The published data says otherwise** (same lesson as the Water Wags "+2"). The
HalSail fleet "Women on the Water (Tue)" publishes one series, "Tuesday Overall"
(95505), and:

- It is scored **PY-style time-on-time** (`corrected = elapsed × 1000 ÷ hcap`),
  *not* ECHO — verified to the second across SB20 (919), Ruffian (1031) and J/80
  (917). See `docs/requirements/dbsc-use-case.md` for the worked check.
- It scores the **same physical finishes** as the class fleets (finish times are
  byte-identical), so it is the ordinary **within-series multi-fleet** pattern —
  not a cross-series problem.
- The published helms are mixed male/female; the engine sees a plain cross-class
  handicap combine, so crew-eligibility gating is not a scoring concern.

### Status — M5 achieved (verified by `pnpm halsail:compare`)

**No new engine work, no cross-series mechanism.** WOW is one more PY fleet
(`fl-wow`, "Women on the Water") added to the existing Tuesday series via the
`buildFleetSeries` builder, self-contained from its own fragment
(`tue-wow-95505.html`). `pnpm halsail:compare tuesday-od`: **Women on the Water
green** (7 boats, races 1/4/6, 0 diffs), with every existing Tuesday fleet
unchanged.

The genuine cross-*series* shared-finish feed the NoR implied has **no 2026
consumer** and is deferred — it would only matter if class results and the
combine had to live in *distinct* Series objects for product/UX reasons, which
parity does not require.

## Milestone 6 — RAYC Super League — out of scope (not a HalSail artifact)

M6 was sketched as a series-of-series: rank boats across DBSC races and external
events (HYC Lambay Race, the waterfront regattas), scoring a parent series off
child-series placements with external-result import.

**There is no evidence HalSail computes it.** A full sweep of the 2026 Summer
Series catalog (`_catalog-public-95476.html`) shows no Super League / RAYC /
Lambay / regatta / coastal fleet or series — and the league by definition pulls
in *other clubs'* events that the DBSC HalSail instance never sees. It is almost
certainly maintained off-platform (a spreadsheet), so there is nothing to
reproduce or diff against. M6 is therefore **out of scope for HalSail parity**;
if Sail Scoring ever grows a series-of-series feature it would be driven by the
SI, not by matching a HalSail table. (The "Overall" labels in the catalog are
just HalSail's per-day naming for each fleet's own series — not cross-fleet
combines; the only genuine combine, Women on the Water, is done in M5.)

## Parity achieved (for everything HalSail publishes)

As of M5, Sail Scoring reproduces **every fleet DBSC publishes** in the 2026
Summer Series. A full `pnpm halsail:compare` sweep across all seven day-series:
**71 fleets green, 0 diffs, 0 fails** (8 SKIP — fleets with no published results
yet). The only DBSC scoring artifact not covered is the RAYC Super League, which
HalSail does not compute (above).

This was reached with **no new engine work beyond M1–M3**: M4 (one-designs,
sportsboats, PY, Water Wags) and M5 (Women on the Water) both turned out to be
existing systems and the within-series multi-fleet pattern, once the published
data corrected the NoR-derived assumptions (VPRS-not-progressive, Water Wags
came+1-not-+2, WOW PY-not-ECHO and same-finish-not-cross-series).

Presentation-layer items (prize-exclusion awareness, "starred" race exclusion,
average-points-for-duty overrides) are folded in where the relevant classes
land, not milestones of their own.
