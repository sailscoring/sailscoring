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

HYC scores HPH using Sailwave's built-in `NHC1` rating system. The algorithm has been
confirmed by reverse-engineering the 2025 Puppeteer 22 Championships data
(`reference/data/nhc-example/`), where actual per-race TCFs and finish times are
preserved in full.

**NHC1 algorithm (confirmed Adjust = 0.15, symmetric):**

```
H_i  = elapsed time in decimal minutes
O_i  = 100 / H_i                     # raw performance index
O_avg = mean(O_i) over HPH finishers
P50  = mean(TCF_i) / O_avg            # scale: converts O-units to TCF-units
Q_i  = O_i × P50                     # "fair TCF" — the TCF that would have given
                                      # boat i exactly the fleet-mean corrected time
new_TCF_i = TCF_i + 0.15 × (Q_i − TCF_i)   for finishers
new_TCF_i = TCF_i                            for non-finishers (OCS/DNF/DNC/etc.)
```

`Q_i` is algebraically equivalent to `fair_TCF_i = TCF_i × (CT_avg / CT_i)`. The
P50 formulation is numerically cleaner to implement and matches Sailwave's internal
calculation directly.

The adjustment is **symmetric** — the same 15% rate applies whether a boat
over-performed or under-performed. This differs from the SWNHC2015 spreadsheet
(AdjustP=0.30/AdjustN=0.15); see below.

**Re-alignment is a no-op in NHC1.** Because P50 is constructed from the fleet mean,
`Q_avg = TCF_avg` exactly. The average new TCF equals the average old TCF after every
race, so a re-alignment scale factor is always 1.0. No extra step is needed.

Round `new_TCF_i` to 3 decimal places — this is the boat's handicap for race N+1.

The critical implication: **the TCF applied in race N must be snapshotted**, because
the stored TCF will change after race N is scored. In Sailwave this is the `rrat` field
per result record (distinct from `comprating`, the master stored TCF). Both must be
persisted: `comprating` for the current master handicap, `rrat` (= `tcfApplied`) for
the audit trail of what was actually used in each race. The two can diverge when a
prior update is pending — see "Race rating vs master rating" below.

### ECHO

ECHO is used by some Irish and UK clubs. It differs from HPH/NHC in one key way:
the reference point is the **winner's corrected time**, not the fleet mean.

**Per-race adjustment (from `SWECHO.xls` — Version 2018-01-02-0):**

1. Score the race: `CT_i = ET_i × TCF_i` for each finisher `i`
2. For each finisher, compute the "Best Corrected Rate" — the TCF that would have
   tied the winner:
   ```
   BCR_i = CT_winner / ET_i
   ```
   (For the winner, `BCR = TCF_winner`.)
3. Compute the EchoIndex fleet normalisation factor:
   ```
   EchoIndex = avg(TCF_i) / avg(BCR_i)   over all finishers
   ```
   This keeps the fleet-mean handicap constant from race to race — without it, a
   consistently fast fleet would have all handicaps cut every race.
4. Scale BCR by EchoIndex to get a normalised target:
   ```
   ECHO_i = BCR_i × EchoIndex
   ```
5. Apply a fractional adjustment towards the target:
   ```
   new_TCF_i = TCF_i × (1 − Adjust) + ECHO_i × Adjust
   ```
   Default `Adjust = 0.6` — far more aggressive than HPH/NHC1's Adjust = 0.15.

6. Non-finishers (DNF/DNS/etc.) retain their current handicap unchanged.

**Key difference from HPH/NHC:** HPH and NHC target the fleet mean corrected time
(every boat should finish equal to average); ECHO targets the winner (every boat
should have tied the leader). Combined with the higher Adjust, ECHO reacts more
sharply to individual race results.

### NHC (National Handicap for Cruisers) — background and variants

NHC is the standard progressive handicap system for cruisers in Ireland and the UK.
Two distinct implementations exist:

#### NHC1 — Sailwave built-in (used by HYC)

