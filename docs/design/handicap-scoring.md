# Handicap Scoring

Research and design notes for adding time-based handicap scoring to the application.
Covers mathematics, architecture implications, and phased implementation plan.

---

## The core idea

All handicap systems in Phase 1 and 2 use **time-on-time corrected time scoring**:

```
Elapsed Time (ET)   = Finish Time − Gun Time
Corrected Time (CT) = Elapsed Time × TCF
```

where **TCF** (Time Correction Factor) is a dimensionless number specific to each
boat. Lowest corrected time wins. The ranking logic is otherwise the same as
scratch: places map to points 1, 2, 3..., penalty codes apply identically,
discards and tie-breaking work as before.

---

## Phase 1: Static TCF scoring — IRC and PY

### IRC

IRC (International Rating Certificate) assigns each boat a **TCC** (Time Correction
Coefficient) issued annually by the IRC Rating Authority (RORC/UNCL). The TCC is
used directly as the TCF:

```
CT = ET × TCC
```

TCC typically ranges 0.85–1.10 for club offshore boats. A higher TCC means a
faster-rated boat: if two boats sail at exactly their rated performance, their
corrected times are equal. Example:

| Boat | TCC  | ET (s) | CT (s) |
|------|------|--------|--------|
| A    | 1.05 | 3,600  | 3,780  |
| B    | 0.88 | 4,318  | 3,800  |

Boat A wins by 20 corrected seconds despite finishing 718 seconds earlier on the water.

### PY (Portsmouth Yardstick) / RYA

Each **boat type** (not individual boat) has a PY number published by the RYA
(e.g. Laser Standard = 1100, RS400 = 940). Clubs may apply local adjustments. The
PY number is an integer (typically 800–1200). TCF is derived as:

```
TCF = 1000 / PY
CT  = ET × (1000 / PY)
```

A lower PY number = faster boat type = higher TCF.

| Boat type   | PY   | TCF   | ET (min) | CT (min) |
|-------------|------|-------|----------|----------|
| RS400       |  940 | 1.064 |    60.0  |   63.8   |
| Laser Std   | 1100 | 0.909 |    70.3  |   63.9   |

**Relationship to IRC:** IRC TCC and PY TCF are mathematically identical — both
are a single multiplier applied to elapsed time. The scoring engine uses one
`tcf: number` abstraction for both. The distinction is how it is stored
(raw decimal for IRC; derived from PY integer for PY) and how it is presented
to the scorer.

---

## Phase 2: Progressive handicaps — HPH and ECHO

### HPH (Howth Performance Handicap)

HPH is the progressive time-on-time system used at HYC. It is a local implementation
of NHC (National Handicap for Cruisers). Each boat starts with an initial TCF, which
is adjusted after every race based on performance relative to the fleet average.

**Per-race adjustment (HalSail FAQ — "mathematical explanation" section):**

1. Score the race: `CT_i = ET_i × TCF_i` for each finisher `i`
2. Compute fleet mean corrected time: `CT_avg = mean(CT_i)`
3. For each finisher, compute the "fair TCF" — the TCF that would have given exactly
   average corrected time:

   ```
   fair_TCF_i = TCF_i × (CT_avg / CT_i)
   ```

4. Apply a fractional adjustment towards fair_TCF:

   ```
   new_TCF_i = TCF_i + K × (fair_TCF_i − TCF_i)
   ```

   where K is the *sensitivity factor*, typically **0.1** (10% per race). This
   damps wild swings while progressively converging towards fair ratings.

5. Round `new_TCF_i` to 3 decimal places — this is the boat's handicap for race N+1.

The critical implication: **the TCF applied in race N must be snapshotted**, because
the stored TCF will change after race N is scored. This snapshot is also required
for the audit trail.

### ECHO

A similar progressive scheme used by some Irish and UK clubs. The HalSail FAQ covers
the ECHO formula. Deep research is deferred to when we start Phase 2.

### Why Phase 2 is a significant jump

Phase 1 is stateless: the same TCC/PY number applies to every race; results can be
recalculated from scratch at any time. Phase 2 is stateful: the TCF for race N+1
depends on corrected times from race N. Retroactively changing a race result changes
all downstream handicaps. The scorer must explicitly "commit" each race to trigger
the handicap update. Do not start Phase 2 until Phase 1 is solid and there is
real user experience with static handicap scoring.

---

## Phase 3: ORC Club (deferred)

