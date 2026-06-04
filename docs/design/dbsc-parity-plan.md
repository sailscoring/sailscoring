# DBSC Parity Plan

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
**same cruiser classes and the same rating systems M1 proved** (IRC, ECHO,
scratch). No new corrected-time system — Cruisers 4/5 and the sportsboats,
which need VPRS, wait for M3. The point is to prove the model holds across a
boat's *three independent* per-day series, and to confront the one genuinely
new structural problem the season poses: a single results series fed by two
committee boats.

### Why this slice

Tuesday and Saturday reuse everything M1 built (time entry, per-class starts,
multi-fleet dual scoring, the discard ladder, modified A5.3, redress, per-race
overrides) on the same boats, so divergences isolate cleanly to the two things
that are actually new. It also exercises **per-day progressive ECHO** for real
— the same boat carrying a different, independently-evolving ECHO number on
Tuesday, Thursday and Saturday (each its own series, so this falls out of the
model rather than needing new keying — but it is now tested, not assumed).

### Scope

The cruiser fleets on each day, each a HalSail series we replicate:

- **Tuesday** (one vessel, West Pier Hut, one finish sheet, four starts).
  Cruisers 0/1/2 under IRC; the cruisers under ECHO scored as a single
  **Combined Cruisers** pool (not per class — the Tuesday-only wrinkle); plus
  the J/109, Sigma 33 and Beneteau 31.7 one-design results that ride the
  cruiser starts.
- **Saturday non-Green** (two vessels — Hut + Corinthian — swapping weekly,
  one logical series). Saturday Blue (Beneteau 31.7, Cruisers 2) and Saturday
  Red (Cruisers 3, plus the Shipman/Ruffian/Glen/Mermaid one-designs) under
  their scratch/handicap systems. Cruisers 4/5 defer to M3 (VPRS).

Deferred to later milestones: the Red and Green one-design / sportsboat fleets
(M4), the VPRS cruisers C4/5 (M3), WOW (M5).

### What's genuinely new

1. **Combined Cruisers pooled ECHO (Tuesday).** Thursday scores ECHO per
   cruiser class; Tuesday pools all cruisers into one ECHO fleet for the
   adjustment and ranking. If HalSail publishes this as a single "Combined
   Cruisers ECHO" series, the existing per-fleet ECHO models it directly — one
   fleet holding every cruiser, each boat still in its own IRC class fleet via
   `fleetIds[]` — so likely no engine change. But the pooling mechanics (is the
   adjustment computed over the whole pool, or per class within it?) must be
   confirmed against HalSail before assuming so.
2. **Two finish sheets, one series (Saturday non-Green).** The structural gap
   flagged in the use case: the non-Green keelboats are one published series
   but physically split across two committee boats each week. Options, to be
   decided when we reach it:
   - one Sail Scoring series whose race accepts **finishes from both sheets**
     (the engine already scores one finish list per race with per-fleet start
     times, so this may be mostly an entry-UX problem, not a scoring one); or
   - two series merged for standings (heavier — duplicates discard/series
     logic).
   Which is needed hinges on **how HalSail publishes the split**: if it
   publishes one merged non-Green series we match that; if per vessel, the
   problem may not surface at the results layer at all.

### Sequencing (de-risking)

1. **Tuesday first.** Single vessel, single sheet — the clean case. Adds only
   the pooled-ECHO wrinkle and the Tuesday ECHO seeds. Proves independent
   per-day ECHO and the Combined Cruisers model.
2. **Saturday non-Green next.** Tackles the two-vessel / one-series problem on
   the cruiser subset, with the Red one-design boats coming along for the ride.

### Tooling

`halsail-to-sailscoring` and `halsail:compare` are currently Thursday-Blue-
specific (hard-coded fragment files and fleet pairings). M2 generalises them to
per-day inputs — capture the Tuesday/Saturday fragments, add the builders and
pairings — producing one `.sailscoring` per day-series, each carrying its own
`seriesId` + lineage per the M1 update workflow.

### Open inputs

- **Catalog enumeration.** The Tuesday/Saturday cruiser `seriesId`s, from the
  `/Result/Public` catalog shell (`_catalog-public-95476.html`) — including
  whether Tuesday ECHO is one "Combined Cruisers" series or per class, and
  whether Saturday non-Green is one merged series or per vessel.
- **Per-day ECHO seeds.** Tuesday and Saturday 2025 end-of-season
  `echoStartingTcf` per cruiser, independent of the Thursday seeds (or
  recovered, as for Thursday, from the rating going into each boat's first
  scored race of that day).
- **Combined Cruisers pooling mechanics** and the **Saturday split publishing**
  model — both confirmed against HalSail before building.

### Done when

We fetch, generate, update and compare the Tuesday and Saturday cruiser fleets
— IRC and ECHO for C0/1/2/3 (pooled on Tuesday), plus the J/109, Sigma 33 and
Beneteau 31.7 one-design results — and `pnpm halsail:compare` is green for them
as it is for Thursday Blue, and stays green once DBSC scores the next race.

## Subsequent milestones (sketch)

Each builds on the M1/M2 import→score→publish→compare loop.

- **M3 — VPRS.** New corrected-time system in the engine → brings in
  Cruisers 4/5 and the Mixed Sportsboats, and completes the cruiser picture.

- **M4 — Remaining one-designs and rating systems.** The Thursday Red and
  Saturday Green fleets (SB20, Sportsboats, Flying Fifteen, Ruffian, Beneteau
  211/31.7, Dragon, Shipman, Glen/Mermaid, Dublin Bay 21), plus ORC Club and
  YTC where classes requested them, and the PY Mermaid/Glen case. Includes
  the Water Wags A5.3 "+2" variant and divisions.

- **M5 — Composite series (WOW).** A separate series fed from the *same*
  Tuesday finish sheet as the boats' class series — needs a cross-series
  shared-finish feed so the sheet is still entered once.

- **M6 — RAYC Super League.** Series-of-series: rank boats across DBSC races
  and external events (Lambay Race, waterfront regattas), scoring a parent
  series off child-series placements with external-result import.

Presentation-layer items (prize-exclusion awareness, "starred" race
exclusion, average-points-for-duty overrides) are folded in where the
relevant classes land, not milestones of their own.
