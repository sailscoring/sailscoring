# ISORA: scoring an Irish Sea offshore season

The Irish Sea Offshore Racing Association (ISORA) runs a season of offshore and
coastal races between Ireland and Wales. It scores the season in Sailwave on a
**high-point** system no other Sail Scoring user has: CHIPS3 fleet-size
normalisation, a difficulty weight per race, and the best five results
counting. This note records how that system actually works, checked against
every table ISORA published for 2024, 2025 and 2026, and how it maps onto Sail
Scoring. The work is tracked in #744.

Sources are in `reference-docs:events/isora*`: each season's Notice of Race and
General Sailing Instructions, race schedule, one set of race SIs per template,
the AGM papers that changed the rules, and every published results page.
`reference-docs:events/isora/validation/` re-scores those pages from their race
data.

## The season

One Notice of Race governs everything, and each race has short supplemental SIs
that state its weight. A season has 16–19 races:

- **Offshore races** across the Irish Sea and beyond: Dun Laoghaire, Holyhead,
  Pwllheli, Douglas, Cork (K2Q), Round Ireland in 2026.
- **The Viking Marine Irish Coastal Series**, four or five day races out of
  Dun Laoghaire, one of them at night.
- **The Plas Heli Welsh Coastal Series**, four or five day races out of Pwllheli.

Everything counts toward the MUSTO ISORA Series and the Wolf's Head Trophy. The
coastal series are also scored on their own.

**Fleets.** Each race is scored separately for Overall (every IRC boat), for
each IRC class by rating band (0 ≥ 1.070, 1 = 1.010–1.069, 2 ≤ 1.009), for a
Two-Handed division, and from 2026 for a YTC class in coastal races. A boat is in
Overall, its class, and the Two-Handed division when it races two-handed, which
it chooses race by race.

**Races run with other organisers.** The D2D (National YC), K2Q (with SCORA and
Royal Cork), the Liverpool YC Midnight Race and Round Ireland come with another
club's SIs, and sometimes its classes. ISORA re-scores them in its own classes.
In 2025 the Royal Dee Offshore Championship scored ISORA race 12O5 together with
the Volvo Dun Laoghaire Regatta's four coastal races.

## The rule, as published

Per fleet, per race:

```
points = round( CHIPS3(place, n) × weight , 0.1 )          rounded once, half-up, after weighting
CHIPS3(p, n) = 95·[((n+1−p)/n)·(1 − 0.986682·e^(−0.1622·n)) + 0.81475·e^(−0.1622·n)] + 5
```

CHIPS3 is Chipstead Sailing Club's formula. Its definition and history are in
`reference-docs:scoring-systems/chips/`. The definition counts only starters in
n, scores a retirement as the place after the last, and scores DNS, DNC and
disqualifications (OCS included) 0. ISORA keeps the formula and DNC, scores DNF
at a fixed value, and from 2025 counts the boats declared to race. Its NoR
doesn't say what a disqualification scores. The definition's tie-break is the
source of NoR 13.5's first step: every race score best to worst, "including if
necessary any discarded scores", then the last race both boats sailed.

