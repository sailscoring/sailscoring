# HYC Open Dinghy Frostbite Use Case

Target use case for introducing Portsmouth Yardstick (PY) handicap scoring
alongside scratch dinghy racing. Read `hyc-use-case.md` (HYC Autumn League)
first -- this document covers only what is different or new.

## Why the Frostbites?

The Autumn League use case introduces time-based finish recording, handicap
correction, and dual scoring. The Frostbites add a different dimension:

- **Portsmouth Yardstick (PY) handicap** rather than IRC/HPH -- a divisor-
  based system with published class numbers, no progressive adjustment
- **Mixed scratch and handicap fleets** -- some fleets are scratch-only,
  some are PY-only, and one fleet (Melges 15) appears in both scratch and
  PY standings
- **Mixed finish recording modes** -- scratch-only fleets need only finish
  positions; the PY fleet needs finish times
- **Heterogeneous boat types in one handicap fleet** -- the PY fleet
  contains IDRA 14s, RS Aeros, Melges 15s, Enterprises, Finns, 49ers,
  etc., each with a different PY number
- **Single race area, shared start sequence** -- all fleets sail the same
  water off the same committee boat, but with separate class starts that
  may be amalgamated at the Race Committee's discretion

This is a simpler scoring setup than the Autumn League (no progressive
handicap, no IRC certificates) but introduces fleet-structure complexity
that the Autumn League doesn't have.

## Event Overview

| Aspect | Detail |
|--------|--------|
| Name | HYC Open Dinghy Frostbite Series |
| Type | Open event (club members + visitors) |
| Duration | Two sub-series: Winter (7 Sundays, Nov--Dec) + Spring (9 Sundays, Jan--Mar), plus New Year's Day Race and Round the Island Race |
| Races | 35 scheduled across both sub-series (2 per day); each sub-series is scored independently |
| Entries | ~50 boats across 5 fleets |
| Race area | 1 -- waters north and west of Howth Harbour |
| Scoring | Low Point, Appendix A, with A5.3 |
| Discards | 1 per 4 races sailed, maximum 4 per series |

## Fleet and Class Structure

All fleets share one race area and one committee boat. They start in
sequence (3-minute start intervals), but the Race Committee may amalgamate
ILCA class starts at their discretion.

### Scratch-Only Fleets

| Fleet | Boat class | Scoring | Typical entries |
|-------|-----------|---------|-----------------|
| ILCA 4 | ILCA 4 | Scratch | ~4 |
| ILCA 6 | ILCA 6 | Scratch | ~12 |
| ILCA 7 | ILCA 7 | Scratch | ~15 |

These are one-design fleets. The scorer records only **finish positions**
(or result codes). No finish times, no handicap numbers. This is the same
workflow as the IODAI use case.

### Melges 15 Fleet

| Fleet | Boat class | Scoring | Typical entries |
|-------|-----------|---------|-----------------|
| M15 | Melges 15 | Scratch + PY | ~8 |

The Melges 15 fleet is one-design (all PY 995), so the scratch standings
are the primary result. However, Melges 15 boats also appear in the Mixed
PY fleet (see below), so their finish times must be recorded even though
the M15 scratch standings only need positions.

This is the dual-scoring pattern from the Autumn League (one finish, two
sets of standings), but simpler: scratch position for the M15 fleet,
PY-corrected time for the Mixed PY fleet.

### Mixed PY Fleet

| Fleet | Boat classes | Scoring | Typical entries |
|-------|-------------|---------|-----------------|
| PY | IDRA 14, RS Aero 5/6, Melges 15, Enterprise, Finn, 49er, RS 600 | PY handicap | ~23 |

This fleet contains every non-ILCA boat, scored by Portsmouth Yardstick.
Finish **times** are recorded and corrected using each boat's PY number.
Melges 15 boats appear here as well as in the M15 scratch fleet.

## Portsmouth Yardstick (PY) Handicap

- **Type:** Fixed class-based rating (not boat-specific, not progressive)
- **Rating value:** PY number, an integer, e.g. 1099 (RS Aero 6), 995
  (Melges 15), 1124 (IDRA 14)
- **Source:** Published by the RYA; the NOR requires PY < 1220 for
  eligibility
- **Formula:** `corrected_time = (elapsed_time × 1000) / PY_number`
- **Behaviour:** The PY number is fixed for the series. All boats of the
  same class share the same PY number. There is no per-boat rating
  variation and no adjustment between races.