ORC assigns each yacht a **Time Allowance (TA)** in seconds per mile. The formula
is different from TCF multiplication:

```
Corrected Time = Elapsed Time − TA × course_distance_miles
```

TA varies by true wind speed (TWS) and course type (windward-leeward, circular).
The scorer must record prevailing TWS, course type, and distance after each race.
This is substantially more complex than IRC/PY and should not be attempted before
Phase 1 is thoroughly tested in practice.

ORC advanced methods (PCS, Custom Courses) are far horizon; see `horizon.md`.

---

## Architecture: what needs to change

### Key corrections to the existing data model

The designs in `data-model.md` need adjustment based on the following realities:

**Competitors can be in multiple fleets.** This is a first-class scenario:
- "Melges 15 Scratch" fleet + "PY" fleet (same boat, two different scoring systems)
- "Class 3 IRC" fleet + "Class 3 HPH" fleet (same boat, two different scoring systems)

`Competitor.fleetId: string` (current `types.ts`) must become `Competitor.fleetIds: string[]`.
This is a breaking data model change. Scoring system is one per fleet; a competitor
in multiple fleets gets independent standings in each.

**A start covers one or more fleets, not exactly one.** Multiple fleets can share
the same gun. A competitor in multiple fleets must have all those fleets share the
same start (necessary so that elapsed time is unambiguous).

### New and changed types

#### `RaceStart` — gun time for a group of fleets

```typescript
export interface RaceStart {
  id: string;
  raceId: string;
  fleetIds: string[];   // all fleets sharing this gun time
  startTime: string;    // "HH:MM:SS" — the starting signal time
}
```

One `RaceStart` per start group per race. A race may have several (e.g. Class 1
at 14:05, Class 2 at 14:15). An `RaceStart` with multiple `fleetIds` is the normal
case for mixed-fleet starts.

Time format: `"HH:MM:SS"` is fine for Phase 1. A "+1" suffix or seconds-since-noon
scheme can handle post-midnight finishes later without a breaking format change.
Gun time is the starting signal time, not the individual boat's crossing of the line.

#### Changes to `Finish`

```typescript
finishTime?: string;    // "HH:MM:SS" — added alongside existing finishPosition
```

A finish record has either `finishPosition` (position mode), `finishTime` (time
mode), or a `resultCode`. Both can coexist in the same race when fleets are mixed.

#### Changes to `Competitor`

```typescript
// Replace: fleetId: string
fleetIds: string[];     // one or more fleets

// New:
ircTcc?: number;        // e.g. 0.972 — IRC Time Correction Coefficient
pyNumber?: number;      // e.g. 1034 — RYA Portsmouth Yardstick number
// Phase 2 will add: hphHandicap?: number  (initial TCF for HPH/NHC)
```

#### Changes to `Fleet`

```typescript
scoringSystem: 'scratch' | 'irc' | 'py';  // one per fleet; default 'scratch'
// Phase 2 will add: 'hph' | 'echo'
```

### Scoring engine changes

`calculateRaceScores` and `calculateFleetStandings` stay for scratch fleets.
A new parallel function handles handicap races:

```typescript
export function calculateHandicapRaceScores(
  finishes: Finish[],
  competitors: Competitor[],
  raceStart: RaceStart,        // gun time for this fleet group
  fleet: Fleet,                // determines scoringSystem and getTCF
): Map<string, HandicapRaceScore>

export interface HandicapRaceScore extends RaceScore {
  elapsedTime: number | null;    // seconds; null for coded finishes
  correctedTime: number | null;  // seconds; null for coded finishes
  tcfApplied: number | null;     // TCF used (TCC or 1000/PY); snapshot
}
```

Internally, `getTCF(competitor, fleet)` handles the IRC vs PY distinction:
```
IRC:  tcf = competitor.ircTcc
PY:   tcf = 1000 / competitor.pyNumber
```

Coded finishes (DNS, DNC, DNF, etc.) receive penalty points (fleet size + 1)
regardless of their elapsed time — same as scratch. No time-based penalty
for non-finishers in IRC/PY club racing.

---

## Finish entry UX — the timesheet model

### Core principle

Finish entry should look like a **hand-written timesheet** — an ordered list of
boats in the order they crossed the finish line. This is the natural mental model
for a finish boat officer.

The list is sorted by **finish time of day** where times are recorded, not by
elapsed time or corrected time. Elapsed time depends on when the boat's fleet
started; corrected time depends on handicap. Neither is known on the finish boat.
Finish time (time of day) is universal.

