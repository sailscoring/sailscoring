# Finish Entry Flow

Detailed user flow and wireframe for S-06: Finish Entry — the core workflow
of the Sail Scoring application.

---

## Overview

The finish entry screen is where a scorer records who finished a race and in
what order. It is the highest-traffic screen in the app: used after every race,
often under time pressure, sometimes from a finish boat with intermittent
connectivity.

**Design priorities, in order:**

1. **Speed.** Entering 100+ sail numbers one by one must feel fast. The scorer
   should never need to reach for the mouse during a normal entry run.
2. **Clarity.** After each entry, the scorer must immediately see that it
   registered correctly — who was identified, where they landed in the list.
3. **Recoverability.** Mistakes will happen. Correcting a wrong sail number
   or removing an entry must be quick and non-disruptive to the rest of the list.
4. **Completeness.** At the end of entry, the scorer must be able to see at a
   glance who is still unaccounted for — boats not in the finish list and
   not yet given a result code.

---

## The finish sheet model

The finish entry screen is a digital transcription of the handwritten finish
sheet. The handwritten sheet is a single ordered list of sail numbers in the
order they crossed the line, with a finish time written next to boats whose
fleets use handicap scoring and nothing written next to scratch boats.

The screen mirrors this: **one unified ordered list**. Row order IS crossing
order. Each row is a boat, and each row has an optional finish time. Scratch
rows show "—" in the time column; handicap rows show their finish time.

This model replaces the earlier approach of entering explicit crossing-order
position numbers. Position is no longer a field the scorer types — it is the
row's index in the list, managed by list operations (append, auto-insert, move,
delete).

## Recorded vs Calculated

The finish entry screen deals in **recorded** data — what the scorer observes
on the water. It is important to distinguish this from what the system
calculates.

**Recorded (scorer input):**
- The **ordered list** of finishers for the race. Row order represents the
  order boats crossed the line. The scorer adds rows in order, or inserts/moves
  them later; they never type an explicit position number.
- `Finish.finish_time` — the clock time the boat crossed the finish line.
  Recorded for boats in handicap fleets; omitted for scratch-only boats.
- `Finish.result_code` — a non-finish outcome: DNS, DNF, OCS, etc. Coded
  finishes are not part of the crossing-order list (they have no row index).
- An optional **"tied with previous row"** flag on scratch rows, for the rare
  case where two boats cross the line simultaneously.

**Calculated (scoring engine, not entered by scorer):**
- The per-fleet **rank** (who came 1st, 2nd, 3rd *within their fleet*) is
  derived by the engine. For scratch fleets: from row order among the fleet's
  members. For handicap fleets: from corrected times among the fleet's members.
- Elapsed time, corrected time, points, and series standings are all derived
  automatically.
- There is no cross-fleet "place" concept in results. Only within-fleet rank
  is displayed; the crossing-order list is an input, not a published output.

**Implicit DNC:** A competitor with no finish record for a race is implicitly
scored as DNC. The scorer does not need to manually assign DNC to absent
boats — silence is the signal. An explicit `result_code = DNC` can be recorded
(e.g. to confirm an absence was actively noted), but is not required.

---

## Time field is per-competitor, not per-race

Whether a row has a time field is determined **per-competitor after lookup**,
based on the competitor's fleet. After the scorer selects a competitor, the
system inspects that competitor's fleet(s):

| Competitor's fleet scoring | Time field |
|----------------------------|------------|
| Any handicap system (IRC or PY, later HPH) | **Required**: a finish time field appears in a pending row; the scorer enters the time before the row is added |
| Scratch only | **Not shown**: the row is added immediately with no time prompt |

A single race therefore mixes rows with and without times. This is not a
"mode switch" in the UI — the time column is always visible in the list,
populated for handicap rows and empty for scratch rows. A fleet badge on each
row ("ILCA 7", "PY", "M15 · PY") makes the reason visible at a glance.

---

## Pre-conditions

Before finish entry begins, the scorer must have:

- Created the race (race number, date)
- For handicap series: entered start times for each fleet group. If the
  series has a default start sequence configured (see `series-setup.md`),
  start times are pre-populated at race creation — the scorer only enters
  the first start time and subsequent starts are calculated from the
  configured offsets. Scratch-only fleets do not need a start time.

Start times can also be edited directly on the finish entry screen (they
appear in an editable panel at the top), so the scorer can adjust them
without leaving the entry flow. If start times are missing when the scorer
begins entering finishes for a handicap fleet, the screen shows a prominent
but non-blocking warning.

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
record, the UI shows their existing record subtly (e.g. "Already recorded at
14:23:10" for a timed row, or "Already recorded (ILCA 7)" for a scratch row)
and offers to update it rather than adding a duplicate. See
[List Management](#list-management) for update flows.

### Scratch entry — the fast path

When the scorer selects a competitor whose fleet is scratch-only, the row is
added to the end of the list immediately. No pending state, no time prompt:

```
Scorer types → selects competitor from match list → Enter → in the list

  IRL 1234  Jane Murphy  Junior · Gold        [add]

The finish list now shows the new row at the end:
  ·   ·         ·                 ·                   ↑↓ [×]
  IRL 1234  Jane Murphy       Junior · Gold      —    ↑↓ [×]
```

This is the frostbite ILCA path: the scorer is rattling through sail numbers
and each one lands at the next row in the list with no intermediate
confirmation step.

### Handicap entry — the time path

When the scorer selects a competitor whose fleet uses handicap scoring, a
pending row appears with a finish time field:

```
  IRL 3939  Harmony  Class 2 (IRC)
  Finish time [ 14:23:45 ]

Scorer presses Enter to confirm. The new row is placed at the correct
position in the list — silently auto-slotted by finish time among other
timed rows (see List Management below).

  ·   ·         ·                 ·
  IRL 3939  Harmony             Class 2      14:23:45   [×]
```

The elapsed time is calculated immediately from finish time minus the fleet's
start time. Corrected time is shown if the rating is already set.

**Time input format:**
- Accepts `HH:MM:SS` (e.g. `14:23:45`).
- Colon separators are optional: `142345` is accepted as `14:23:45`.

#### Real-time finish time (live recording)

For recording from the finish boat as boats cross the line, a "Use current
time" option is available on the pending time entry row (a small button or
keyboard shortcut, not shown prominently in the main layout):

- When activated, the time field shows the current wall-clock time, updating
  every second.
- The scorer presses Enter or Space to lock the displayed time and confirm.
- **Sticky:** once enabled for a race, real-time mode stays on for all
  subsequent entries in that race. Turning it off is an explicit action.

### Assigning a result code from the main flow

The scorer can assign a result code directly from the main entry flow — not
only from the "Not yet recorded" panel. After selecting a competitor, result
code buttons or a dropdown are visible alongside the confirmation action:

```
  IRL 0042  Patrick Regan  Senior · Silver
  [add]   [DNS] [DNF] [OCS] [···]
```

Selecting a code creates a coded finish (not part of the crossing-order list)
instead of adding a row. This is useful for entering a batch of OCS boats by
sail number early in the entry session, before finishers start arriving.

---

## The Screen Layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  HYC Frostbite Winter 2026                                                   │
├────────┬─────────────────────────────────────────────────────────────────────┤
│        │                                                                      │
│  Comp. │  Race 5 · Sun 12 Jan 2026            [Entry] [Results] [Standings] │
│        │                                                                      │
│  Races │  Starts: PY 14:05  ILCA 7 14:08  ILCA 6 14:11  ILCA 4 14:14 [Edit]│
│  ▶ R5  │  ─────────────────────────────────────────────────────────────────  │
│    R4  │                                                                      │
│    R3  │  [ 555_                                           ]                  │
│    R2  │    → IRL 555   Aine O'Reilly  PY · RS Aero 6                        │
│    R1  │                                                                      │
│        │  IRL 555  Aine O'Reilly  PY (RS Aero 6)                             │
│  Stnd. │  Finish time [ __:__:__ ]   [add]  [DNS] [DNF] [OCS] [···]          │
│        │                                                                      │
│  Sett. │  Finishers (6)                                                       │
│        │  ┌─────────────────────────────────────────────────────────────┐    │
│        │  │  Sail      Name              Fleet        Time              │    │
│        │  │  IRL 420   Pat Regan         PY           14:23:10    [×]   │    │
│        │  │  IRL 635   Cormac Farrelly   ILCA 7       —        ↑↓ [×]   │    │
│        │  │  IRL 199   Dave Kirwan       PY           14:23:30    [×]   │    │
│        │  │  IRL 12345 Jane Murphy       ILCA 6       —        ↑↓ [×]   │    │
│        │  │  IRL 808   Tom O'Brien       M15 · PY     14:23:45    [×]   │    │
│        │  │  IRL 67890 Alice Brennan     ILCA 7       —        ↑↓ [×]   │    │
│        │  └─────────────────────────────────────────────────────────────┘    │
│        │                                                                      │
│        │  Not yet recorded (44)                       [Assign codes ▾]       │
│        │  ┌─────────────────────────────────────────────────────────────┐    │
│        │  │  IRL 0001  Aoife Brennan    ILCA 7                          │    │
│        │  │  IRL 0003  Cian Walsh       PY · RS Aero 6                  │    │
│        │  │  IRL 0004  ...                                              │    │
│        │  └─────────────────────────────────────────────────────────────┘    │
└────────┴─────────────────────────────────────────────────────────────────────┘
```

**Key layout decisions:**

- The entry input is always at the top of the content area, never buried.
  It is auto-focused on page load and re-focused after each confirmed entry.
- The match list drops inline below the input.
- For scratch-only competitors, the entry is added immediately — no pending
  confirmation row. For handicap competitors, a pending row with the time
  field appears and persists until the time is entered.
- **No position column.** Row order is the data; rows do not show "#1", "#2".
- **Time column is always present**, showing "—" for scratch rows and the
  finish time for handicap rows. This matches the handwritten sheet visually
  and makes mixed-mode entry feel expected, not jarring.
- **Fleet badge** on every row, so the scorer sees why some rows have times
  and others don't.
- **Move controls (↑↓)** appear only on scratch (untimed) rows. Handicap rows
  have no move affordance — see List Management.
- The finish list scrolls independently; the input stays fixed.
- "Not yet recorded" is a separate, scrollable panel below the finish list.
  It shrinks as boats are accounted for.

---

## List Management

The crossing-order list is maintained by simple list operations. There are no
explicit position numbers to shift or renumber — the row's position is its
index in the list.

### The time-order invariant

Timed rows must always be in time order relative to each other. This is the
one hard constraint on the list.

The invariant is enforced **structurally**: timed rows have no move controls
at all. The scorer cannot drag them out of time order because the UI offers
no affordance to move them. The only way a timed row changes position is by
editing its finish time, which auto-slides it to its correct slot (see
Correction below).

Scratch rows are unconstrained — they can be moved anywhere in the list,
including past timed rows.

### Adding a row

- **Scratch entry**: appended to the end of the list. The scorer can move it
  afterwards if it belongs earlier.
- **Handicap entry**: silently auto-slotted into the correct time position.
  The insertion rule: find the earliest slot where the time-order invariant
  holds, and place the new row immediately before the next later-timed row
  (or at the end if no later-timed rows exist). Scratch rows around the
  insertion point keep their relative positions. No confirmation dialog —
  the system just does it.

### Reordering a scratch row

Scratch rows have ↑ and ↓ buttons in the row (reusing the same pattern as
the Fleets card in series settings). Clicking the button moves the row one
step up or down in the list.

A scratch row can be moved past a timed row — the scorer is asserting "this
scratch boat actually crossed before that handicap boat," which is a valid
statement. When a scratch row crosses a timed row, the destination row
**flashes briefly** so the scorer sees where it landed.

Since scratch ranking is computed per-fleet, moving a scratch row past
other-fleet rows has no scoring effect. Only the relative order of
same-fleet scratch rows determines rank within that fleet.

### Deletion

Scorer clicks `[×]` on a row → the row is removed. Everything below shifts
up naturally because the row's position was just its index. No tie-shift
logic, no renumbering math.

### Correcting a finish time

The scorer opens a timed row and edits its finish time. If the new time no
longer satisfies the time-order invariant in the row's current position,
the row **auto-slides** to its correct slot. The destination position
**flashes briefly** so the scorer sees the row move.

Editing a time that stays within the valid range causes no movement.

### Correcting a scratch row

There is nothing to correct about the row's position in isolation — use the
move controls to reposition it. If the scorer entered the wrong sail number,
delete and re-enter.

### Ties between scratch rows

Two boats cross simultaneously in the same scratch fleet. Represent this with
a **"tied with previous row"** flag on the second row. The scoring engine
applies RRS A8.1 averaged consecutive ranks. This is the rare case — tied
handicap finishes are handled naturally by the scoring engine from identical
corrected times.

### Scoring code assignment after a row is recorded

- Scorer looks up a boat that has a row in the list. Instead of updating its
  time, they assign a result code.
- **Most codes** (DNS, DNF, DSQ, OCS, UFD, BFD, RET, DNC): the row is
  removed from the crossing-order list and the boat becomes a coded finish.
  No shifts to manage.
- **SCP** (Scoring Penalty): row is **retained** in the list. The code adds
  penalty points without affecting crossing order.
- **RDG** (Redress Given): treated as a points override on the existing row
  or as a replacement score; list position behaviour follows the redress
  decision. Documented as a special case.

**Drag-reorder is not required for MVP.** The ↑/↓ buttons cover the
correction paths; drag may be added later if scorers want it.

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

- **If the race has any timed rows**, the last finisher time is auto-populated
  as the latest `finish_time` in the list. Displayed as a read-only field
  with an override option.
- **If the race has only scratch rows**, no finish times are recorded, so
  the field cannot be auto-populated. An explicit "Last finisher time" field
  is available for the scorer to enter manually.
- The override or explicit field is always editable.
- Stored as `Race.last_finish_time`. See data-model.md.

---

## Non-Finishers (Result Codes)

After the finish list is complete (or at any point during entry), the scorer
assigns result codes to boats that did not finish normally.

**From the main entry flow:** The scorer can assign codes directly by looking
up a competitor and selecting a code instead of adding a row (or instead of
entering a time, on the pending time row). Useful for batching OCS entries
at the start of a session.

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
(adding penalty points) rather than replacing it. They are applied to boats
already in the list, not from the "Not yet recorded" panel. See
`scoring-codes.md` for the UX design for penalty entry (deferred to Phase 2).

**Implicit DNC:** Boats with no finish record and no result code are
implicitly scored as DNC. The scorer does not need to take any action for
genuinely absent boats — the "Not yet recorded" panel is informational, not
a mandatory worklist.

---

## Scoring

Scoring runs automatically after each finish is confirmed (user story RC-01).
The system recalculates race scores and series standings in the background.

Within-fleet rank is computed from the crossing-order list:

- **Scratch fleets**: iterate the list in order, count only the rows belonging
  to this fleet, and assign ranks 1, 2, 3… to them in that order. Tied rows
  (marked with "tied with previous row") share averaged consecutive ranks per
  RRS A8.1.
- **Handicap fleets**: compute corrected time for each row whose competitor is
  in this fleet (elapsed time × TCF), then rank by corrected time ascending.
  Equal corrected times share averaged ranks.

The scorer does not need to trigger scoring manually. The race results screen
(S-07) always reflects the current state.

There is no cross-fleet "place" in the output — only within-fleet rank.

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

**Drag-reorder in finish list:** The ↑/↓ move controls on scratch rows cover
MVP correction needs. Drag-reorder would make moving a row across many
positions faster but adds implementation complexity.

---

## Open Questions

| # | Question | Impact |
|---|----------|--------|
| 1 | Unregistered boat: inline add (sail number + Fleet required, rest optional) vs. placeholder resolved later? | Medium — common edge case; lean toward inline add, confirm before implementing |