### Comparison with IRC and HPH

| Aspect | PY | IRC | HPH/NHC |
|--------|-----|-----|---------|
| Rating granularity | Per class | Per boat (certificate) | Per boat (progressive) |
| Changes mid-series | No | No | Yes (every race) |
| Formula direction | Divide (higher PY = slower) | Multiply (lower TCC = slower) | Multiply (lower NHC = slower) |
| Rating source | RYA published list | Measured certificate | Algorithmic adjustment |
| Typical value | 995--1139 | 0.870--1.050 | 0.700--1.050 |

The key implementation difference: PY divides elapsed time (a higher PY
number means a slower boat, so dividing removes more time), while IRC/HPH
multiply elapsed time (a lower TCC means a slower boat).

## Finish Recording: The Mixed-Mode Problem

This event has two distinct finish recording workflows running
simultaneously on the same race day:

### ILCA fleets: position-only

The finish boat (or a recorder on the committee boat) records the order
in which ILCA boats finish, noting sail numbers and finish positions.
No finish times are needed. This is familiar from IODAI.

### PY and Melges 15 fleets: time-based

All PY-eligible boats (including Melges 15s) need finish times recorded.
The committee boat records sail number + finish time (time of day) for
every non-ILCA finisher. The scorer then:

1. Looks up each boat's fleet(s) and PY number from registration data
2. Calculates elapsed time (finish time minus the PY fleet's start time)
3. Applies the PY correction: `corrected_time = elapsed × 1000 / PY`
4. Ranks by corrected time within the PY fleet
5. For Melges 15 boats, also derives the scratch position within the M15
   fleet from the uncorrected finishing order

This means the scorer works in two modes on the same race day. For the
ILCA races, they enter positions. For the PY race, they enter times.
This is not something the Autumn League requires (all Autumn League
classes use time-based recording).

## Competitor Data

The competitors CSV (`reference/data/py-example/`) shows the data model
for this event:

| Field | Example | Notes |
|-------|---------|-------|
| sailNumber | 635 | Primary identifier |
| name | Cormac Farrelly | Helm |
| class | Melges 15 | Boat class (determines PY number) |
| club | HYC | |
| fleet | PY\|M15 | Pipe-delimited list of fleets; ILCA boats have a single fleet |
| py | 995 | PY number; blank for ILCA boats (scratch-only) |
| crew | Justin Cullen | For double-handers; blank for single-handers |

Key observations:

- **Multi-fleet membership** is encoded as `PY|M15` in the fleet field.
  A Melges 15 competitor belongs to both the PY fleet (handicap) and the
  M15 fleet (scratch). Their single finish time produces results in both.
- **ILCA boats have no PY number** -- they are scratch-only and don't
  participate in PY scoring.
- **Crew names** matter for double-handers (Melges 15, IDRA 14,
  Enterprise). Points accrue to the entered helm (singlehanders) or
  either the named helm or crew (doublehanders) per NOR 15.4.
- **One competitor appears in two fleets with different sail numbers:**
  Dave Kirwan (sail 97) is entered in both ILCA 7 and ILCA 6. This is
  presumably for different rigs on the same hull, not simultaneous racing.

## Scoring Rules (Differences from Autumn League)

The core scoring rules are the same (Low Point, Appendix A, A5.3), but
with different parameters:

| Rule | Autumn League | Frostbites |
|------|---------------|------------|
| Discards | 0 when < 4 races; 1 when 4--9 | 1 per 4 races sailed, max 4 per series |
| DNC score | Entries + 1 (standard) | Entries for the series + 1 |
| DNS/OCS/RET/DSQ score | Starters + 1 (standard) | Boats that came to the starting area + 1 |
| Start time limit | 5 minutes | 5 minutes |
| Finish time limit | 1700/1600 + 20 min | 60 min race limit; 10-min finishing window (ILCA only) |
| TLE code | Not used | Used (ILCA only) -- scored as last finisher + 1 |

The finishing window is notable: ILCA boats that don't finish within 10
minutes of the fleet leader are scored DNF. But the PY fleet has no
finishing window -- only the overall 60-minute race time limit applies.
The Race Committee may also offer a finishing position to the last boat
still racing (SI 16.2).

### Sign-Out Penalty: Additive Penalty Codes in Practice

The original SI 19.1 prescribed DSQ for failure to sign out before racing.
An SI amendment softened this to an additive penalty: SCP (Scoring
Penalty) of 2 points added to each race sailed that day, applied under
RRS 44.3(c) without a hearing.

This is a good real-world example of the additive penalty codes described
in `docs/design/scoring-codes.md`. SCP adds penalty points on top of a
boat's finishing position rather than replacing the result. The boat keeps
its finish; other boats' scores are unaffected. In the Sailwave results,
this shows as e.g. `3.0 SCP` (finished 1st, +2 penalty points = 3.0) or
`4.0 SCP` (finished 2nd, +2 = 4.0). The penalties always appear in pairs
on the same day (2 races per day), confirming the "per race sailed"
wording.

Note that this is SCP with an explicit points value (2 points) stated in
the SI, rather than the default 20%-of-DNF-score calculation from RRS
44.3(c). The system must support both: the default percentage and a
scorer-entered fixed-points override.

## Standalone Races

The New Year's Day Race (1 race) and the Round the Island Race (2 races,
final day) are standalone events that do not count towards series scoring.
They use the same fleet structure but need separate results.

