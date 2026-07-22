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
4. Add competitors: either **Add 24 demo competitors** (one click), or —
   the fuller demo — import
   [`split-fleets-demo-competitors.csv`](split-fleets-demo-competitors.csv)
   (48 entries, 16 nations, digits-only sails) via the Competitors tab's
   CSV import; the headers auto-map, and the nationality column makes the
   **Nationality, then sail number** seeding order meaningful. Then pick
   2 or 3 qualifying fleets and **Enable split fleets** (ILCA preset).
   With 48 entries and 3 fleets, expect 16/16/16 and a 16/16/16
   Gold/Silver/Bronze split.
5. **Create Round 1** — seeding dialog, preview table, commit. Q1–Q2 appear
   as slot rows; each chip opens the standard finish-entry page, scoped to
   that fleet's roster (enter digits-only sail numbers, e.g. `210001`).
6. Enter the finish sheets. By hand, or — with the `csv-finish-import`
   feature also enabled — import the pre-built sheets in
   [`split-fleets-demo-sheets/`](split-fleets-demo-sheets/) (Q1–Q2 match
   the 48-entry CSV's sail-number-seeded Round 1; Q3–Q4 match the Round 2
   reassignment as actually committed in the demo DB; row order = crossing
   order, times included, a sprinkling of OCS/RET/DNF/BFD/UFD/DNS, and one
   boat left off Q2 · Yellow to show implicit DNC). Q1 flips to **counts** once both fleets are in, Q2 shows
   **awaiting**; the standings table below shows fleet-tinted cells,
   greyed non-counting columns, and the provisional Gold/Silver **cut
   line**.
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

- **Split-fleet config belongs on the Settings tab too** (review feedback,
  2026-07-22): it's a series-format fact like scoring mode, and Settings
  is where a scorer expects to *see* it — fleet count, colours, final
  fleet names, discard caps, medal config — as a standard settings card
  with a collapsed summary, read-only once racing locks it (the
  scoring-mode card is the exact pattern). The prototype's
  setup-only-on-the-workflow-tab shape hides the configuration after
  enablement. The Split Fleets tab keeps the *workflow*; Settings shows
  (and pre-lock, edits) the *configuration* — feeding design open
  question 6 (which fields stay editable mid-event).
- **Hide the Standings tab on a split-fleet series** (review feedback,
  2026-07-22): the regular per-fleet standings are noise in this mode —
  every round fleet gets its own meaningless table, and the standings
  that matter are the combined/tiered ones on the Split Fleets page. The
  tab should go (like the as-published regime trims the tab set), but its
  affordances must not: publish / preview / download need a home on the
  Split Fleets standings section, which also fits the flow design's
  publishing cadence (publish after each completed logical race, from
  where the scorer is looking).
- **The medal ceremony needs the full dialog treatment** (review feedback,
  2026-07-22): the prototype's `window.confirm()` reads as a glitch next to
  the other ceremonies' preview dialogs. The real version is a
  `CeremonyDialog` like the rest — basis snapshot, the selection table,
  boundary-tie diagnostics at the cutoff, the companion-fleet remainder —
  and the **medal fleet size must be scorer-chosen at selection time**
  (default from the preset's `medal.size`, editable in the dialog): SIs
  say "top ten" but juries extend cutoffs and formats vary.
- **Round fleets need round-scoped names** (review feedback, 2026-07-22):
  after Round 2, Settings → Fleets shows two indistinguishable "Yellow"
  rows. Bare colour names collide the moment a second round exists — the
  fleet list wants something like "Round 1 · Yellow" while race chips and
  standings cells keep the bare colour. This is design open question
  "Fleet naming for rounds" answered by contact: disambiguation is
  required, not optional, anywhere the raw fleet list shows.

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
