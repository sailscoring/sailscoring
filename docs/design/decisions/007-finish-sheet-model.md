# ADR-007: The Finish Sheet Model for Mixed Timed/Untimed Finish Entry

**Status:** Accepted

**Date:** 2026-04-09

**Deciders:** Mark McLoughlin

## Context

Some races mix fleets that need finish times (handicap scoring — IRC, PY,
later HPH) with fleets that need only finishing positions (scratch,
one-design). The clearest example is the HYC Open Dinghy Frostbite Series
(`docs/requirements/hyc-frostbite-use-case.md`), where a single race day
includes three ILCA scratch fleets, a Melges 15 scratch fleet, and a mixed
Portsmouth Yardstick handicap fleet — all sharing one race area, one
committee boat, and one finish line. The finish recorder on the committee
boat produces **one** handwritten sheet: sail numbers in crossing order,
top to bottom, with a finish time written next to the handicap boats and
nothing written next to the scratch boats. Melges 15 boats appear in both
the scratch fleet and the handicap fleet, so one finish recording produces
two sets of standings.

This mixed-mode recording is awkward to transcribe in any UI that does
not already start from the mental model of "an ordered list with a
partially-populated time column". Every attempt we have made to layer a
position-based entry flow on top of time-based entry (or vice versa)
produces user-facing friction that the scorer experiences as a surprise
mode switch.

Crucially, **most series are not like this**. An all-scratch one-design
event (IODAI Leinsters) and an all-handicap offshore series (HYC Autumn
League) both have clean, single-mode finish entry. The design challenge
is to handle the awkward mixed case **naturally**, without imposing any
of that complication on the simple single-mode cases. The scorer for an
all-scratch series should never see a time column, a fleet badge, or a
"handicap-aware" affordance unless their series actually uses handicap
scoring.