## Result Entry Workflow

### On a typical race day (2 races back-to-back):

1. **Before racing:** Sign-out register completed by all helms by 11:00
2. **Start sequence:** Up to 4 separate starts (ILCA 7, ILCA 6, ILCA 4,
   PY) with 3-minute intervals; ILCA starts may be amalgamated
3. **Race 1 finishes:**
   - ILCA finishers: record sail number + position per fleet
   - PY/M15 finishers: record sail number + finish time (time of day)
   - Record result codes (DNF, RET, OCS, etc.) for non-finishers
4. **Race 2:** same process
5. **After racing:** Sign-in register within 45 minutes of last finish;
   failure to sign in/out = DSQ for all races that day
6. **Scoring:** Enter results; system calculates PY corrected times and
   rankings; publish to club website

### Key Differences from Autumn League Workflow

| Aspect | Autumn League | Frostbites |
|--------|---------------|------------|
| Finish recording | All classes: time of day | ILCAs: position only; PY: time of day |
| Start times needed | Per class (for elapsed time) | Only for PY fleet (ILCAs don't need elapsed time) |
| Handicap systems per boat | Up to 2 (IRC + HPH) | 0 or 1 (PY or nothing) |
| Rating adjustment | After every race (HPH) | Never (PY is fixed) |
| Race areas | 2 (Offshore + Inshore) | 1 |

## Sailwave Implementation (Reference)

The existing Sailwave file for this event (see `reference/data/py-example/`)
shows how the current scorer handles the dual fleet structure:

- 5 fleets defined: ILCA 4, ILCA 6, ILCA 7, M15, PY
- ILCA fleets: scored by position (no rating system)
- M15 fleet: scored by position (scratch), no PY column shown
- PY fleet: scored with "Rating system: PY", PY numbers displayed
- Melges 15 boats appear in both M15 and PY fleet results with different
  rankings (scratch vs. corrected time)
- 14 races in the Spring series, 3 discards (= floor(14/4) = 3)

## MVP Feature Priorities (Additive to Autumn League)

Features needed for the Frostbites that go beyond the Autumn League:

### Must Have

1. **PY handicap correction** -- corrected_time = elapsed_time x 1000 /
   PY_number; rank by corrected time. This is a different formula
   direction from IRC/HPH.
2. **Mixed finish recording** -- some fleets on the same race day use
   position-based entry, others use time-based entry. The UI must support
   both modes, ideally switching per fleet.
3. **Multi-fleet competitors** -- a single competitor belongs to multiple
   fleets (e.g. PY and M15). One finish time produces results in both
   fleets. This is the same concept as dual scoring in the Autumn League,
   but expressed differently: the Autumn League has two handicap systems
   applied to one fleet, while the Frostbites have one competitor in two
   fleets with different scoring modes.
4. **Class-based PY numbers** -- PY is assigned per boat class, not per
   individual boat. All Melges 15s share PY 995. The system should support
   setting PY by class rather than requiring it per competitor.

### Should Have

5. **Flexible discard formula** -- "1 per N races sailed, max M" as a
   configurable rule, rather than hard-coding specific discard tables.
6. **Crew names** -- double-handers need helm + crew recorded; the crew
   field is blank for single-handers.

### Won't Have (MVP)

- TLE (Time Limit Expired) as a distinct result code with special scoring
- Finishing position offers (SI 16.2) -- these are entered as normal
  finishes by the scorer
- Sign-out/sign-in tracking
- Amalgamated start management (the scorer just records what happened)
