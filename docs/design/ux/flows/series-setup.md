# Series Setup Flow

Detailed user flow for G-02 / S-01: Series Setup — creating and configuring
a new series.

---

## Overview

Series setup is the starting point for any scoring session. It needs to be
fast for experienced scorers who know exactly what they want, and guided
enough for a new scorer who is not sure what they need before they can start.

**Design principles:**

1. **Wizard for new series.** Creating a new series walks the scorer through
   a short sequence of steps. Each step builds on the previous one. The
   wizard is linear but skippable — the scorer can jump ahead or come back
   to any step later via Settings.
2. **Import-first.** Competitors are the best source of truth for fleet
   configuration. Import them early; let the system surface what it detected
   and offer to create fleets.
3. **Fleets are explicit.** Fleets are not silently auto-created. Import can
   propose fleets, but the scorer sees a clear summary ("3 new fleets will
   be created") and confirms. Fleets can also be created manually.
4. **Scoring mode is a fork.** A series is either scratch-only or handicap.
   This is chosen early (or inferred from fleet configuration) and locked
   after the first race has finishes. The choice governs what the scorer
   sees throughout the app: scratch-only hides starts, finish times, and
   time prompts entirely.
5. **Settings screen is the wizard, revisited.** There is no separate
   "setup mode" that graduates to "settings mode". A scorer who returns six
   months later to add a fleet sees the same configuration interface, just
   without the wizard's linear nudging.

---

## The Series Creation Wizard

Clicking **New Series** on the Series List (G-01) launches the wizard. The
series is created immediately (with a placeholder name) so it persists even
if the scorer abandons the wizard partway through. Each step saves its state
as the scorer progresses.

### Step sequence

```
[1. Name & Basics]  →  [2. Import Competitors]  →  [3. Fleets]  →  [4. Scoring & Discards]  →  [Done]
```

A progress indicator shows the current step. The scorer can:
- Skip any step (button: "Skip for now")
- Go back to any completed step
- Exit the wizard at any point — the series is saved and accessible from
  the series list

### Placeholder Names

Placeholder names are generated from a small wordlist using the pattern
**[Adjective] [Noun] Series**. They are clearly temporary (no scorer would
name their event this) but mildly amusing — a small signal that the
application has a personality.

Examples: *Gusty Halyard Series*, *Briny Barnacle Series*,
*Choppy Rudder Series*, *Leaky Cleat Series*, *Squalling Mizzen Series*.

---

## Step 1: Name & Basics

The first step. Auto-focuses and selects the name field so the scorer can
immediately type over the placeholder.

```
┌────────────────────────────────────────────────────────────────────────┐
│  New Series                                          Step 1 of 4      │
│                                                                       │
│  Name    [ Gusty Halyard Series______________ ]                       │
│            ↑ auto-focused, text selected                              │
│                                                                       │
│  Venue   [ ______________________________________ ]  (optional)       │
│                                                                       │
│  Dates   [ Start date ]   [ End date ]               (optional)       │
│                                                                       │
│                                                                       │
│  [Skip for now]                                  [Next: Competitors →] │
└────────────────────────────────────────────────────────────────────────┘
```

All fields except Name are optional. A series can operate without a venue
or dates. The scorer can return to this step at any time via Settings.

---

## Step 2: Import Competitors

The primary way to populate a series and the best source of fleet
information. See `competitor-import.md` for the full import flow.

```
┌────────────────────────────────────────────────────────────────────────┐
│  New Series                                          Step 2 of 4      │
│                                                                       │
│  Import your competitors from a CSV file. This is the fastest way     │
│  to set up your series — fleet information can be detected from the   │
│  import.                                                              │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                                                                 │  │
│  │          Drop a CSV file here, or  [Choose file]               │  │
│  │                                                                 │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  Or add competitors manually later.                                   │
│                                                                       │
│  [◀ Back]   [Skip for now]                        [Next: Fleets →]   │
└────────────────────────────────────────────────────────────────────────┘
```

If the scorer uploads a CSV, the standard import flow runs (map & preview →
confirm). At the confirmation step, the summary explicitly reports fleet
creation:

```
  Ready to import

  147  competitors will be added
    3  fleets will be created: Junior, Senior, Class 1
    2  rows skipped (errors)

  [◀ Adjust mapping]                    [Import 147 competitors]
```

The "3 fleets will be created" line is prominent — this is the moment the
scorer sees what structure the import will impose. After confirming, the
wizard advances to Step 3 with the detected fleets pre-populated.

If the scorer skips this step, Step 3 starts with no fleets and they must
create them manually.

---

## Step 3: Fleets

Fleet configuration. The scorer sees any fleets detected from the import
and can add, rename, reorder, or remove fleets. This is also where the
scorer chooses the series scoring mode.

### Scoring mode choice

The top of the step asks the fundamental question:

```
┌────────────────────────────────────────────────────────────────────────┐
│  New Series                                          Step 3 of 4      │
│                                                                       │
│  How will this series be scored?                                      │
│                                                                       │
│  ◉ Scratch (position-based)                                          │
│    Boats are ranked by the order they cross the finish line.          │
│    No finish times needed.                                            │
│                                                                       │
│  ○ Handicap (time-corrected)                                         │
│    Some or all fleets use IRC, PY, or other time-based systems.      │
│    Finish times are recorded for handicap fleets.                     │
│                                                                       │
```

**Default:** If the import detected rating columns (IRC TCC, PY, NHC), the
default is Handicap. Otherwise, the default is Scratch.

**The lock rule:** the scoring mode can be changed freely until the first
race in the series has any finishes recorded. After that, it is locked with
an explanation: "Scoring mode is locked because Race 1 has finishes. To
change it, remove all finishes first." This avoids the cascading complexity
of retrofitting start times, finish times, and start groups onto existing
race data.

A handicap series can still have scratch fleets (e.g. ILCA one-design
fleets alongside a PY handicap fleet). The scoring mode simply enables the
starts/times subsystem; individual fleets configure their own scoring
system.

### Fleet list (scratch mode)

In scratch mode, fleets are optional for simple single-fleet series. The
wizard offers an explicit choice:

```
│                                                                       │
│  ┌─ Fleets ──────────────────────────────────────────────────────┐   │
│  │                                                               │   │
│  │  Will this series have multiple fleets?                       │   │
│  │                                                               │   │
│  │  ○ No — single fleet, all competitors together               │   │
│  │  ◉ Yes — competitors race in separate fleets                 │   │
│  │                                                               │   │
│  │  ☰  Junior                                      [Rename] [×] │   │
│  │  ☰  Senior                                      [Rename] [×] │   │
│  │                                                               │   │
│  │  [+ Add fleet]                                                │   │
│  │                                                               │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  [◀ Back]   [Skip for now]                      [Next: Scoring →]    │
└────────────────────────────────────────────────────────────────────────┘
```

If competitors were imported and fleets detected, the "Yes" option is
pre-selected and the fleet list is pre-populated. If only one fleet was
detected (or no import was done), "No" is the default.

The IODAI use case is a scratch series with two fleets (Junior and Senior).
This step makes that configuration straightforward without requiring the
scorer to understand handicap scoring.

### Fleet list (handicap mode)

In handicap mode, fleets are always required. The fleet list adds a scoring
system selector per fleet:

```
│                                                                       │
│  ┌─ Fleets ──────────────────────────────────────────────────────┐   │
│  │                                                               │   │
│  │  Fleet            Scoring                                     │   │
│  │  ────────────     ──────────────────────                     │   │
│  │  ☰  ILCA 7       [Scratch        ▾]              [Rename] [×]│   │
│  │  ☰  ILCA 6       [Scratch        ▾]              [Rename] [×]│   │
│  │  ☰  ILCA 4       [Scratch        ▾]              [Rename] [×]│   │
│  │  ☰  PY           [PY             ▾]              [Rename] [×]│   │
│  │  ☰  M15          [PY             ▾]              [Rename] [×]│   │
│  │                                                               │   │
│  │  [+ Add fleet]                                                │   │
│  │                                                               │   │
│  │  ─────────────────────────────────────────────────────────── │   │
│  │                                                               │   │
│  │  Default Start Sequence                                       │   │
│  │                                                               │   │
│  │  Defines how fleets are grouped at the start line and the     │   │
│  │  time between starts. Used as the default when creating       │   │
│  │  new races.                                                   │   │
│  │                                                               │   │
│  │  Start 1:  [ILCA 7] [ILCA 6] [ILCA 4]                 [Edit]│   │
│  │  Start 2:  [PY] [M15]                   Offset: +3 min [Edit]│   │
│  │                                                               │   │
│  │  [+ Add start group]                                          │   │
│  │                                                               │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  [◀ Back]                                       [Next: Scoring →]    │
└────────────────────────────────────────────────────────────────────────┘
```

**Scoring system options per fleet:** Scratch, IRC, PY (Phase 2 adds HPH,
ECHO). The import may suggest a default based on detected rating columns.

**Default Start Sequence** is configured here and applies to all new races.
See [Default Start Sequence](#default-start-sequence) below for details.
For scratch-only series (even with multiple fleets), the start sequence
section is hidden — scratch fleets don't need start times.

---

## Default Start Sequence

The default start sequence defines:

1. **Start groups** — which fleets share the same starting signal
2. **Offsets** — the time gap between start groups

This is configured in the Fleets section (Step 3 of the wizard, or
Settings > Fleets thereafter). It serves as the template for new race
creation — the scorer only needs to enter the first start time, and
subsequent start times are calculated from the offsets.

### Configuration UI

```
  Default Start Sequence

  Start 1:  [ILCA 7 ×] [ILCA 6 ×] [ILCA 4 ×]      [+ Add fleet]
            Offset: — (first start)

  Start 2:  [PY ×] [M15 ×]                          [+ Add fleet]
            Offset: +[ 3 ] minutes after Start 1

  [+ Add start group]
```

**Behaviour:**
- Every fleet must appear in exactly one start group
- New fleets are unassigned until the scorer places them
- Removing a fleet from a start group returns it to an "unassigned" state;
  the UI shows a warning if any fleets are unassigned
- Reordering start groups changes the sequence (Start 1, Start 2, etc.)
- The offset is in whole minutes (typical values: 3 or 5)

**Default when first configured:** If all fleets are scratch, a single
start group containing all fleets is created automatically. If the scorer
adds the first handicap fleet, the system suggests splitting into two
start groups (scratch fleets together, handicap fleets together) but the
scorer can arrange them however they want.

### How the default sequence is used at race creation

See [Race Start Configuration](#race-start-configuration).

---

## Step 4: Scoring & Discards

The final wizard step covers scoring options and discard rules.

```
┌────────────────────────────────────────────────────────────────────────┐
│  New Series                                          Step 4 of 4      │
│                                                                       │
│  ┌─ Scoring ─────────────────────────────────────────────────────┐   │
│  │                                                               │   │
│  │  DNF/DNS scoring (RRS A5)                                     │   │
│  │  ◉ Entries in the series (RRS A5.2 — standard)               │   │
│  │  ○ Boats in the starting area (RRS A5.3 — alternative)       │   │
│  │                                                               │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  ┌─ Discards ────────────────────────────────────────────────────┐   │
│  │                                                               │   │
│  │  ◉ RRS standard (1 discard after 5 races; 2 after 9; etc.)  │   │
│  │  ○ Custom                                                     │   │
│  │                                                               │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  [◀ Back]                                         [Finish setup →]   │
└────────────────────────────────────────────────────────────────────────┘
```

Discards default to the RRS standard rule. The scorer only needs to touch
this step if they have non-standard scoring or discard rules.

---

## Completing the Wizard

Clicking "Finish setup" on Step 4 navigates to the series Races list,
ready for the first race. A success banner summarises what was configured:

> *Series "HYC Frostbite 2026" created · 147 competitors · 5 fleets ·
> PY + scratch scoring*

If the scorer skipped steps, the banner notes what's still needed:

> *Series created. No competitors yet — import or add them from the
> Competitors tab.*

---

## After the Wizard: Settings

The Settings tab (`/series/[id]/settings`) provides access to all the same
configuration as the wizard, presented as expandable cards. This is where
the scorer returns to adjust anything after initial setup.

```
┌────────────────────────────────────────────────────────────────────────┐
│  HYC Frostbite 2026                                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─ Basics ──────────────────────────────────────────────────────────┐ │
│  │  Howth Yacht Club · Nov 2025 – Mar 2026                [Edit ▸]  │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  ┌─ Competitors ─────────────────────────────────────────────────────┐ │
│  │  147 competitors                                      [Manage ▸] │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  ┌─ Scoring Mode ────────────────────────────────────────────────────┐ │
│  │  Handicap (time-corrected)                             [Edit ▸]  │ │
│  │  🔒 Locked — Race 1 has finishes                                  │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  ┌─ Fleets ──────────────────────────────────────────────────────────┐ │
│  │  ILCA 7 scratch · ILCA 6 scratch · ILCA 4 scratch    [Edit ▸]   │ │
│  │  PY · M15 PY                                                      │ │
│  │  Start sequence: 2 starts, +3 min offset                          │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  ┌─ Scoring ─────────────────────────────────────────────────────────┐ │
│  │  RRS A5.2 (standard DNF scoring)                       [Edit ▸]  │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  ┌─ Discards ────────────────────────────────────────────────────────┐ │
│  │  RRS standard                                          [Edit ▸]  │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  ┌─ Publishing ──────────────────────────────────────────────────────┐ │
│  │  hyc/frostbite-2026                                    [Edit ▸]  │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  ┌─ File ────────────────────────────────────────────────────────────┐ │
│  │  Last saved: 2 hours ago                               [Save ▸]  │ │
│  └───────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

The Scoring Mode card shows the lock state clearly. Fleets and start
sequence are configured together in the expanded Fleets card (same UI as
Step 3 of the wizard).

---

## Race Start Configuration

When a new race is created in a handicap series, the scorer needs to
configure starts — which fleets start when. The default start sequence
(configured in Step 3 / Settings > Fleets) makes this a one-field
interaction.

### Creating a new race (handicap series)

```
┌────────────────────────────────────────────────────────────────────────┐
│  New Race                                                              │
│                                                                        │
│  Race number  [ 5 ]         Date  [ 2026-01-12 ]                      │
│                                                                        │
│  ┌─ Starts ──────────────────────────────────────────────────────────┐│
│  │                                                                   ││
│  │  First start time  [ 14:05:00 ]                                   ││
│  │                                                                   ││
│  │  Using default start sequence:                                    ││
│  │                                                                   ││
│  │  Start 1: ILCA 7, ILCA 6, ILCA 4          14:05:00              ││
│  │  Start 2: PY, M15                          14:08:00  (+3 min)   ││
│  │                                                                   ││
│  │  [Edit starts for this race]                                      ││
│  │                                                                   ││
│  └───────────────────────────────────────────────────────────────────┘│
│                                                                        │
│  [Cancel]                                          [Create race]      │
└────────────────────────────────────────────────────────────────────────┘
```

**Behaviour:**

- The race number and date are auto-populated (next sequential number,
  today's date) as before.
- If the series has a default start sequence, the Starts section appears
  pre-populated. The scorer only needs to enter the first start time —
  subsequent start times are calculated from the configured offsets.
- "Edit starts for this race" expands to show editable per-start-group
  times, allowing the scorer to override the defaults for this specific
  race (e.g. if the sequence was delayed).
- If no default start sequence exists, the scorer sees the full start
  configuration UI (same as the edit view) with no pre-populated times.

### Creating a new race (scratch-only series)

For scratch-only series, race creation remains minimal — just race number
and date, no starts configuration:

```
┌────────────────────────────────────────────────────────────────────────┐
│  New Race                                                              │
│                                                                        │
│  Race number  [ 5 ]         Date  [ 2026-01-12 ]                      │
│                                                                        │
│  [Cancel]                                          [Create race]      │
└────────────────────────────────────────────────────────────────────────┘
```

No starts, no times, no friction. This is the frostbite ILCA experience.

### Editing starts after race creation

Starts can always be edited on the race detail page. The finish entry
screen also shows starts in an editable panel at the top (as described
in `finish-entry.md`). Changing a start time after finishes have been
entered triggers an automatic re-score of corrected times for affected
fleets.

---

## Fleet Lifecycle

**Fleets are explicit, managed objects.** They are not silently derived
from competitor data. The lifecycle is:

1. **Created** — by the scorer in the wizard (Step 3), in Settings >
   Fleets, or as a confirmed side-effect of competitor import.
2. **Configured** — name, scoring system, position in the start sequence.
3. **Populated** — competitors are assigned to fleets.
4. **Deleted** — the scorer explicitly removes a fleet. If the fleet has
   competitors, they are moved to the default fleet (or the scorer is asked
   where to move them).

### Fleet creation during import

When a CSV import detects fleet values that don't match existing fleets,
the import confirmation step reports them explicitly:

> *3 new fleets will be created: Junior, Senior, Class 1*

The scorer sees this before confirming the import. They can:
- Proceed — fleets are created with default settings (scratch scoring)
- Go back and adjust the column mapping (e.g. map the fleet column to
  "— ignore —" to put all competitors in the default fleet)

After import, the scorer should review and configure the new fleets in
Step 3 (or Settings > Fleets).

### Fleet creation from the competitor dialog

The competitor add/edit dialog shows a fleet dropdown populated with
existing fleets. There is no inline "new fleet name" field — fleet
creation happens in Settings > Fleets, not mid-competitor-entry.

If a scorer needs to create a fleet while adding a competitor, they
navigate to Settings > Fleets first. This is a deliberate friction:
creating a fleet is a configuration decision, not a data-entry action.

---

## Use Cases

### IODAI Munster Championship (scratch, multi-fleet)

1. Create series → Name: "IODAI Munster Championship 2026", Venue: "RCYC"
2. Import competitors → CSV has a "Fleet" column with "Junior" and "Senior"
3. Import summary: "120 competitors, 2 fleets will be created"
4. Step 3: Scoring mode = Scratch, Multiple fleets = Yes, fleets shown
5. Step 4: Discards = RRS standard
6. Race creation: just number + date, no starts needed

### HYC Dinghy Frostbites (handicap + scratch, multi-fleet)

1. Create series → Name: "HYC Dinghy Frostbites 2026", Venue: "HYC"
2. Import competitors → CSV has Fleet column (ILCA 7, ILCA 6, ILCA 4,
   PY, M15) and PY rating column
3. Import summary: "200 competitors, 5 fleets will be created"
4. Step 3: Scoring mode = Handicap (suggested from PY column)
   - ILCA fleets → Scratch scoring
   - PY, M15 → PY scoring
   - Default start sequence: Start 1 = ILCA 7/6/4, Start 2 = PY/M15 (+3 min)
5. Race creation: enter first start time (14:05), second start auto-filled
   (14:08)

### HYC Autumn League (handicap, multi-fleet keelboats)

1. Create series → Name: "HYC Autumn League 2026", Venue: "HYC"
2. Import competitors → CSV has Fleet column (Class 1, Class 2, Class 3)
   and IRC TCC column
3. Step 3: Scoring mode = Handicap
   - All fleets → IRC scoring
   - Default start sequence: Start 1 = Class 1, Start 2 = Class 2 (+5 min),
     Start 3 = Class 3 (+5 min)
4. Race creation: enter first start time, others auto-calculated

### Simple club race (scratch, single fleet)

1. Create series → Name: "Tuesday Evening Racing"
2. Skip import (or import with no fleet column)
3. Step 3: Scoring mode = Scratch, Multiple fleets = No
4. Step 4: Defaults
5. Race creation: number + date only
6. Add competitors manually as they show up

---

## Relationship to Screen Inventory

The screen inventory lists G-02 (New Series Setup) and S-01 (Series
Settings) as related screens. G-02 is the wizard, launched from "New
Series" on G-01. S-01 is the settings screen, accessible from the
within-series sidebar. They share the same configuration UI but differ in
presentation: the wizard is a linear sequence; settings is a set of
expandable cards.

---

## Open Questions

| # | Question | Impact |
|---|----------|--------|
| 1 | Should the scorer be able to start from a template (e.g. clone last year's series)? | Low for MVP — deferred |
| 2 | Should the wizard re-launch if the scorer opens a series that was created but never finished the wizard? | Medium — need a "wizard completed" flag |
| 3 | How should the start sequence handle a scorer who adds a new fleet mid-series? The fleet is unassigned to any start group — should race creation warn, or auto-assign? | Medium — warn is safer |