| | 2024 | 2025 | 2026 |
|---|---|---|---|
| **n** (fleet size) | the starters — finishers and DNF; a DNS is left out | every boat with a result (the 2024 AGM's "all entered boats … not the number of starters") | every boat that declared it would race (NoR 13.2), non-starters scored DTP |
| DNC | 0, not in n | 0, not in n | 0, not in n |
| DNF | 10 × weight | 10 × weight | 15 × weight |
| DTP ("entered but did not race") | — | — | 8 × weight, in n |
| Weights | coastal 0.8, night 0.9, offshore 1.2, K2Q and James Eadie 1.3, Arklow–Arklow 1.0 | coastal 0.7, offshore 1.1–1.2, James Eadie 1.3 | coastal 0.7, night 0.9, 55-mile offshore 1.1, other offshore 1.2, James Eadie 1.3 |
| Wolf's Head | best 5 of all races | best 5 | best 5 |
| Coastal series | best 4 | best 3 | best 3 |

- Tied places share the average of their points.
- A lone boat scores CHIPS3(1, 1) = 86.1 × weight.
- Standings: highest net wins. A fleet discards (races *it* sailed − N), the
  lowest scores, and among equal scores the earliest race.
- Ties go to the better counted scores, compared highest first, then to the last
  race. NoR 13.5 puts a head-to-head step before the last race, but the published
  results follow plain A8 (deferred, #753).
- Weights come from the race's SI. Where the schedule disagrees, the SI wins
  (NoR 2.7): 2025's race 07O1 is "1.1" in the schedule and 1.2 in its SI, and was
  scored at 1.2.

Every published table re-scores exactly under these rules:

| | Corrected times | Ranks | Race scores | Summary cells | Standings rows |
|---|---|---|---|---|---|
| 2024 | 366 | 366 | 422 | 159 | 150 |
| 2025 | 491 | 491 | 525 | 474 | 188 |
| 2026 | 489 | 489 | 740 | 740 | 226 |

There are two exceptions.

- **Royal Dee 2025.** Sailwave kept the unweighted races (the VDLR four) at full
  precision, so 9 of 28 totals differ from the sum of the printed cells by
  0.1–0.2, with no change of order. Sail Scoring rounds every race score to 0.1
  and will print totals that add up.
- **2026 YTC by-class tables.** ISORA scored the YTC class on the PY system using
  time-on-time factors, which gave 213-day corrected times and the two boats in
  reverse order. The Wolf's Head table scores the same fleet correctly.

The order of rounding is not a detail. Rounding CHIPS3 to 0.1 before weighting
gets 321 of the 1,687 published race scores wrong.

The final 2025 Wolf's Head table is no longer published: isora.org returns 404
and the Wayback Machine has only the 13 May 2025 copy, after 7 races, which
re-scores. The 2025 rules are confirmed by that copy, the per-race pages and
both coastal series and the Royal Dee championship, which are complete.

## Prizes beyond the standings

- **Points Series** (NoR 20.5): total points, no discards (a sub-series #747; a prize ranked on total was deferred to horizon.md, #751).
- **Best New Boat** (20.6): the same, among boats new to ISORA (horizon.md, #751).
- **Victoria Cup** (20.7): each club's best three results per race, from the
  overall table, summed over the season, plus a Barbarian team (team trophies, deferred to horizon.md, #750). Applied to
  the published 2024 table it gives Pwllheli SC 2881.8 and National YC 1575.7,
  matching the announced winner.
- **Under 25 Sailor Prize** (2026, 20.8): per sailor, 10 points down to 1 by
  class place, at least three races. It needs crew lists race by race (horizon.md).

## In Sail Scoring

| ISORA | Sail Scoring |
|---|---|
| High point, CHIPS3 | `pointsSystem: 'highPoint'` with the CHIPS3 formula (#745) |
| Weight per race | `Race.pointsMultiplier` (exists) |
| Best 5 / best 3 | count-best discards (#746); per-sub-series rule (#747) |
| Irish / Welsh coastal series | sub-series of one series, not separate files |
| Overall + class + Two-Handed fleets | multi-fleet competitors (exists); two-handed race by race (#748) |
| DTP, fixed DNF | series scoring codes (#717) counting toward the fleet size (#745) |
| 30% for an undeclared finish (2026 NoR 8.3) | a series penalty code that takes 30% of the boat's points (#752) |
| RRS 44.3(c) scoring penalties (NoR 13.6, 17.3) | ZFP and SCP, the percentage taken in places (#752) |
| Primary / secondary certificate per race | #749; typed per-race overrides meanwhile |
| Races scored by another organiser | finish-sheet CSV import (exists) |
| 10-hour distance race (2026, race 12 CW4) | entered as places on a timeless start (exists); native corrected-distance scoring is on the horizon |
| "Results Matrix" pages: overall, two-handed and YTC on one, the classes on another, each opening on a fleets × races matrix (Sailwave's ScoredSeperatelyMatrix script) | combined pages (#255), two per series, with the race grid (#604) |
| Fleet column (the boat's IRC class) | the Class column; the design goes in a custom field |
| Sailwave `.blw` | import (deferred, #754), which needs a sample file from ISORA |

Penalties, moving boats up behind a penalised boat (NoR 17.5, deferred, #760) and the
BCE / BCR / speed columns (#755) are ISORA requirements no published race
exercises yet. Two points to confirm with ISORA: NoR 8.3 still says
"disqualification" beside the 30%, and whether its 44.3(c) penalty is meant in
places, as 17.5's wording implies, or as 20% of the fixed DNF score, which
would be 3 points.

## ISORA's own data

Keeping the season in several Sailwave files, with aliases, is what produces most
of these. One series with sub-series and race-by-race fleet membership removes
them:

- The same boat entered twice: Albireo in 2024 (its last race went to the
  duplicate, costing it a place in the Irish Coastal Series), and Finally in 2025
  and 2026. Sail Scoring's duplicate detection catches this.
- The 2025 "Irish Coastal by class" link serves the Welsh races.
- Race 16CW5 in 2026 is weighted 0.7 in the Wolf's Head file and its SI, and 0.9
  in the Welsh Coastal file. Two 2026 offshore SIs give 1.1 on the cover and 1.2
  in clause 18.2.
- Two-handed aliases disagree with their main records. Paradox in 05CW3 (2026) is
  DTP as a two-handed boat and has no result at all in the overall race.
- Under 2026's fixed DNF, the last of 18 or more finishers scores less than a boat
  that retired (CHIPS3(18, 18) = 14.2 against DNF's 15).