This is the algorithm described in the HPH section above. Sailwave's `scrratingsystem
= 'NHC1'` activates it; corrected times and per-race TCFs are computed inside
Sailwave and published in results. The scorer updates each boat's master rating before
each race; Sailwave does not write updated ratings back automatically
(`scrupdateratings = 'No'`).

Key properties confirmed from the Puppeteer 22 Championships data:
- **Symmetric Adjust = 0.15** (same rate up and down)
- **Re-alignment is a no-op** (fleet mean conserved by construction)
- **Non-finishers keep their TCF unchanged**
- **`rrat` per result** = TCF applied that race (= `tcfApplied` snapshot)
- **`comprating`** = master stored TCF; may differ from `rrat` when a prior update
  is pending from an earlier event

**Race rating vs master rating:** The gap between `comprating` and race 1 `rrat` in
the Championships data (up to ±0.025 for some boats) reflects ratings that were
updated in a prior event whose master rating had not yet been written back. Both
values must be persisted: the master TCF (what shows in the standings header) and
the race-specific TCF (what was used to compute that race's corrected times).

**Rating storage convention:** Sailwave stores TCFs as raw 3-decimal values (e.g.
`1.319`). The Puppeteer 22 HPH fleet has ratings in the 1.14–1.45 range — all above
1.0 — because the fleet's historical baseline was calibrated against a slow reference
boat. The absolute scale does not affect the algorithm; only relative values within
the fleet matter. Our implementation should store raw TCF and document the convention
clearly.

#### SWNHC2015 — external spreadsheet variant (reference only)

Some clubs use the Sailwave NHC spreadsheet (`SWNHC*.xls`) as an external calculator
rather than Sailwave's built-in NHC1. This variant is more complex:

**Asymmetric adjustment rates:**
```
new_TCF_i = AdjustP × Q_i + (1 − AdjustP) × TCF_i   if Q_i > TCF_i  (over-performed)
          = AdjustN × Q_i + (1 − AdjustN) × TCF_i   if Q_i ≤ TCF_i  (under-performed)
```
Default parameters: `AdjustP = 0.3`, `AdjustN = 0.15`. A boat that over-performed
gets its handicap raised faster than an under-performer's gets lowered.

**SD-based outlier dampening** (added in the 2014 club version):
Boats whose comparative score `Q_i / TCF_i` lies more than 1.5 SD above or 1.0 SD
below the fleet mean receive a smaller adjustment (`AdjustPX = 0.15`,
`AdjustNX = 0.075`) to avoid overreacting to a single exceptional result.

**Re-alignment** (applies in the spreadsheet because the asymmetric rates break
fleet-mean conservation):
```
re_aligned_i = new_TCF_i × (avg_old_TCF / avg_new_TCF)
```
Applied only when `finishers ≥ 3`.

HYC does not use this variant. It is documented here for completeness and in case
a future club supported by this application uses the SWNHC spreadsheet workflow.
See `docs/notes/sailwave-excel-handicap-protocol.md` for the full spreadsheet
analysis.

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
sortOrder: number;      // row index in the crossing-order list (0-based)
finishTime?: string;    // "HH:MM:SS" — recorded for handicap fleet boats
```

A finish record represents one row in the race's crossing-order list. `sortOrder`
is the row index: every non-coded finish has one, assigned by the finish entry UI
and updated as rows are inserted, moved, or deleted. `finishTime` is recorded only
for competitors whose fleet uses a time-based scoring system. A finish with a
`resultCode` (DNS/DNF/etc.) replaces the row data; coded finishes typically have
no `sortOrder` because they do not participate in crossing-order ranking.

This replaces the earlier `finishPosition` field. The cross-fleet "place" concept
is gone — within-fleet rank is computed from `sortOrder` for scratch fleets and
from corrected times for handicap fleets.

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

## Finish entry UX — the finish sheet model

### Core principle