[Issue #66](https://github.com/sailscoring/sailscoring/issues/66)
identified the current mixed-mode UX as confusing: the entry behaviour
switches per-competitor after sail number lookup, and the finish list
visually mixes entries with finish times and entries without them in a
way that does not explain itself.

## Decision Drivers

- **The handwritten sheet is the source of truth.** The scorer's mental
  model is the piece of paper on their desk: one ordered list, sail
  numbers top to bottom, finish times next to some rows. The digital UI
  should match that, not force the scorer to transform the sheet into a
  different shape.
- **Single-mode series must stay simple.** Mixed-mode is the awkward
  case, but it is a minority of series. The UI for a pure scratch series
  or a pure handicap series should be unaffected by the accommodations
  made for mixed-mode.
- **Speed of the fast path.** Entering 100+ sail numbers must feel fast.
  Scratch entries should require only: type sail number, Enter, next.
  No intermediate confirmation step, no time prompt.
- **Clarity about why the mode differs.** When the scorer does enter a
  mix of timed and untimed boats, there must be a visible reason —
  something on the row that explains "this boat needs a time because
  it is in the PY fleet; that boat does not because it is in ILCA 7".
  An invisible per-competitor mode switch is exactly what #66 flagged.
- **Scorer-directed reordering with a hard constraint.** The scorer may
  need to rearrange the list after transcription — fixing an out-of-order
  scratch boat, inserting a missed boat — but one invariant must never
  be violated: timed entries must be in time order relative to each
  other. A row recorded at 14:23:30 cannot sit above a row recorded at
  14:23:45 in the list.
- **No cross-fleet "Place" concept in results output.** Scoring is
  within-fleet; cross-fleet position is a transcription detail, not a
  result. Exposing a Place column alongside a Rank column (as
  [`8f06cda`](https://github.com/sailscoring/sailscoring/commit/8f06cda)
  did) clutters the output with a number that does not determine any
  score.

## Considered Options

### Option 1: Sailwave's per-start mode determination

Sailwave handles mixed-mode finish entry with a **single whole-series
finish entry list** — one unified entry view that the scorer transcribes
into regardless of how many fleets or starts the race has. The
per-competitor mode is determined by **the start group the competitor
belongs to**: each start carries a configuration flag specifying whether
finishes for that start are recorded as positions or as times. When the
scorer selects a competitor, Sailwave resolves the competitor's start,
looks up the start's mode, and either records a position or prompts for
a time.

For reordering after entry, Sailwave provides a "Rearrange recorded
positions" tool **scoped to a single start group**. The scorer opens the
tool, selects a race and a start, and can rearrange the relative
positions of just the finishers that matched that start. This
scoping is how Sailwave protects the time-order invariant: rearranging
is restricted to within a start, so a timed start's rearrange view is
naturally different from a position start's rearrange view, and the
scorer can't accidentally mix them.

**Pros:**

- Unified whole-series entry view matches the handwritten sheet's shape
- No context switching per fleet during entry
- Per-start mode configuration is a clean place to hang the
  position/time decision
- The scoped rearrange tool gives the scorer a safe place to reorder
  one start at a time without risk of cross-group interference

**Cons:**

- The per-start mode is implicit during entry: nothing on the row
  explains why one boat got a time prompt and the next didn't. This is
  the same underlying issue as #66 (just mode-keyed by start rather than
  by fleet) — the mode switch is invisible at the point of entry
- Rearranging is a separate tool, invoked from a different context
  rather than being inline with the finish list. The scorer has to
  switch mental contexts to rearrange, and must remember to scope to
  the right start
- The time-order invariant is protected by scoping, not by structural
  affordance — the scorer still *could* type a wrong position number if
  the rearrange tool allowed it, and has to self-enforce that timed
  entries stay in order
- Mode lives on the start group, not on the fleet, so multi-start
  fleets (a fleet racing in multiple starts over the event) or
  multi-fleet competitors (Melges 15 in both M15 scratch and PY
  handicap) need extra configuration to keep consistent
- We learned from #66 that implicit mode switching — even when the
  mode is technically discoverable — produces friction in practice

Sailwave's approach is the closest precedent to this ADR's chosen
option: same unified entry view, same per-competitor mode determination.
The two differences are (a) where the mode comes from (Sailwave: start;
chosen: fleet) and (b) how the time-order invariant is protected
(Sailwave: scoped rearrange tool; chosen: no move affordance on timed
rows at all). The chosen option also adds the always-visible time column
and fleet badge to make the mode switch explicit rather than implicit.

### Option 2: Per-competitor mode switching without invariant protection (what we originally tried)

The current sailscoring behaviour. Finish entry presents one unified
list. When the scorer selects a competitor, the UI inspects the
competitor's fleet and either asks for a finish time (handicap fleet)
or confirms a position (scratch fleet) before adding the row. Commits
[`78ebca7`](https://github.com/sailscoring/sailscoring/commit/78ebca7)
(prompt for time before adding) and
[`9eab6f0`](https://github.com/sailscoring/sailscoring/commit/9eab6f0)
(sort timed entries by finish time on entry) were iterations on this
approach. Mechanically similar to Sailwave's Option 1, but with mode
keyed by fleet instead of start and with no scoped rearrange tool.

**Pros:**

- Unified list across fleets matches the handwritten sheet's shape
- No context switching per fleet
- Mode lives on the fleet, which aligns with how scoring rules live on
  the fleet (a simpler data model than Sailwave's per-start mode)

**Cons:**

- The mode switch is **implicit** — the same problem Sailwave has. The
  scorer types one sail number and gets a time prompt; types the next
  and the boat is added immediately with no time prompt. Nothing on
  screen explains why the behaviour differs between consecutive entries.
  Issue #66 demonstrates this is a real friction point, not theoretical
- `9eab6f0` tried to improve the list display by grouping all timed
  entries at the top and all untimed entries at the bottom. This broke
  the handwritten-sheet model: the transcribed list no longer matches
  the sheet the scorer is reading from
- No equivalent of Sailwave's scoped rearrange tool — the scorer has
  nowhere safe to reorder entries, and the time-order invariant relies
  entirely on the scorer entering in the correct order
- The stored `finishPosition` number is ambiguous. Is it the scorer's
  explicit position? The auto-assigned index? The cross-fleet rank?
  [`8f06cda`](https://github.com/sailscoring/sailscoring/commit/8f06cda)
  introduced a Place/Rank split in the results output to clarify this,
  but the distinction is itself a source of confusion — scorers don't
  think in "cross-fleet place"

### Option 3: Cross-fleet Place as a first-class column

Display and store an explicit cross-fleet position number for every row.
Every finisher has a Place (1, 2, 3, … across all fleets) and a Rank
(1, 2, 3, … within their fleet). Results output shows both.

**Pros:**

- Explicit about the difference between crossing order and scoring order
- Place is a familiar concept from some scoring software

**Cons:**

- Introduces a concept (Place) that does not determine any score — a
  decorative number in the output
- Scorers think in "who crossed the line in what order" (transcription)
  and "who won the fleet" (results), not in an intermediate Place number
- Two columns in the output invite the question "which one is the real
  result?" and the answer is always Rank — so why show Place?
- Mixes poorly with handicap fleets, where the crossing-order Place has
  no correspondence to the corrected-time Rank

### Option 4: Always show a time field, optional for scratch

Every entry presents a finish time field. For handicap boats the field
is required; for scratch boats the scorer can skip it by pressing Enter.
This would give a structurally uniform entry flow.

**Pros:**

- Structurally consistent: every entry has the same shape
- No mode switch at all; the scorer just enters or skips

**Cons:**

- Imposes friction on single-mode scratch series — the scorer must skip
  a time field for every entry even when no boat in the series uses
  handicap scoring
- Violates the design driver "single-mode series must stay simple"
- A skippable field that is almost always skipped becomes a tripping
  hazard when it is accidentally filled in

### Option 5: Two-pass entry

First pass: scorer enters all sail numbers in crossing order, no times.
Second pass: scorer walks back through the list and adds times to the
handicap boats.

**Pros:**

- Each pass is structurally simple
- Separates "who finished in what order" from "what time"

**Cons:**

- Does not match the handwritten sheet — the sheet has times inline,
  and the scorer reads them inline
- Doubles the traversal of the list
- Introduces an intermediate "incomplete" state that must be tracked
- Post hoc: the scorer has already moved past each timed boat by the
  time they go back to add the time, so they are not "live" with the
  data any more

### Option 6: The finish sheet model (chosen)

Treat the finish entry screen as a digital transcription of the
handwritten sheet. One unified ordered list. **Row order is crossing
order**; there is no explicit position number stored or displayed. The
list has a Time column that is always present: populated for rows whose
competitor is in a handicap fleet, empty (shown as `—`) for scratch
rows. A fleet badge on each row makes the reason visible.

Entry is asymmetric by design:

- **Scratch entry is the fast path.** Sail number → Enter → row added
  at the end of the list, no pending state, no time prompt. An
  all-scratch series uses this path exclusively and never sees a time
  column in any meaningful way (all rows are `—`, which for a single-
  mode series reads as "this column doesn't apply").
- **Handicap entry prompts for a time.** Sail number → pending row with
  time field → scorer enters the time → row is silently auto-slotted
  into its correct position among other timed rows (immediately before
  the next later-timed row, preserving scratch rows' relative positions
  around it). No confirmation dialog.

The time-order invariant ("timed rows are in time order relative to
each other") is enforced **structurally**: timed rows have no move
controls. The scorer cannot drag a timed row out of time order because
the UI offers no affordance to do so. The only way a timed row changes
position is by editing its finish time, which auto-slides the row to
its correct slot.

Scratch rows have ↑/↓ move controls (reusing the pattern from the
Fleets card in series settings). They can be moved anywhere in the
list, including past timed rows — the scorer is asserting "this scratch
boat actually crossed before that handicap boat", which is a valid
statement. When a move crosses a timed row, the destination position
flashes briefly.

Mixed-fleet competitors (a Melges 15 in both the M15 scratch fleet and
the PY handicap fleet) get a single row whose time is populated because
one of their fleets needs a time; the scoring engine derives scratch
rank for the M15 fleet from list order among M15 members, and handicap
rank for the PY fleet from corrected time among PY members.

The data model loses the cross-fleet `finishPosition` field. Finishes
carry an ordered-list index (`sortOrder`) and an optional `finishTime`.
Results output shows only within-fleet Rank; the Place column from
[`8f06cda`](https://github.com/sailscoring/sailscoring/commit/8f06cda)
is removed.

**Pros:**

- Matches the handwritten sheet exactly: one ordered list, some rows
  have times, some don't
- Single-mode series (all-scratch or all-handicap) are unaffected: an
  all-scratch series shows only `—` in the time column and the scorer
  never interacts with it; an all-handicap series shows every row with
  a time
- Fast path is preserved: scratch entry is sail number → Enter → in
  the list, with no intermediate step
- The implicit mode switch problem from #66 is solved by making the
  time column always visible — the difference between timed and
  untimed rows is expected and expressed, not hidden
- The time-order invariant is unambiguous and enforceable without
  validation logic: the UI simply doesn't offer invalid moves
- The data model simplifies: list index replaces cross-fleet
  `finishPosition`, eliminating shift/renumber arithmetic, tie-break
  position logic, and the Place/Rank distinction in output
- Scorer-directed reordering of scratch rows uses the same ↑/↓ control
  pattern as other list management in the app (series settings Fleets
  card), so the pattern is familiar

**Cons:**

- Non-incremental data model change: `finishPosition` → `sortOrder` is
  a rename with migration, and the Place column must be removed from
  existing output code paths
- Ties need a different UI: there are no shared position numbers to
  encode a tie, so a "tied with previous row" flag on scratch rows is
  introduced. This is new UI to learn, but ties are rare enough that
  a checkbox is acceptable
- Editing a time may cause a row to auto-slide to a different position,
  which can surprise a scorer who did not expect movement. Mitigated by
  the brief flash on the destination row
- Scratch-row moves can cross timed rows with no barrier, which some
  scorers may expect to be blocked. Mitigated by the flash and by the
  fact that the move has no scoring impact on the timed rows

## Decision

Adopt Option 6 (the finish sheet model).

The rationale reduces to: the handwritten sheet is an ordered list with
a partially-populated time column. The digital UI should be the same
shape, and the mode difference between timed and untimed rows should
be expressed visibly (time column, fleet badge) rather than surfacing
only at the moment of entry.

Sailwave's Option 1 is the closest precedent to this decision and
validates two of its core moves: a unified whole-series entry view, and
per-competitor mode determination based on the competitor's group
membership. Option 6 diverges in two ways:

1. **Mode is keyed off the fleet, not the start.** The fleet already
   owns the scoring system in our data model, and multi-fleet competitors
   (Melges 15 in both M15 and PY) are a first-class concept that a
   start-keyed approach handles awkwardly.
2. **The time-order invariant is protected structurally, not by a
   scoped rearrange tool.** Sailwave restricts rearranging to within a
   start group because that is the only safe way to reorder without
   accidentally violating time order across groups. We remove move
   controls from timed rows entirely, so the invariant cannot be
   violated from the UI at all, and scratch rows can be reordered inline
   without mode-switching to a separate tool.

Option 6 also adds the always-visible time column and fleet badge,
which neither Sailwave nor our Option 2 implementation had — and which
directly addresses the #66 friction point of invisible mode-switching.
The other options fail more sharply: two-pass entry (Option 5) doubles
the traversal of the sheet; always-show-time (Option 4) imposes friction
on the fast path; cross-fleet Place (Option 3) adds a decorative column
that does not determine any score.

### Handicap ↔ Scratch scoring-system changes

A related nuance: what happens when a fleet's scoring system is changed
after finishes have already been recorded.

**Scratch → Handicap is blocked** if any of the fleet's finishes lack a
`finishTime`. A handicap fleet requires times on every row; the switch
is refused with a message listing the count.

**Handicap → Scratch is allowed** with a non-blocking confirmation.
Recorded `finishTime` values are **preserved** but hidden from the UI
(the time column for this fleet's rows renders as `—`, driven by the
fleet's current scoring system, not by whether the data is stored).
Move controls appear on the (now-scratch) rows, because the time-order
invariant is dormant while the fleet is scratch. If the scorer later
switches back to handicap, the auto-slot insertion rule is run over
the fleet's rows to restore the invariant for any rows that have
`finishTime` set; rows that were added while the fleet was scratch
(and therefore lack a time) block the switch until resolved.

The governing rule, symmetric in both directions:

> A scoring-system change is blocked if, after the change, any row in
> the fleet would be in an invalid state that cannot be automatically
> resolved. Valid state for a scratch row: any row. Valid state for a
> handicap row: must have a `finishTime`.

Data preservation is the default because the data is cheap, the option
is confusing, and scorers occasionally change scoring systems by
mistake. Offering to clear times as part of the scoring-system toggle
would bundle a destructive cleanup into what should be a reversible
configuration change; if the scorer really wants times gone, they can
delete and re-enter the affected finishes.

## Consequences

### Positive

- Mixed-mode finish entry (the frostbite case) becomes natural: the
  screen looks like the sheet on the scorer's desk
- Single-mode series (all-scratch, all-handicap) are visually and
  interactively unchanged — the finish sheet model degenerates into
  exactly what they already had
- The cross-fleet Place/Rank distinction in results output goes away,
  removing a source of confusion and a decorative column
- The stored data model simplifies: one ordered list per race, row
  index as position, optional finish time per row
- The position management section of `finish-entry.md` (tie-break,
  insertion, deletion, correction, renumber) collapses into simple
  list operations — significantly less logic to maintain and test
- Move controls reuse an existing pattern (FleetsCard in series
  settings), keeping the app's reordering idioms consistent
- Scoring-system changes are reversible by default, which protects
  against accidental misclicks

### Negative

- Non-trivial migration work: `finishPosition` → `sortOrder` affects
  types, Dexie schema, series file format, public export format, and
  the scoring engine
- The Place column removal is a breaking change to HTML/JSON exports;
  consumers that parsed the Place field must adapt
- Ties UI is novel (a checkbox rather than a shared position number);
  scorers used to other software may look for the shared-number idiom
  first
- Scratch rows crossing timed rows during reorder is unconstrained;
  scorers who expect a barrier may be briefly confused. The brief
  flash is a soft mitigation, not a hard one
- An all-scratch series shows a column of `—` characters in the time
  column that is functionally inert. This is a minor cosmetic cost
  for a much simpler mixed-mode story, and can be addressed later by
  conditionally hiding the column when no fleet in the series uses
  handicap scoring

### Risks

- **Migration bugs on large existing series.** The
  `finishPosition` → `sortOrder` rename is mechanically simple but
  touches many files. Mitigated by the phased implementation in
  `finish-sheet-plan.md` — phases 1 and 2 keep outputs unchanged, so
  regressions are visible in the existing fixtures and e2e tests.
- **Auto-slide surprise.** A scorer editing a finish time and seeing
  the row jump may be startled. Mitigated by the destination flash
  and by the fact that the scorer initiated the change.
- **Invariant restoration on scoring-system revert** is an edge case
  within an edge case. Mitigated by running the same auto-slot rule
  used for normal insertion, so the behaviour is consistent.

## Related Decisions

- [ADR-002: Scoring Algorithm](002-scoring-algorithm.md) — establishes
  the hybrid hard-coded algorithm with configurable parameters. This
  ADR is consistent with that: scoring logic is unchanged, only the
  input shape (ordered list vs explicit position numbers) changes.
- [ADR-006: Testing and Debug Logging](006-testing-and-logging.md) —
  the YAML scoring fixtures approach carries the migration risk for
  Phase 2; fixture-level test passes are the primary signal that
  scoring outputs are unchanged.

## References

- [Issue #66: Finish entry UX is confusing when mixing timed and untimed competitors](https://github.com/sailscoring/sailscoring/issues/66)
- [`docs/design/ux/flows/finish-entry.md`](../ux/flows/finish-entry.md) — detailed UX for the finish sheet model
- [`docs/design/handicap-scoring.md`](../handicap-scoring.md) — Finish entry UX section
- [`docs/requirements/hyc-frostbite-use-case.md`](../../requirements/hyc-frostbite-use-case.md) — the driving use case
- [`docs/design/finish-sheet-plan.md`](../finish-sheet-plan.md) — implementation plan
- Commit [`78ebca7`](https://github.com/sailscoring/sailscoring/commit/78ebca7) — prompt for time before adding to list (step toward this model)
- Commit [`9eab6f0`](https://github.com/sailscoring/sailscoring/commit/9eab6f0) — sort finishers by finish time on entry (to be reverted)
- Commit [`8f06cda`](https://github.com/sailscoring/sailscoring/commit/8f06cda) — introduces the Place/Rank split (to be simplified to Rank-only)
