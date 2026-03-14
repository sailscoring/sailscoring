# Series Setup Flow

Detailed user flow for G-02 / S-01: Series Setup — creating and configuring
a new series.

---

## Overview

Series setup is the starting point for any scoring session. It needs to be
fast for experienced scorers who know exactly what they want, and guided
enough for a new scorer who is not sure what they need before they can start.

**Design principles:**

1. **Immediate.** Clicking "New Series" creates the series instantly and lands
   the scorer in it. No upfront form to fill before anything is saved.
2. **Iterative.** There is no single setup wizard to complete. Each
   configuration area is a card the scorer can open, fill in, and return to
   later. The series is usable at any point.
3. **Import-first.** Competitors are the best source of truth for fleet and
   scoring configuration. Import them early; let the system surface what it
   detected and suggest sensible defaults.
4. **No separate settings screen.** The setup screen and the series settings
   screen are the same screen. There is no "setup mode" that graduates to
   "settings mode". A scorer who returns six months later to add a fleet sees
   exactly the same interface.

---

## Creating a Series

The scorer clicks **New Series** on the Series List (G-01).

The system:
1. Generates a placeholder name (see [Placeholder Names](#placeholder-names)).
2. Creates and saves the series immediately.
3. Navigates to the series setup screen.
4. Auto-focuses and selects the name field.

The scorer can start typing immediately to replace the placeholder name.
No modal, no confirmation, no "fill in these fields before you can proceed".

### Placeholder Names

Placeholder names are generated from a small wordlist using the pattern
**[Adjective] [Noun] Series**. They are clearly temporary (no scorer would
name their event this) but mildly amusing — a small signal that the
application has a personality.

Examples: *Gusty Halyard Series*, *Briny Barnacle Series*,
*Choppy Rudder Series*, *Leaky Cleat Series*, *Squalling Mizzen Series*.

The name field is auto-focused and fully selected on load: the scorer presses
a single key to begin replacing it.

---

## The Setup Screen

The setup screen shows the series name at the top, followed by a set of
**setup cards** — one per configuration area. Each card has a collapsed
(summary) state and an expanded (editing) state. Cards can be opened in any
order.

```
┌────────────────────────────────────────────────────────────────────────┐
│  Sail Scoring                                                           │
├─────────────────────────────────────────────────────────────────────────┤
│  ◀ All series                                                           │
│                                                                         │
│  ╔═══════════════════════════════════════════════════════════════════╗  │
│  ║  Gusty Halyard Series                                             ║  │
│  ╚═══════════════════════════════════════════════════════════════════╝  │
│     ↑ auto-focused, text selected; type to replace                      │
│                                                                         │
│  ┌─ Basics ──────────────────────────────────────────────────────────┐  │
│  │  Venue and dates                                      [Set up ▸]  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─ Competitors ─────────────────────────────────────────────────────┐  │
│  │  No competitors yet                               [Import CSV ▸]  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─ Fleets ──────────────────────────────────────────────────────────┐  │
│  │  Import competitors first — fleets can be detected automatically  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─ Scoring ─────────────────────────────────────────────────────────┐  │
│  │  Set up fleets first                                               │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─ Discards ────────────────────────────────────────────────────────┐  │
│  │  RRS standard: 1 discard after 5 races            [Change ▸]      │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key decisions:**

- The Competitors card is intentionally the most prominent unconfigured card
  on a new series. It is the first action most scorers should take after
  naming the series.
- The Fleets card is visibly dependent on Competitors — its placeholder copy
  says so directly. This nudges the scorer toward the import-first sequence
  without enforcing it.
- The Scoring card is visibly dependent on Fleets.
- Discards defaults immediately to the RRS standard rule. The scorer does not
  need to touch it unless they have a non-standard profile.

---

## After Competitor Import

Once competitors are imported, the Fleets and Scoring cards update to reflect
what was detected in the import data.

```
│  ┌─ Competitors ─────────────────────────────────────────────────────┐  │
│  │  203 competitors imported · 3 classes detected       [Manage ▸]  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─ Fleets ──────────────────────────────────────────────────────────┐  │
│  │  3 fleets detected from import            [Review & confirm ▸]    │  │
│  │  Junior · Senior · Class 1                                         │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─ Scoring ─────────────────────────────────────────────────────────┐  │
│  │  IRC ratings detected (Class 1)           [Set up scoring ▸]      │  │
│  │  Scratch scoring detected (Junior, Senior)                         │  │
│  └───────────────────────────────────────────────────────────────────┘  │
```

**Detection logic:**

- **Fleets:** a fleet/class column in the CSV is used to group competitors
  into fleets. If no such column exists, one fleet is created and the scorer
  names it manually.
- **Scoring:** the presence of IRC TCC or NHC rating columns in the CSV
  suggests handicap scoring for those competitors' fleets. Absence of rating
  columns suggests scratch scoring. These are suggestions — the scorer
  confirms in the Scoring card.

The system surfaces what it noticed; it does not auto-configure. The scorer
reviews and confirms.

---

## Card: Basics (expanded)

Venue and date range. All optional — a series can operate without them.

```
│  ┌─ Basics ──────────────────────────────────────────────────────────┐  │
│  │  Venue      [ Howth Yacht Club__________________ ]               │  │
│  │  Start date [ 2025-09-01 ]   End date [ 2025-11-30 ]             │  │
│  │                                                          [Done]  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
```

---

## Card: Fleets (expanded)

Shows detected fleets (if import done) or an empty state with an add button.
The scorer can rename, reorder, merge, or delete fleets before confirming.

```
│  ┌─ Fleets ──────────────────────────────────────────────────────────┐  │
│  │  Detected from import. Rename or adjust before confirming.        │  │
│  │                                                                   │  │
│  │  ☰  Junior                                          [Rename] [×]  │  │
│  │  ☰  Senior                                          [Rename] [×]  │  │
│  │  ☰  Class 1                                         [Rename] [×]  │  │
│  │                                                                   │  │
│  │  [+ Add fleet]                                      [Confirm]    │  │
│  └───────────────────────────────────────────────────────────────────┘  │
```

Drag handles (☰) allow reordering, which affects display order in standings
and results.

---

## Card: Scoring (expanded)

One row per fleet. Each row shows the detected suggestion and lets the scorer
confirm or change it.

```
│  ┌─ Scoring ─────────────────────────────────────────────────────────┐  │
│  │  Junior    ◉ Scratch   ○ IRC   ○ NHC   ○ IRC + NHC               │  │
│  │  Senior    ◉ Scratch   ○ IRC   ○ NHC   ○ IRC + NHC               │  │
│  │  Class 1   ○ Scratch   ◉ IRC   ○ NHC   ○ IRC + NHC               │  │
│  │    ↑ IRC detected from import ratings                             │  │
│  │                                                          [Done]  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
```

Selecting IRC or NHC for a fleet displays a note that competitors in that
fleet will need a rating field. If ratings were already imported, no action
is needed.

---

## Card: Discards (expanded)

```
│  ┌─ Discards ────────────────────────────────────────────────────────┐  │
│  │  ◉ RRS standard (1 discard after 5 races; 2 after 9; etc.)       │  │
│  │  ○ Custom                                                          │  │
│  │                                                          [Done]  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
```

Custom opens a simple table: "After N races, discard M worst."

---

## Ready to Race

The scorer does not need to complete all cards before entering race results.
The minimum viable configuration is:

- Series has a name (placeholder is fine)
- At least one fleet exists
- At least one competitor in that fleet

Once these are met, a **Go to races →** link appears beneath the card list,
and the series appears on the Series List as active. The scorer can return to
the setup cards at any time.

---

## Fully Configured State

Once all cards are configured, each shows a compact summary:

```
│  ┌─ Basics ──────────────────────────────────────────────────────────┐  │
│  │  Howth Yacht Club · Sep–Nov 2025                      [Edit ▸]   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─ Competitors ─────────────────────────────────────────────────────┐  │
│  │  203 competitors                                     [Manage ▸]  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─ Fleets ──────────────────────────────────────────────────────────┐  │
│  │  Junior · Senior · Class 1                            [Edit ▸]   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─ Scoring ─────────────────────────────────────────────────────────┐  │
│  │  Junior scratch · Senior scratch · Class 1 IRC        [Edit ▸]   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─ Discards ────────────────────────────────────────────────────────┐  │
│  │  RRS standard                                         [Edit ▸]   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
```

---

## Relationship to Screen Inventory

The screen inventory lists G-02 (New Series Setup) and S-01 (Series Settings)
as separate screens. They are the same screen. The route `/series/[id]/settings`
serves both purposes: it is the destination immediately after series creation,
and the destination when a scorer navigates to settings from within the series.
The screen inventory should be updated to reflect this.

---

## Open Questions

| # | Question | Impact |
|---|----------|--------|
| 1 | If no fleet/class column is detected in the CSV, should the scorer be prompted to map a column or just create one unnamed fleet? | Medium — affects import flow design |
| 2 | Should the scorer be able to start from a template (e.g. clone last year's series)? | Low for MVP — deferred |
