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

Once competitors are imported, fleets appear automatically and the Scoring
card updates to reflect what was detected.

```
│  ┌─ Competitors ─────────────────────────────────────────────────────┐  │
│  │  203 competitors · Junior, Senior, Class 1            [Manage ▸]  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─ Fleets ──────────────────────────────────────────────────────────┐  │
│  │  Junior · Senior · Class 1                  [Reorder / rename ▸]  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─ Scoring ─────────────────────────────────────────────────────────┐  │
│  │  IRC ratings detected (Class 1)           [Set up scoring ▸]      │  │
│  │  Scratch assumed (Junior, Senior)                                  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
```

**Fleet lifecycle:** Fleets are not created or deleted directly. They are
derived from the fleet field on competitors — a fleet exists as long as at
least one competitor has that value. Importing competitors creates fleets
automatically; removing the last competitor from a fleet removes the fleet.

**Fleet column detection during import:** The importer looks for a fleet
field in the CSV in priority order:
1. A column named (or mapped to) "Fleet"
2. If not found: a column named "Class" — the scorer is offered the option
   to use it as fleet
3. If not found: a column named "Division" — the scorer is offered the option
   to use it as fleet
4. If none found: all competitors are assigned to the default fleet

Competitors with no value in the fleet field (blank cell) are assigned to
the default fleet.

**Scoring detection:** The presence of IRC TCC or NHC rating columns in the
CSV suggests handicap scoring for those competitors' fleets. These are
suggestions — the scorer confirms in the Scoring card. The system does not
auto-configure scoring.

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

Shows the current fleets derived from competitor data. Fleets cannot be
added or deleted here — they emerge from competitors. The scorer can rename
and reorder them.

```
│  ┌─ Fleets ──────────────────────────────────────────────────────────┐  │
│  │  Fleets are created automatically from your competitors.          │  │
│  │                                                                   │  │
│  │  ☰  Junior                                           [Rename]    │  │
│  │  ☰  Senior                                           [Rename]    │  │
│  │  ☰  Class 1                                          [Rename]    │  │
│  │                                                                   │  │
│  │                                                          [Done]  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
```

Drag handles (☰) set display order in standings and results. Renaming a
fleet updates all competitors in that fleet. To move competitors between
fleets, edit them on the Competitors screen.

---

## Card: Scoring (expanded)

One row per fleet. Each row shows the detected suggestion and lets the scorer
confirm or change it.

```
│  ┌─ Scoring ─────────────────────────────────────────────────────────┐  │
│  │                 Scratch  IRC    NHC    Scratch  IRC               │  │
│  │                                       + NHC    + NHC             │  │
│  │  Junior         ◉        ○      ○      ○        ○                │  │
│  │  Senior         ◉        ○      ○      ○        ○                │  │
│  │  Puppeteer 22   ○        ○      ○      ◉        ○                │  │
│  │    ↑ NHC detected from import ratings; Scratch + NHC suggested   │  │
│  │  Class 1        ○        ◉      ○      ○        ○                │  │
│  │    ↑ IRC detected from import ratings                             │  │
│  │                                                          [Done]  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
```

**Scratch + NHC** is the correct choice for one-design fleets that also
participate in a club handicap system (e.g. HYC inshore classes). It
produces two independent sets of standings from the same finish:
one-design positions for the class trophy, and corrected times for the
HPH trophy.

Selecting IRC or NHC (alone or in combination) displays a note that
competitors in that fleet need a rating field. Competitors without the
required rating will score in the remaining systems only.

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
│  │  Puppeteer 22 scratch+NHC · Squib scratch+NHC                     │  │
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
| 1 | Should the scorer be able to start from a template (e.g. clone last year's series)? | Low for MVP — deferred |