Finish entry is a digital transcription of the handwritten finish sheet — a single
ordered list of boats in the order they crossed the finish line. Row order in the
list **is** crossing order. No explicit position number is stored or displayed; the
row's position in the list is the data.

This is the natural mental model for a scorer working from a handwritten sheet:
sail numbers listed top to bottom in crossing order, with a finish time written
next to the boats whose fleets use handicap scoring and no time for the scratch
classes.

### Time field is per-competitor, determined by fleet scoring

A competitor needs a **finish time** only if any of their fleets uses time-based
scoring (IRC, PY, HPH). A scratch-only competitor needs no time.

In a typical mixed-fleet race the same finish boat records everyone. Handicap
boats get a time recorded as they cross; scratch boats are just tallied in order.
Both appear in the same finish entry list. A fleet badge on each row makes the
reason visible — no implicit mode switch, just a time column populated for some
rows and empty for others, matching the handwritten sheet.

### Transcription and late insertion

The happy path is top-to-bottom transcription of the sheet:

- Scorer enters sail numbers in crossing order
- Scratch entries are appended to the list immediately (fast path: sail number →
  Enter → in the list)
- Handicap entries prompt for a time before being added
- In a correct transcription the times come out in ascending order naturally
  because that is the order the boats crossed

When a boat is entered late (out of order):

- **Handicap entry (has a time)**: silently auto-slotted into the correct time
  position among the other timed rows. No confirmation dialog. The new row is
  inserted immediately before the next later-timed row, preserving scratch rows'
  relative positions around it.
- **Scratch entry (no time)**: appended to the end. The scorer then uses per-row
  move controls to place it where it belongs.

### The time-order invariant and move controls

Timed rows are always in time order relative to each other. This is enforced
**structurally**: timed rows have no move controls at all. Their position in the
list is derived entirely from their finish time (and the list insertion rule).
The only way to change a timed row's position is to edit its time, which
auto-slides the row to its new correct slot.

Scratch rows have up/down move controls (reusing the pattern from the series
Fleets settings card). They can be moved anywhere in the list, including past
timed rows — the scorer is simply saying "this scratch boat actually crossed
before that handicap boat," which is a valid observation.

Since scratch ranking is computed per-fleet from crossing order, moving an ILCA 6
row past an ILCA 7 row has no effect on ILCA 7's scoring. Only the relative order
of same-fleet scratch boats matters for scoring.

### Key invariant

**The list in finish entry always represents crossing order, as observed on the
water, not scoring order.** Scoring order (within-fleet rank) is derived: for
scratch fleets from crossing order among fleet members; for handicap fleets from
corrected times.

Detailed UX for entry, lookup, insertion, and reordering is in
`docs/design/ux/flows/finish-entry.md`.

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

## Phase 2 open questions

The NHC1 algorithm and parameters are now confirmed from real race data
(`reference/data/nhc-example/`; see `docs/notes/sailwave-excel-handicap-protocol.md`
for the spreadsheet variant analysis). The remaining open questions before
Phase 2 implementation begins:

- **Carry-over handicap at series start.** The Championships data shows a gap between
  `comprating` (master TCF) and race 1 `rrat` (TCF actually applied) for most boats,
  indicating ratings were updated in a prior event. The pattern is clear but the
  source of the initial series-start TCF is not: do boats carry over their
  end-of-last-series TCF, is there a class-baseline reset between seasons, or does
  the scorer manually set starting TCFs? Ask the fleet scorer before implementing
  the series-start setup flow.
- **Retroactive edits.** Changing a result for race N invalidates the computed TCF
  for race N+1 and all subsequent races. HalSail requires a manual re-score; we
  need to decide whether to propagate changes automatically, warn the scorer, or
  lock races once handicaps are committed.
- **`tcfApplied` persistence.** The `tcfApplied` snapshot in `HandicapRaceScore`
  must be persisted (not just computed), since the stored handicap changes after
  each race. Corresponds to Sailwave's `rrat` per result record. The
  `Result.rating_used` field from `data-model.md` is the right place for this.
