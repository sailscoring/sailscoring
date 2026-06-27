# RaceSense regatta export — format and import learnings

Captured from an experimental "Import RaceSense" spike (a one-shot
series-creation flow, never merged — the code was discarded, but the format
knowledge and the import-shape decisions are worth keeping). If RaceSense import
is ever built for real, start here rather than re-reverse-engineering the export.

**RaceSense** is an iOS app for race-committee timing. It exports each regatta
as a single `.xlsx` workbook: one **Summary** sheet plus one **`Race N`** sheet
per race.

## Workbook structure

### `Summary` sheet

Key/value header rows in columns A/B, then a per-race results grid:

- `Regatta` → the event name (col B).
- `Division` → the division/class name (col B).
- A header row whose col B is `Race 1` marks the start of the results grid.
- Below it, one row per competitor: col A is the competitor label, columns B+
  are per-race position codes (`"1."`, `"DNF"`, …).
- Competitor label is either `"<sail>"` or `"<sail> - <boatName>"` (split on the
  literal `" - "` separator).

### `Race N` sheets

Sheet names match `^Race \d+$`; order by the trailing integer (workbook order is
normally already correct). Each holds key/value header rows plus two blocks:

- `Date` (col B) → ISO `YYYY-MM-DD`.
- `Start Time` (col B) → time of day.
- **Starts block** — header row with col A `Sail Number` and col D `Status`;
  rows below list every boat RaceSense knew about for the race.
- **Finishes block** — a row with col A `Finishes`, then a column-label row,
  then finisher rows in finishing order. Column layout:
  `A=position-or-"DNF", B=sail, C=boatName, D=bowNumber, E=totalTime,
  F=finishingTime (time of day), G=maxSpeed, H=distance`.

## Field semantics and what to discard

- **The Finishes block is authoritative.** It lists finishers in order (with a
  tail of `DNF` rows) and is the source of truth for results.
- **The Starts-block `Status` column is ignored entirely.** Observed values:
  - `OCS (Cleared)` — boat returned and re-crossed; no penalty under RRS, finish
    stands.
  - `OCS` — always paired with a `DNF` row in Finishes.
  - `Not Checked-In` — an operational note from the RC.

  None map to a Sail Scoring concept, so trust the Finishes block and drop
  Status. (See the `racesense-import` memory note — ignoring `OCS (Cleared)` is
  the specific footgun: the boat cleared its error, so its finish is valid.)
- **Discarded RaceSense extras** (no Sail Scoring analogue): distance-to-line,
  GPS track, max speed, total time, bow number.

## Edge cases

- **No finishers.** If a race started but nobody finished, RaceSense omits the
  Finishes block; every starter becomes a DNF — matching what the Summary tab
  shows for that race.
- **Fractional seconds** on times (`"11:11:20.830"`) are truncated to whole
  seconds. Accept `HH:MM:SS`, `HH:MM`, and unpadded `H:M:S`; zero-pad to
  `HH:MM:SS`.

## Import-shape decisions (from the spike)

Worth reusing if the feature is rebuilt:

- One-shot creation from the home page: parse → preview an import plan → commit
  in one click; the parser stays pure (ArrayBuffer in, plan out, no storage).
- Series name `"<Regatta> — <Division>"`; series start date = earliest race date.
- The imported series was **handicap-scored** with **two fleets sharing one
  start**: a scratch fleet named after the RaceSense Division, plus a *Personal
  Handicap* fleet scored on NHC with every competitor seeded at starting TCF
  `1.000` — so the NHC columns and progressive propagation engage immediately.

## Implementation gotcha

SheetJS (`xlsx`) `read(..., { type: 'array' })` is sensitive to the exact view
it receives — passing a raw `ArrayBuffer` in some realms (notably jsdom under
Vitest) yields a stub single-sheet workbook. Wrap in a `Uint8Array` first.
