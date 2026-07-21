# Split Fleets prototype — demo notes

A quick-and-dirty implementation of the Split Fleets design
(`docs/design/qualifying-final-series.md`,
`docs/design/ux/flows/split-fleets.md`) built for design review. **Throwaway:
review it, extract the lessons, then discard the implementation.** Nothing
here is production-quality; see Shortcuts below.

## Demo

Self-contained script (also the smoke test):

```
pnpm db:up && pnpm test:e2e e2e/split-fleets.spec.ts
```

Interactive walkthrough:

1. `pnpm db:up && pnpm db:migrate:test && pnpm dev:local`, sign in.
2. Enable the gate for your workspace:
   `pnpm provision-org:test enable-feature <slug> split-fleets`
   (personal workspace slug is `u-` + first 16 chars of your user id; the
   e2e `enableFeatures` helper writes the org metadata directly if the
   CLI grumbles about a personal workspace).
3. Create a series (quick form). Open the **Split Fleets** tab (chord `g q`).
4. **Add 24 demo competitors**, pick 2 or 3 qualifying fleets, **Enable
   split fleets** (ILCA preset).
5. **Create Round 1** — seeding dialog, preview table, commit. Q1–Q2 appear
   as slot rows; each chip opens the standard finish-entry page, scoped to
   that fleet's roster (enter digits-only sail numbers, e.g. `210001`).
6. Enter both fleets' Q1 sheets → Q1 flips to **counts**, Q2 shows
   **awaiting**; the standings table below shows fleet-tinted cells, greyed
   non-counting columns, and the provisional Gold/Silver **cut line**.
7. **Assign Round 2** — the reassignment preview shows the basis ("from the
   ranking after Q1"), who moves, and freezes the snapshot on commit.
8. **End qualifying → split fleets** — Gold/Silver(/Bronze) preview with
   block sizes; commit creates the final fleets and F1 per fleet; standings
   switch to tiered tables with continuous ranks.
9. **Select medal fleet (top 10)** — creates the Medal fleet plus the
   "last race" companion fleet (first finisher scores 11); medal races are
   badged ×2 and non-discardable.
10. The trash icon on the newest round deletes it with everything it
    created (fleets, races, finishes) — the prototype's undo.

## What the prototype demonstrates

- The **automation-layer claim holds**: every ceremony writes ordinary
  fleets / memberships / races / starts; the standard Competitors, Races,
  and Standings tabs show the same data, and finish entry needed **zero
  changes** — scoping a race to one fleet via its membership-only
  `RaceStart` makes `competitorsInRace` fleet-scope the sail-number wizard
  and the "Not yet recorded" panel for free.
- **Frozen rounds work as designed**: assignments are stored at commit
  with their basis; rescoring Q1 after Round 2 exists changes standings
  but no assignment.
- The **logical-race validity gate** ("Q3 isn't valid until every fleet
  has sailed it") drives the counts/awaiting chips, the greyed standings
  columns, and the largest-fleet code base.

## Findings for the real implementation

- **Sail-number matching is prefix-from-start** (`resolveSailEntry`), so
  `210960` does not match a stored `DEN 210960`. Championship entry lists
  carry national prefixes; number-only entry is how scorers type. The real
  feature needs digits-aware matching (this is why the demo data is
  digits-only).
- **Query staleness**: the 30s global `staleTime` means bouncing between
  the workflow view and finish entry shows stale slot states; the
  prototype invalidates `finishes.bySeries` on mount. The real view wants
  a considered refresh strategy (or per-race subscription).
- **`races_series_number_uidx`** forces globally sequential race numbers,
  so physical races get arbitrary series-wide numbers while the visible
  identity is `name` + (stage, stageRaceNumber). The Races tab therefore
  shows "Race 3 · Q1 · Blue" style rows — the real implementation should
  decide what raceNumber means on a split-fleet series.
- **Round deletion** must unwind memberships (`array_remove`) and races in
  one transaction and only for the newest round — the guard rails here
  (latest-of-stage, no later stage) were needed immediately even in a
  prototype.
- Phase sections that auto-expand on activation need the
  user-override-vs-derived-state pattern (`react-hooks/set-state-in-effect`
  forbids the effect version).

## Shortcuts taken (deliberate, per the throwaway brief)

- Scoring: no penalties/redress/equalisation; ties by score-list comparison
  only (no A8.2 last-race step); no per-boat extra-score exclusion; medal
  points multiplier applies to code scores too (wrong, unchecked).
- No wrong-fleet exception flow (entry is scoped, but an on-water
  wrong-fleet sailor can't be recorded against the other fleet's sheet).
- No day strip, no assignment-list publishing, no promotion, no
  hold/publish policy; published pages ignore the split (standings live
  only on the Split Fleets tab).
- `qfConfig` / rounds / race stage fields are **not** in the series file
  format, public JSON export, or revision snapshots — save/reopen drops
  the split-fleet structure.
- Raw drizzle in the handler instead of repository classes; coarse zod;
  one smoke e2e only; `window.location.reload()` after demo seeding;
  `confirm()` for the medal ceremony instead of a preview dialog.
