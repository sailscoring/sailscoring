# Finish Entry Flow

Detailed user flow and wireframe for S-06: Finish Entry — the core workflow
of the Sail Scoring application.

---

## Overview

The finish entry screen is where a scorer records who finished a race and in
what order (or at what time). It is the highest-traffic screen in the app:
used after every race, often under time pressure, sometimes from a finish boat
with intermittent connectivity.

**Design priorities, in order:**

1. **Speed.** Entering 100+ sail numbers one by one must feel fast. The scorer
   should never need to reach for the mouse during a normal entry run.
2. **Clarity.** After each entry, the scorer must immediately see that it
   registered correctly — who was identified, what position they got.
3. **Recoverability.** Mistakes will happen. Correcting a wrong sail number
   or removing an entry must be quick and non-disruptive to the rest of the list.
4. **Completeness.** At the end of entry, the scorer must be able to see at a
   glance who is still unaccounted for — boats not in the finish list and
   not yet given a result code.

---

## Recorded vs Calculated

The finish entry screen deals in **recorded** data — what the scorer observes
on the water. It is important to distinguish this from what the system
calculates.

**Recorded (scorer input):**
- `Finish.finish_position` — the crossing-order position of this boat across
  the finish line. The UI auto-suggests the next available integer, but the
  scorer can override it before confirming (e.g. to record a tie, or an
  insertion into the middle of the list).
- `Finish.finish_time` — the clock time the boat crossed the finish line.
- `Finish.result_code` — a non-finish outcome: DNS, DNF, OCS, etc.

**Calculated (scoring engine, not entered by scorer):**
- The per-fleet *scoring position* (who came 1st, 2nd, 3rd *within their
  Fleet*) is derived by the engine from the raw `finish_position` values
  (or `finish_time` values for time mode), not entered directly.
- Elapsed time, corrected time, points, and series standings are all
  derived automatically.

**Implicit DNC:** A competitor with no `Finish` record for a race is
implicitly scored as DNC. The scorer does not need to manually assign DNC
to absent boats — silence is the signal. An explicit `result_code = DNC` can
be recorded (e.g. to confirm an absence was actively noted), but is not
required.

---

## Mode Determination

Entry mode is determined **per-competitor after lookup**, not once for the
whole race. After the scorer selects a competitor, the system inspects that
competitor's Fleet's scoring systems:

| Competitor's Fleet scoring | Mode shown |
|----------------------------|------------|
| Any handicap system (IRC or NHC) | **Time mode**: a finish time field appears |
| Scratch only | **Position mode**: auto-suggested crossing position shown for confirmation |

A single race can therefore mix modes entry-by-entry: a Class 1 IRC boat gets
a time field; a Junior scratch boat gets a position field.

---

## Pre-conditions

Before finish entry begins, the scorer must have:

- Created the race (race number, date)
- For time mode: entered start times for each Fleet in this race

Start times can be entered directly on the finish entry screen (they appear
in an editable panel at the top), so the scorer does not need to go to a
separate screen first. If start times are missing when the scorer begins
entering finishes, the screen shows a prominent but non-blocking warning.

---

## The Entry Interaction

### Competitor lookup

The lookup field accepts multiple input forms — "type stuff and the system
figures it out":

- Partial sail number (e.g. `12` matches `IRL 1234`, `GBR 1200`, etc.)
- Full sail number with or without country prefix (`1234` or `IRL 1234`)
- Boat name (partial or full)
- Helm name (partial or full)

As the scorer types, a ranked match list appears inline below the field:

```
Scorer types → ranked match list appears inline below the field
  - Exact numeric match ranks first
  - Prefix matches next (typing "12" shows IRL 1234, GBR 1200, etc.)
  - Boat name / helm name matches appear if no strong sail number match
  - Arrow keys or Tab to navigate the list; Enter to select
  - If there is only one match, Enter selects it without needing to navigate
```

**Country-prefix disambiguation:** If partial input matches both `IRL 999`
and `GBR 999`, both appear in the match list ranked by relevance. The scorer
selects from the list.