### Position vs time is per-competitor, not per-fleet

A competitor needs a **finish time** only if any of their fleets uses time-based
scoring (IRC, PY, HPH). A scratch-only competitor needs only a **position**.

In a typical mixed-fleet race the same finish boat records everyone. Handicap
boats get a time recorded as they cross; scratch boats are just tallied in order.
Both appear in the same finish entry list.

### Interleaving positions and finish times

The hard part: how does a scratch-position boat relate to a time-recorded boat in
the same list?

Proposed approach: **positions are the primary ordering; finish times sort within
groups**. More precisely:

- All competitors are shown in a single ordered list (one finish entry for the race)
- Time-recorded competitors are sorted by finish time within their contiguous group
- Position-only competitors are manually placed in the list (drag, insert, or number)
- When a scorer enters a finish time for a competitor, that competitor auto-sorts
  relative to adjacent time-recorded competitors
- The system does not attempt to auto-interleave time-recorded boats with
  position-only boats — the scorer sets their relative order

This mirrors what actually happens on the water: the recorder has a timesheet for
handicap classes and a separate tally for one-design classes; the scorer later
merges them based on their knowledge of crossing order.

This design is intentionally left for detailed UX work when implementation begins.
The key invariant: **the list in finish entry always represents crossing order, as
observed on the water, not scoring order**.

---

## Scoring subtleties

### Tie-breaking

RRS A8.2 (most first places, then most second places, etc.) applies unchanged.
In handicap scoring "first place" means first on corrected time. The tie-break
logic is identical; only place determination changes.

### Discards and penalty codes

Unchanged from scratch. Discard rules (A11), non-discardable codes (BFD, DNE),
and additive penalty codes (ZFP, SCP, DPI) apply identically.

### Competitors without a rating

A competitor in a handicap fleet with no TCC or PY number cannot be ranked. They
should be shown with a "No rating" indicator rather than silently excluded.
They still appear in results; they simply have no corrected time and no place.

### The `dnfScoring` setting

The existing `dnfScoring: 'seriesEntries' | 'startingArea'` (A5.2/A5.3) applies
equally to handicap races. Penalty points for coded finishes use fleet-size-based
formulas, not time-based formulas.

---

## Suggested implementation sequence within Phase 1

1. **Data model** — add `RaceStart` to `types.ts`; add `finishTime` to `Finish`;
   add `ircTcc`, `pyNumber`, `fleetIds` (replacing `fleetId`) to `Competitor`;
   add `scoringSystem` to `Fleet`. Update `series-file.ts` and Dexie schema.
   No UI changes yet. This is the only breaking data model change — all existing
   series data will need migration (single-fleet competitors become `fleetIds: [fleetId]`).

2. **Scoring engine** — implement `calculateHandicapRaceScores` with unit tests
   via YAML fixtures in `tests/fixtures/scoring/irc/` and `tests/fixtures/scoring/py/`.
   Keep entirely separate from the scratch scoring path.

3. **Start time entry UI** — add start time recording to the race view.
   Per-start-group time input, stored as `RaceStart`. No handicap scoring yet.

4. **Competitor: multi-fleet and rating fields** — update competitor editing
   to support multiple fleets and to show TCC/PY fields when the fleet uses
   a non-scratch scoring system.

5. **Finish time entry UI** — extend finish entry to support time recording for
   competitors that need it. This is the UX design challenge described above.

6. **Fleet scoring system setting** — add to series/fleet settings UI.

7. **Handicap standings display** — extend standings tables to show corrected
   times. For handicap fleets: show ET, CT, TCF alongside points.

8. **Series file format version** — bump once all new fields are stable.

---

## NHC/ECHO/HPH deep research (deferred to Phase 2)

When ready to start Phase 2, the primary reference is the HalSail FAQ
"mathematical explanation" sections for HPH and ECHO. Key open questions:

- What is the exact sensitivity factor K used in practice at HYC?
- How are DNS/DNC boats treated in the fleet average for the adjustment calculation?
- What happens when fewer than N boats finish (is there a minimum fleet size for adjustment)?
- How is the "carry-over" handicap handled at the start of a new series?
- How does HalSail handle retroactive edits that invalidate a prior race result?

The `tcfApplied` snapshot in `HandicapRaceScore` is the foundation for this work.
For Phase 2, that snapshot needs to be persisted (not just computed), since the
stored handicap on the competitor changes after each race. The `Result.rating_used`
field from `data-model.md` is the right place for this.
