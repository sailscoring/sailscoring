# Update Handicaps Flow

UX for the "Update handicaps" action on the Competitors page. Initial
target: pull progressive-handicap starting TCFs (NHC, ECHO) from a prior
series in the same workspace. Future sources (Irish Sailing IRC/ECHO
certificates, RYA PY numbers) slot into the same shell.

Context: issue #143 (HYC's NHC tuning experiment, priority feature #2)
and the "Carry-over of starting handicaps between series" item in
`docs/design/horizon.md`.

---

## Entry point

A button on the Competitors page action bar, next to *Import* and
*Add competitor*:

```
Competitors                     [Update handicaps] [Import] [+ Add competitor]
```

Shown only when at least one fleet in the series uses a system that has
a per-competitor starting handicap (today: `nhc`, `echo`; in future:
`irc`, `py` once remote sources land). Hidden on scratch-only series.

Per the feature checklist this also gets a global keyboard shortcut
registered in `components/keyboard-help.tsx` and `app/help/page.tsx`.

---

## Dialog flow

Three steps in one `<Dialog>`, modelled on the existing CSV importer
(idle → mapping → done).

### Step 1 — Source picker

Frames the dialog as a generic "pull handicaps from somewhere" tool so
other sources slot in without re-shaping the UX. Today only the first
option is enabled; the others render as disabled with a "coming soon"
note so scorers see the trajectory.

```
┌─ Update handicaps ────────────────────────────────────────────┐
│ Where should we pull handicaps from?                          │
│                                                               │
│  (•) Another series in this workspace                         │
│      Use the boat's handicap at the end of a prior series     │
│      as its starting handicap here. Covers NHC and ECHO.      │
│                                                               │
│  ( ) Irish Sailing certificates             — coming soon     │
│      IRC TCC and Standard ECHO TCF, looked up by sail number. │
│                                                               │
│  ( ) RYA Portsmouth Yardstick               — coming soon     │
│      PY numbers, looked up by boat class.                     │
│                                                               │
│                                            [Cancel]   [Next]  │
└───────────────────────────────────────────────────────────────┘
```

### Step 2 — Source series + preview

Top half picks the source; bottom half is the live diff that re-renders
as the picker changes.

```
┌─ Update handicaps from another series ────────────────────────────────────┐
│ Source series  [ Tuesday Series 1 2025                           ▾ ]      │
│ Handicaps as of  Race 6 (final, scored 2025-06-24)                        │
│                                                                           │
│ Fleet mapping                                                             │
│   Puppeteer (NHC) here    ←  Puppeteer HPH (NHC) in source       [✓ link] │
│   Class 3 (ECHO) here     ←  Class 3 ECHO (ECHO) in source       [✓ link] │
│   Class 2 (NHC) here      ←  (no matching fleet)                 [— skip] │
│                                                                           │
│ ─ Preview: 16 changes, 3 unchanged, 2 not found ────────────────────────  │
│                                                                           │
│ Sail no.  Boat        Fleet       System   Current → New     Δ            │
│ IRL 1234  Zesty       Puppeteer   NHC      1.201  → 1.019   −0.182  ✓     │
│ IRL 4321  Checkmate   Puppeteer   NHC      1.045  → 1.078   +0.033  ✓     │
│ IRL 8765  Windjammer  Class 3     ECHO     0.984  → 1.012   +0.028  ✓     │
│ ...                                                                       │
│                                                                           │
│ ▸ 3 unchanged                                                             │
│ ▾ 2 not found in source                          (will keep current TCF)  │
│    IRL 9999  Newcomer    Puppeteer  NHC    1.000  (no match)              │
│    IRL 7777  Late Entry  Class 3    ECHO   1.020  (no match)              │
│                                                                           │
│                                                  [Cancel]   [Apply 16]    │
└───────────────────────────────────────────────────────────────────────────┘
```

Behavioural notes:

- **Source series dropdown** lists workspace series with at least one
  progressive-handicap fleet that has scored races, most-recent first.
  The subtitle shows which race the TCFs come from — a series in
  progress is a valid source, so "end of source series" means "after
  the latest scored race for the source fleet."
- **Fleet mapping** auto-matches by fleet name + scoring system. The
  scorer can override per row via the dropdown. Unmatched target fleets
  flow into "not found" below.
- **One row per (competitor, system).** A boat in both an NHC fleet
  and an ECHO fleet appears twice — the systems update independently.
- **Per-row checkbox** defaults to ticked for changed rows, unticked
  for unchanged ones (excluded entirely). Power-user untick lets a
  scorer keep a specific boat unchanged.
- **Δ column** uses sign + colour. Raw TCF units, 3 dp — sailors think
  in TCF, not percentage.
- **"Not found" group** is expandable, collapsed by default unless it
  contains entries the scorer should see (e.g. a competitor whose
  current TCF was scorer-entered and won't match anywhere in the source).

### Step 3 — Result

Mirrors the import "done" pane:

```
✓ Updated 16 starting handicaps from Tuesday Series 1 2025 (Race 6).
  • 14 NHC, 2 ECHO
  • 3 unchanged
  • 2 not found — left at their current TCF
                                                                  [Close]
```

---

## What gets written

Updates `Competitor.nhcStartingTcf` and `Competitor.echoStartingTcf` for
the matched rows. No race data changes; no scoring is run. Standings
rebuild on next render via the existing "retroactive edits propagate
automatically" recompute path (see `docs/design/handicap-scoring.md`,
Phase 2 open questions).

`lastModifiedAt` + actor attribution from Phase 7 covers the audit
trail; no new audit fields needed.

---

## Edge cases

- **Source fleet with no scored races yet.** Unavailable in the
  mapping; shown disabled with reason "no completed races."
- **Source series is the current series.** Filtered out of the dropdown.
- **Sail-number collisions across fleets in the source.** Match per
  `(sailNumber, scoringSystem)`, not bare sail number — a boat in two
  source fleets has two TCFs and each system pulls its own.
- **Mismatched scoring system between source and target.** Skipped;
  surfaced under "not found" with reason ("source fleet uses ECHO;
  target uses NHC").
- **Re-running the dialog.** Idempotent — a second run after no
  source changes produces zero changes. Re-running *after* manual
  edits will overwrite those edits if the boat is checked; the diff
  makes that visible before the click.

---

## Future sources

The Step 1 picker is the seam for additional sources. Each new source
provides a name, an availability check, a fetch step, and a producer
of `(competitorId, field) → newValue`. The Step 2/3 preview/diff/apply
UI is invariant.

| Source                          | Match on        | Fields written                      | Step-2 controls         |
|---------------------------------|-----------------|-------------------------------------|-------------------------|
| Another series *(this flow)*    | sail no. + sys. | `nhcStartingTcf`, `echoStartingTcf` | source-series + fleets  |
| IS IRC certificates             | sail no.        | `ircTcc`                            | year picker             |
| IS ECHO certificates            | sail no.        | `echoStartingTcf` (Standard TCF when [certificate-layer features](../../horizon.md#echo-certificate-layer-features) land) | year picker |
| RYA PY numbers                  | boat class      | `pyNumber`                          | reference year          |

The local "another series" source is the only one not needing network
+ credentials, hence sequencing it first.