**Already-recorded signal:** If the selected competitor already has a finish
record, the UI shows their existing record subtly (e.g. "Already at position
15") and offers to update it rather than adding a duplicate. See
[Position Management](#position-management) for update flows.

### Position mode (IODAI example)

After the scorer selects a competitor in a scratch Fleet, the auto-suggested
next crossing-order position is displayed prominently before confirmation:

```
Scorer types → selects competitor from match list

  IRL 1234  Jane Murphy  Junior · Gold
  Position [ 48 ]   ← auto-suggested; editable before confirm

Scorer presses Enter to confirm. Input clears and re-focuses.

The finish list now shows:
  48  IRL 1234  Jane Murphy       Junior · Gold     [×]
```

The suggested position must be visible *before* the scorer presses Enter.
The scorer can edit the field to record a tie or an insertion (see
[Position Management](#position-management)).

### Time mode (HYC example)

After the scorer selects a competitor in a handicap Fleet, a finish time
field appears:

```
  IRL 3939  Harmony  Class 2 (IRC + NHC)
  Finish time [ 14:23:45 ]

Scorer presses Enter. The finish list shows:
  1  IRL 3939  Harmony  Class 2   14:23:45  (el. 1:18:45)
```

The elapsed time is calculated immediately from finish time minus the Fleet's
start time. Corrected time is shown if the rating is already set.

**Time input format:**
- Accepts `HH:MM:SS` (e.g. `14:23:45`).
- Colon separators are optional: `142345` is accepted as `14:23:45`.

#### Real-time finish time (live recording)

For recording from the finish boat as boats cross the line, a "Use current
time" option is available in time mode (a small button or keyboard shortcut,
not shown prominently in the main layout):

- When activated, the time field shows the current wall-clock time, updating
  every second.
- The scorer presses Enter or Space to lock the displayed time and confirm.
- **Sticky:** once enabled for a race, real-time mode stays on for all
  subsequent entries in that race. Turning it off is an explicit action.

### Assigning a result code from the main flow

The scorer can assign a result code directly from the main entry flow — not
only from the "Not yet recorded" panel. After selecting a competitor (before
confirming a position or time), result code buttons or a dropdown are visible:

```
  IRL 0042  Patrick Regan  Senior · Silver
  Position [ 83 ]   [DNS] [DNF] [OCS] [···]
```

Selecting a code replaces the position/time input and confirms immediately.
This is useful for entering a batch of OCS boats by sail number early in the
entry session, before finishers start arriving.

---

## The Screen Layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  IODAI Leinsters 2025                                                        │
├────────┬─────────────────────────────────────────────────────────────────────┤
│        │                                                                      │
│  Comp. │  Race 5 · Tue 15 Jul 2025             [Entry] [Results] [Standings] │
│        │                                                                      │
│  Races │  Start times: Junior 14:05  Senior 14:07           [Edit]           │
│  ▶ R5  │  ─────────────────────────────────────────────────────────────────  │
│    R4  │                                                                      │
│    R3  │  [ 1234_                                        ]                   │
│    R2  │    → IRL 1234  Jane Murphy  Junior · Gold                           │
│    R1  │    → IRL 12    Bo Larsen    Junior · Silver                         │
│        │                                                                      │
│  Stnd. │  IRL 1234  Jane Murphy  Junior · Gold                               │
│        │  Position [ 48 ]   [DNS] [DNF] [OCS] [···]                         │
│  Sett. │                                                                      │
│        │  Finishers (47)                                                      │
│        │  ┌─────────────────────────────────────────────────────────────┐    │
│        │  │  #   Sail      Name              Fleet           ···        │    │
│        │  │  1   IRL 2468  Tom O'Brien       Senior · Silver  [×]       │    │
│        │  │  2   IRL 1111  Alice Murphy      Junior · Gold    [×]       │    │
│        │  │  3   GBR 999   Sam Smith         Junior · Bronze  [×]       │    │
│        │  │  ·   ·         ·                 ·                          │    │
│        │  │  47  IRL 0077  Bob Jones         Senior · Gold    [×]       │    │
│        │  └─────────────────────────────────────────────────────────────┘    │
│        │                                                                      │
│        │  Not yet recorded (156)                      [Assign codes ▾]       │
│        │  ┌─────────────────────────────────────────────────────────────┐    │
│        │  │  IRL 0001  Aoife Brennan    Junior · Bronze                 │    │
│        │  │  IRL 0003  Cian Walsh       Junior · Silver                 │    │
│        │  │  IRL 0004  ...                                              │    │
│        │  └─────────────────────────────────────────────────────────────┘    │
└────────┴─────────────────────────────────────────────────────────────────────┘
```

**Key layout decisions:**

- The entry input is always at the top of the content area, never buried.
  It is auto-focused on page load and re-focused after each confirmed entry.
- The match list drops inline below the input; after a competitor is selected
  it collapses and the position/time field appears.
- The finish list scrolls independently; the input stays fixed.
- "Not yet recorded" is a separate, scrollable panel below the finish list.
  It shrinks as boats are accounted for.

---

## Position Management

Five scenarios arise when recording, correcting, or updating finish positions.

### Tie-break (two boats, same position)

Two boats cross the line so close together that the scorer calls them tied:

- Scorer selects the second boat; the auto-suggested position is N+1.
- Scorer manually overrides it to N (same as the first boat's position).
- Both boats are now at position N. No subsequent boats are shifted.
- The next auto-suggested position after a tie-break: max(recorded positions) + 1.

This is a niche scenario and intentionally requires a manual override step.

### Insertion into the middle (a boat was missed)

A boat was recorded at the wrong point; it needs to slot in between existing
entries:

- Scorer selects the boat. The auto-suggested position is the next available
  (end of list).
- Scorer overrides the position to the correct insertion point (e.g. 23).
- All existing boats with `finish_position >= 23` are shifted up by 1.
- Exception: tied boats at position 23 are all shifted to 24 together.

### Deletion (entry was wrong)

- Scorer clicks `[×]` on the entry in the finish list.
- All boats with `finish_position >` the deleted position shift down by 1.
- Tie-break awareness: if the deleted boat shared its position with another,
  no shift occurs (the tie partner stays at position N; subsequent boats
  remain at N+1, N+2, etc.).

### Correction (wrong position recorded)

- The "Already at position N" signal appears when the scorer looks up a boat
  already in the finish list.
- The scorer updates the position number. Other boats are automatically
  re-numbered:
  - **Moving up** (new position < old, e.g. 15 → 10): boats at positions
    10–14 shift down by 1 (their position numbers increase by 1).
  - **Moving down** (new position > old, e.g. 10 → 15): boats at positions
    11–15 shift up by 1 (their position numbers decrease by 1).
- Tie-break awareness is preserved throughout: boats sharing a position are
  always shifted as a group, so no tie is inadvertently broken or created.

### Scoring code assignment after position recorded

- Scorer looks up a boat that has a recorded position. Instead of updating
  the position, they assign a result code.
- **Most codes** (DNS, DNF, DSQ, OCS, UFD, BFD, RET, DNC): the position is
  voided. All boats with `finish_position >` the voided position shift down
  by 1.
- **SCP** (Scoring Penalty): position is **retained**. The code adds penalty
  points without affecting finish order.
- **RDG** (Redress Given): treated as a position override (variable points);
  position behaviour depends on the redress decision. Documented as a special
  case but not auto-shifted.

**Drag-reorder: deferred post-MVP.** A GitHub idea issue is filed to revisit
once scorers have used the app. The insertion and deletion paths above are
judged sufficient for MVP.

---

## Start-Line Checklist

A sub-workflow within race entry supporting the DNS / DNF / DNC distinction.
Used before and during the start, not during finish recording.

**Background:** DNC, DNS, and DNF carry different meanings (and potentially
different point values). To distinguish them accurately, the race committee
notes which boats appeared in the starting area and which actually crossed
the start line.

### Phase A — Start area check-in

- Scorer opens the "Start check-in" view within the race entry screen.
- Shows all registered competitors in a searchable list with a checkmark column.
- As boats appear in the start area, scorer looks them up (same fuzzy lookup
  as finish entry) and marks them as "Present at start".
- Running count: "Present: 30 / Registered: 35 / Still looking for: 5"
- The "Still looking for" boats are shown prominently.

### Phase B — Promotion after the start

- Boats that came to the start area but did NOT cross the start line: scorer
  manually marks them DNS.
- Scorer clicks "Promote all remaining" → all "Present at start" boats not
  explicitly marked DNS are promoted to "Started" status (they crossed the
  line and are racing).
- After the race: any "Started" boat not in the finish list is treated as DNF.
  The scorer can bulk-assign DNF to all such boats, or the system treats them
  implicitly as DNF.
- Boats with no "Present at start" record and no explicit result code →
  implicit DNC.

**This workflow is optional.** A scorer who skips start-line check-in can
still operate finish entry normally, but will not be able to distinguish DNS
from DNC automatically.

---

## Last Finisher Time

Protest time limits are calculated relative to the elapsed time of the last
boat to finish (per RRS). The app records this explicitly.

- **Time mode:** last finisher time is automatically the latest `finish_time`
  in the finish list. Displayed as a read-only field with an override option.
- **Position mode:** no finish times are recorded, so it cannot be
  auto-populated. An explicit "Last finisher time" field is available for the
  scorer to enter manually.
- The override or explicit field is always editable.
- Stored as `Race.last_finish_time`. See data-model.md.

---

## Non-Finishers (Result Codes)

After the finish list is complete (or at any point during entry), the scorer
assigns result codes to boats that did not finish normally.

**From the main entry flow:** The scorer can assign codes directly by looking
up a competitor and selecting a code instead of a position/time. Useful for
batching OCS entries at the start of a session.

**From the "Not yet recorded" panel:** Clicking "Assign codes" expands inline
code buttons for each unaccounted boat:

```
  Not yet recorded (156)                           [Assign codes ▾]
  ─────────────────────────────────────────────────────────────────
  IRL 0001  Aoife Brennan    Junior · Bronze    [DNS] [DNF] [OCS] [···]
  IRL 0003  Cian Walsh       Junior · Silver    [DNS] [DNF] [OCS] [···]
  IRL 0004  Fiadh O'Connor   Junior · Gold      [DNS] [DNF] [OCS] [···]
```

Clicking a code button assigns it immediately and removes the boat from the
panel. The `[···]` button opens a picker for less common codes. Code picker
layout (most frequent first):

```
  [DNS]  [DNF]  [OCS]
  [NSC]  [RET]  [DSQ]
  [DNE]  [UFD]  [BFD]
  [DNC]
```

DSQ/DNE/UFD/BFD are protest committee codes; they are deliberately placed after
the common operational codes. See `docs/design/scoring-codes.md` for the full
code taxonomy.

**Additive penalties (ZFP, SCP, DPI):** These codes amend a recorded finish
position rather than replacing it. They are applied to boats already in the
finish list, not from the "Not yet recorded" panel. See `scoring-codes.md` for
the UX design for penalty entry (deferred to Phase 2).

**Implicit DNC:** Boats with no finish record and no result code are
implicitly scored as DNC. The scorer does not need to take any action for
genuinely absent boats — the "Not yet recorded" panel is informational, not
a mandatory worklist.

---

## Scoring

Scoring runs automatically after each finish is confirmed (user story RC-01).
The system recalculates race scores and series standings in the background.

For position mode, the score is the position within the Fleet (not the raw
finish order, which may mix Fleets). After each entry, the system:
1. Looks up the competitor's Fleet.
2. Counts how many finishers of that Fleet are in the list.
3. Assigns that count as the per-Fleet position (i.e. the score).

For time mode, the score is derived from corrected time rank within the Fleet.

The scorer does not need to trigger scoring manually. The race results screen
(S-07) always reflects the current state.

---

## Edge Cases

### Unregistered boat

A boat crosses the finish line whose sail number is not in the series. Possible
causes: late registration not yet added, borrowed sail number, data entry error
in registration.

The scorer types the sail number; the lookup returns "not found". A "not found"
result allows the scorer to proceed to add a minimal entry (sail number + Fleet)
as an unregistered boat with a warning.

> **Open question:** The exact flow for unregistered boats requires further
> design. Options include an inline mini-registration form (sail number +
> Fleet mandatory, rest optional) or a placeholder finish that is resolved
> later on the Competitors screen. The inline add approach is the current
> lean, but neither option is fully designed.

### Score correction after NHC adjustment

For NHC/HPH series: if the scorer corrects a finish after ratings have been
adjusted for subsequent races, the system must re-run the NHC adjustment
cascade (user story RC-07). This is a background operation; the scorer sees
a brief "Recalculating..." indicator.

---

## Deferred to Post-MVP

The following were considered for MVP and explicitly deferred:

**Elapsed time recording:** The app records finish time of day only. Some
finish boats operate stopwatches and record elapsed times directly, avoiding
the need to back-calculate finish times. This is not supported in MVP.
A GitHub idea issue is filed.

**Drag-reorder in finish list:** Insertion and position editing cover MVP
correction needs. Drag-reorder would make mid-list corrections faster but
adds implementation complexity. A GitHub idea issue is filed.

---

## Open Questions

| # | Question | Impact |
|---|----------|--------|
| 1 | Unregistered boat: inline add (sail number + Fleet required, rest optional) vs. placeholder resolved later? | Medium — common edge case; lean toward inline add, confirm before implementing |
