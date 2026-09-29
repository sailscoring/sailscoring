# Split Fleets Flow

Detailed user flow and wireframes for the **Split Fleets** view — the guided
workflow for running a qualifying/final series (split-fleet) event. Companion
to [`docs/design/split-fleets.md`](../../split-fleets.md),
which holds the format primer, data model, and scoring rules; this document
is about what the scorer sees and does.

**Route:** `/series/[id]/split-fleets` — a series tab (between Races and
Standings) that exists only on a split-fleet series.

> **Predates the start-sequence revision.** Scorer feedback moved the data
> model on: fleets start in sequence and finish onto **one combined sheet**,
> so a `Race` is now the start sequence (one or several fleets, disjoint
> membership) and a physical race is a (race, start) pair — see the main
> doc's "Sequenced starts and the combined finish sheet" and "The shape of
> the problem". This document still assumes one `Race` per fleet. Most of it
> survives (the ceremony, chips, validity gate, publishing), but these parts
> need a pass: chips of one sequence open the *same* finish-entry screen
> (one interleaved sheet, fleet-tinted rows) rather than one screen per
> fleet; "abandoning one fleet's race" becomes a per-start action, not a
> race-level one; race creation groups starts into sequences; and the
> entity-mapping table's "`Race` rows (one per fleet)" is no longer the
> invariant. The "explicit wrong-fleet exception flow" this document
> references was dropped (#329): a boat that starts with the wrong fleet
> of the same sequence is on the combined sheet legitimately and scores
> within her own fleet, and the residual cross-race case falls out as an
> implicit DNC — see the main doc's "Wrong-fleet finishes".

---

## Overview

A split-fleet championship runs on a rigid daily ceremony: enter the day's
finishes, resolve queries, capture the evening ranking, assign tomorrow's
fleets, publish the assignment lists, and eventually split for the finals.
Sailwave leaves that ceremony in the scorer's head (and CORK wrote a manual
and a training ladder to compensate). The Split Fleets view puts the ceremony
on screen: it is a **checklist that does the work** — each step is a real
action that creates ordinary app entities, and the view always shows where
you are in the event and what comes next.

**The view is an automation layer, not a parallel system.** Every step
manipulates the same entities a scorer could edit by hand: it creates
`Fleet` rows and assigns competitors to them, creates `Race` rows with their
fleet-scoped starts, opens the standard finish-entry screen for each physical
race, and previews/publishes the standard standings pages. There is no
split-fleet-only data path for results. If the view disappeared tomorrow, the
event would still be sitting in the Competitors, Races, and Standings tabs in
a form the rest of the app fully understands.

**Design priorities, in order:**

1. **Always show the next action.** At any moment the event has an obvious
   next step ("enter Q4 · Red", "assign Round 3", "split fleets"). The view
   computes it and offers it as the primary button. A relief scorer walking
   up to the desk mid-event should orient in ten seconds.
2. **Ceremony steps are previews, then commits.** Every assignment action
   (seeding, reassignment, split, medal selection, promotion from a
   repêchage) shows exactly what it
   will do — who moves where, from what ranking, captured when — before a
   commit that records its provenance and auto-captures a revision
   checkpoint. Nothing assignment-shaped ever happens as a side effect.
3. **Advisory, never authoritative.** Decisions that belong to the SIs and
   the race committee — is qualifying over? should a race be abandoned? —
   are the scorer's. The view surfaces the facts (races completed per
   fleet, how many races count) but never blocks on its own interpretation
   of the rules.
4. **Hand edits are legitimate.** The scorer can always drop to the
   standard tabs and edit anything. The view re-derives its picture from
   the entities and flags contradictions instead of fighting them.

---

## Anatomy of the view

The stages are stacked vertically as expandable cards, in chronological
order. A new championship has two, the opening series and the medal races;
dividing the opening series nests its two parts, **Qualifying Series → Final
Series**, inside it (see [`split-fleets-setup.md`](split-fleets-setup.md)).
Each card carries its own settings behind an expander, so there is no
separate Setup section. Not tabs: the scorer works *down* the page over
the event's week, earlier phases stay visible as collapsed summary strips
(their data still matters — qualifying columns live in the final standings),
and the transition moments ("End qualifying → split fleets") sit naturally
*between* sections, which tabs cannot express. The current phase is
auto-expanded; completed phases collapse to one-line summaries.

Above the phases, an **event strip**: the day-by-day plan as chips, and the
computed next action.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  2026 ILCA 7 Worlds                                                      │
├────────┬─────────────────────────────────────────────────────────────────┤
│  Comp. │  Tue 25    Wed 26    Thu 27    Fri 28    Sat 29    Sun 30       │
│  Races │  Q1  Q2    Q3  Q4    Q5  Q6    F1  F2    F3  F4    M1 M2 +1    │
│  Split │  ✓   ✓     ✓   ◐     ·   ·     ·   ·     ·   ·     ·  ·  ·     │
│ Fleets │                                                                 │
│  Stnd. │  Next: enter finishes for Q4 · Red          [ Open Q4 · Red ]  │
│  Sett. ├─────────────────────────────────────────────────────────────────┤
│        │  ▾ QUALIFYING SERIES                       2 rounds · Q1–Q4    │
│        │                                                                 │
│        │   Round 1 · Q1–Q2                                 ✓ Complete   │
│        │   │ Seeded from WS ranking list · lists published Mon 08:12    │
│        │   │ Yellow 47 · Blue 47 · Red 47                               │
│        │   │ Q1   [Y ✓] [B ✓] [R ✓]        counts                       │
│        │   │ Q2   [Y ✓] [B ✓] [R ✓]        counts                       │
│        │                                                                 │
│        │   Round 2 · Q3 onward                           ● In progress  │
│        │   │ From ranking after Q2 · captured Tue 20:01 · published     │
│        │   │ Yellow 47 · Blue 47 · Red 47       12 boats changed fleet  │
│        │   │ Q3   [Y ✓] [B ✓] [R ✓]        counts                       │
│        │   │ Q4   [Y ✓] [B ✓] [R ◐]        awaiting Red                 │
│        │                                                                 │
│        │   [ Assign Round 3 ]        [ End qualifying → split fleets ]  │
│        │   ▸ Settings   3 fleets · Yellow, Blue, Red                    │
│        ├─────────────────────────────────────────────────────────────────┤
│        │  ▸ FINAL SERIES                                 Not started    │
│        ├─────────────────────────────────────────────────────────────────┤
│        │  ▸ MEDAL RACES                                  Not started    │
└────────┴─────────────────────────────────────────────────────────────────┘
```

Vocabulary on screen: fleets, rounds, qualifying/final series — per the
glossary in the main design doc. The Q3/Q4 rows are the *logical races*; the
`[Y] [B] [R]` chips are their *physical races* — but the UI never uses those
words. The chips read as "Q4 · Red" etc., and each is a link to the standard
race screens.

---

## Setup

Creating a split-fleet series asks only which words its sailing instructions
use. Everything else is a setting on the card of the stage it governs, with
the Junior Champions' Cup shape as the default. The cards, their settings and
dividing the opening series are in
[`split-fleets-setup.md`](split-fleets-setup.md).

Setup creates *no* fleets or races. Those belong to rounds, so that the
entity trail always reads in event order.

---

## Phase: Qualifying Series

### The round card

Each round is a card carrying its full provenance — the answer to "why is
this boat in Blue?" is always one glance away:

- **Assignment line**: method and basis ("Seeded from CSV seeding column" /
  "From ranking after Q2 · captured Tue 20:01"), who committed it, and the
  published state of the assignment lists.
- **Fleets row**: each fleet as a chip with its size; clicking opens the
  roster (with each boat's previous-round fleet, so movement is visible).
- **Logical race rows**: one row per scheduled race the round covers, with
  a status chip per fleet — the "slots" that fill up. Chip states: *no
  race yet* (dim), *entering* (partial finish sheet), *scored*,
  *abandoned*. The row's own state is the validity rule made visible:
  **counts** once every fleet's chip is scored, **awaiting ‹fleet›**
  otherwise.

### Step: seed Round 1

With one fleet there is nothing to seed: the fleet is everyone, and the first
`[ Add Q1 ]` creates Round 1 as it creates the race. With two or more,
`[ Create Round 1 ]` opens the seeding dialog:

1. Choose where the assignment comes from. Three of the four are *orders*,
   dealt through the reassignment pattern: the competitors' seeding column
   (the `seed` field, imported via CSV), nationality-spread, or sail-number
   order. The fourth is not an order at all — **the entry list's initial
   fleet** (`Competitor.initialFleet`, imported the same way), the assignment
   the committee already made, taken as given. It exists because a seeding
   committee doesn't always hand over an *order*: the SI is "as nearly as
   possible, equal size **and ability**", and the ability judgment is human,
   so no order reproduces it. It leads the list when the entry list carries
   one, and the round then commits as `manual` rather than `seeded` — the app
   performed no seeding.
2. Preview: the full assignment table, with fleet-size totals and a per-nation
   spread summary when nationality-spread is used. Ordered by rank under the
   three order sources, and by fleet then sail number under the imported one,
   which is how the committee's own lists read. **The preview is editable** —
   the scorer can move a boat between fleets before committing (the
   committee's ability tweaks, a hull that must join a compatriot's fleet),
   and those hand-moves are recorded as overrides on top of the computed
   assignment. Under the imported source a boat the entry list placed nowhere,
   or placed in a fleet the championship doesn't have, sits in the table with
   no fleet — the unmatched labels are named above it and the commit is held
   until every boat has one.
3. Commit. The automation then: creates the round's fleets ("Yellow",
   "Blue", "Red"), assigns every competitor, captures a revision
   checkpoint, and writes the activity-log entry. It creates no races.
4. Offer: publish the assignment lists (see Publishing below).

A round covers the races added while it is current. The scorer adds each
one as the committee sails it (`[ Add Q5 ]`), and the day strip shows the
races that exist. There is no planned schedule to reconcile against: the
committee's plan changes daily, and a plan the app holds is one more thing
to keep correct.

### Filling in the races

Each `[Y]`/`[B]`/`[R]` chip opens the standard finish-entry screen (S-06)
for that physical race. Everything there works as normal, with the fleet
scoping doing quiet work: the lookup only matches boats in the race's
fleet, and "Not yet recorded" is the fleet's roster, so implicit-DNC and
the code panel are all fleet-sized. A sail number from another fleet is a
first-class case, not a rejection — the match list shows the boat greyed
with her actual fleet ("IRL 214 · Blue fleet — finished with Yellow?"),
and selecting her records the observed finish plus a flagged exception:
she scores DNC in Blue per the SI default, and the exception sits in the
round card until the scorer resolves it (accept, or record an
RC-sanctioned fleet correction). No heuristic detective work at 21:00.

### Step: reassign for the next round

`[ Assign Round 3 ]` is the evening ceremony:

```
┌──────────────────────────────────────────────────────────────────────┐
│  Assign Round 3 · covers Q5 onward                                   │
│                                                                      │
│  Basis: ranking after Q4 — the 4 races completed by all fleets       │
│  Captured now: Wed 20:00   (pending protests do not delay this —     │
│  SI: "regardless of protests or requests for redress not yet         │
│  decided")                                                           │
│                                                                      │
│  Rank  Boat                 Round 2      Round 3                     │
│   1    DEN 219144           Yellow    →  Yellow                      │
│   2    AUS 221166           Yellow    →  Blue      moved             │
│   3    GBR 218764           Red       →  Red                         │
│   ⋮                                                                  │
│  Ties: ranks 17= (2 boats) — entered in fleet order per SI 7.3       │
│                                                                      │
│  38 of 141 boats change fleet                                        │
│  [ Cancel ]                       [ Commit Round 3 · Q5 onward ]     │
└──────────────────────────────────────────────────────────────────────┘
```

- The basis is computed, not chosen: the ranking over logical races
  completed by all fleets, captured at commit time. The scorer never types
  a race range — the round covers "Q5 onward", full stop. (This is the
  Sailwave failure mode — assignment-by-current-grid-sort, hand-typed race
  numbers — designed out.)
- The commit stores the basis snapshot on the round and freezes it. From
  then on the round card states it plainly, and any later rescoring of
  earlier races shows a passive banner on the affected race and on the
  round: *"Round 3 was assigned from the ranking captured Wed 20:00 — the
  assignment does not change."* Standings recompute; assignments never do.
- Reassignment is legal while the current round is incomplete (a fleet is
  a race behind): the basis is still "races completed by all fleets", and
  the day strip shows tomorrow's reality — *"Thu: Q4 · Red (Round 2
  fleets), then Q5–Q6 (Round 3 fleets)"*. The catch-up race stays owned by
  its round; nothing needs re-wiring.
- **Manual overrides sit on top of the computed assignment.** The pattern
  is the default, not a straitjacket — the preview is editable, and a
  hand-move is recorded as an attributed override (the same mechanism as a
  redress promotion), leaving the computed basis intact for the audit trail.
  Three real cases need this, none of which the pure pattern covers: a
  **late entry** who joined after seeding (she isn't in the ranking, so the
  scorer places her by hand), an **RC/jury instruction** to move a specific
  boat, and a **wrong-fleet correction** (§Filling in the races) promoted
  into the next round's assignment. Committing the moves in writing is the
  scorer's discipline; the round card shows computed-vs-override side by
  side.

### Rescoring, abandonment, and cancelling a logical race

- **Rescoring is always open.** Protest outcomes, redress, penalties — the
  scorer edits the physical race as normal, any time, including after later
  rounds were assigned. Standings flow; frozen rounds hold; the banner
  says so.
- **Abandoning one fleet's race** is the standard race-level action. The
  logical race drops to *awaiting ‹fleet›* and the resail happens under the
  same round (same race number, per ILCA SI 12.8.2).
- **Cancelling a whole logical race** (committee abandons for all fleets,
  or the ILCA end-of-qualifying equalisation abandons the trailing
  extras): one action on the logical race row, cancelling its physical
  races together.

### Publishing during qualifying

Qualifying standings publish continuously and provisionally, matching
real-event practice — the ILCA Worlds pages carry "results as of 17:20"
and republish all evening, and the protest window runs from posted
results. The SI rule that "a race will not count until all fleets have
completed it" is about *totals*, not visibility, and the presentation
carries it: **an incomplete logical race renders as a greyed column**,
its scores visible but struck from Total/Nett, headed "Q4 — does not yet
count (awaiting Red)". Scores appear as soon as they exist; totals move
only on valid races.

Assignment lists are the other publishable: per-fleet rosters (name, sail,
bow/colour) in a print-first layout for the notice board, published to a
single rolling **Fleet assignments** page under the series' `/p/` slug —
each publish puts the newest round at the top, with earlier rounds
preserved below it, so competitors bookmark one URL for the whole event.
Committed-but-unpublished
assignments are visible to workspace members only — publication to
competitors is the explicit step the SIs time-box, and CORK deliberately
keeps some print-outs assignment-free.

### The cut line

One flourish with outsized value: once enough qualifying races count, the
qualifying standings — in-app and on the published page — draw the
**provisional final-series cut lines** — a horizontal rule at each future
Gold/Silver/Bronze boundary, labelled "provisional split if qualifying
ended now". Every sailor asks exactly this question all week; Sailwave
scorers answer it with a calculator. It also keeps the scorer oriented on
what the split will look like before the ceremony.

### Ending the phase

Qualifying ends when the scorer says so — `[ End qualifying → split
fleets ]`. The view decorates the button with facts, not judgement: races
counted so far and any pending equalisation. It never disables itself on
rule grounds.

---

## Phase: Final Series

### Step: the split

The one-time ceremony, same preview-commit shape as a reassignment:

```
┌──────────────────────────────────────────────────────────────────────┐
│  Split into final fleets                                             │
│                                                                      │
│  Basis: final qualifying ranking (Q1–Q6) · captured Thu 20:05        │
│  Equalisation: not needed — all fleets completed 6 races             │
│                                                                      │
│  GOLD    47 boats   ranks 1–47                                       │
│  SILVER  47 boats   ranks 48–94                                      │
│  BRONZE  47 boats   ranks 95–141                                     │
│                                                                      │
│  ⚠ Ranks 47 and 48 are a broken tie (A8: DEN 219144 ahead on         │
│    last-race score) — the Gold/Silver boundary depends on it.        │
│    [Review tie detail]                                               │
│                                                                      │
│  [ Cancel ]                            [ Commit split ]              │
└──────────────────────────────────────────────────────────────────────┘
```

- **The block sizes are adjustable, not just computed.** The proposal is
  near-equal blocks, Gold the largest ("as nearly as possible equal"), but
  the boundary is a judgment the SIs hand to the scorer. So the dialog
  exposes the **Gold (top-fleet) size** as an input and lets the scorer
  nudge the boundary, the tally updating live.
- Boundary ties get first-class diagnostics: any tie broken *across a cut
  line* is surfaced with its A8 resolution spelled out, and entry order
  where A8 cannot settle it, because that's the decision a jury will ask
  the scorer to defend.
- Commit creates the final fleets (Gold/Silver/Bronze), assigns
  memberships, and switches the standings presentation to tiered tables
  (Gold ranked 1…47, Silver continuing 48…, qualifying columns still
  visible and fleet-tinted). No final races exist yet.

### Racing the finals

Final fleets race independently — there is no logical-race pairing, no
validity gate. The phase section shows a races grid per fleet:

```
   GOLD     F1 ✓   F2 ✓   F3 ◐   [ Add F4 ]
   SILVER   F1 ✓   F2 ✓   [ Add F3 ]
   BRONZE   F1 ✓   F2 ✓   [ Add F3 ]
```

`[ Add ]` creates the race with a start per fleet. Its toggle chooses one
finish sheet for all fleets or a sheet per fleet, defaulting to whatever the
previous race of the series used. Chips open finish entry as in qualifying. Fleets drifting out of step is normal and
carries no warnings ("different final series fleets need not complete the
same number of final races").

### Promotion

Promotion is redress applied to an assignment, so the affordance lives
with the assignment and nowhere else: the split card carries a
`[ Promote… ]` action — pick a boat, see the effect ("IRL 220999 Silver →
Gold; Gold becomes 48, Silver 46 — no one is demoted"), commit with a
note. It's an attributed override on the split round — the audit trail
shows the original computed split and the promotion separately. Demotion
isn't offered; the rules don't allow it.

Timing matters. Before the first final race, promotion is clean — the boat
simply moves up a fleet and races Gold from F1. A redress decided *after*
final races have been sailed is messier: the boat already has Silver final
scores, so a bare fleet-move would mis-score her. The action stays available
(redress can land late) but **warns once any final race is complete** and
routes the scorer to the jury-shaped resolution the decision actually
requires (Gold status with averaged points, a re-sail, or scores carried as
the PC directs) rather than silently relocating a boat who has already
scored in the wrong fleet.

---

## Phase: Medal Races

The medal section is the same round machinery at the top of the ranking:

- **Select the medal fleet**: preview shows the top N (the card's size,
  10 by default) of the opening-series ranking at the cutoff, or of the
  Gold fleet once the opening series is divided, with the same snapshot
  provenance ("captured Sat 20:00; jury may extend"). Commit creates the
  **Medal** fleet.
- **The companion race** is not the medal card's. Once the medal fleet
  exists, the final series card offers `Add companion race`: one more race
  of that series for everyone else, in their own fleets, with its points
  offset displayed as a fact on the race chip: *"+1 race · 1st scores 11"*.
- **Medal races** are created like final races, badged **×2** when the
  points are doubled and marked non-discardable. The standings preview
  shows the medal column and the medal boats pinned to the top places.
- The last publish of the event is the same publish action as every other
  day — by now the scorer has done it a dozen times.

---

## The repêchage

Some events give the boats who missed a cut a second chance: a short series
of their own, whose leaders take the last seats in the next stage. The Irish
Sailing Champions' Cups sail one between the qualifying flights and the Final
Series; another event could sail one after Gold and Silver, for the last seat
or two in the medal fleet.

A repêchage is **not a stage**. It hangs off a cut, between the stage the
boats were cut from and the stage they hope to join. Everything about it is
the scorer's to decide, because the sailing instructions that call for one
disagree on almost everything (who may sail it, in how many flights, how many
seats it fills, what happens when there is no time to sail it):

- **Who sails it** is picked by hand.
- **Its ranking** is low point over its own races and nothing else. Every
  boat starts it on zero, with no discards.
- **It fills seats only by promotion.** The scorer promotes as many boats as
  they choose, in the order they choose. The app suggests, never decides.
- **It scores nothing in the championship.** A promoted boat sailed the same
  races of her own stage as the boats selected directly, so she carries into
  the next stage whatever that stage's carry rule gives from her own score,
  exactly as they do. Her repêchage races carry nothing.

### Order of events

1. **Select directly.** The next stage's fleet is selected as usual, top *n*
   by the card's rule, and committed. Only then does the repêchage exist to
   be added, because the direct seats decide who is eligible for it.
2. **Add the repêchage.** The card the boats were cut from gains
   `Add a repêchage`, beside `Add companion race`.
3. **Sail it**, as ordinary races.
4. **Promote from it**, into the committed round.

### The card

The repêchage is a sub-card at the foot of the card it hangs off, so it sits
visually on the cut:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ▾ QUALIFICATION SERIES                        Q1–Q3 · 2 fleets · 12 boats │
│   Flight 1   Q1 ✓  Q2 ✓  Q3 ✓        Flight 2   Q1 ✓  Q2 ✓  Q3 ✓        │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ ▾ REPÊCHAGE                          8 boats · 2 fleets · R1 ✓ R2 ◐│  │
│  │   Picked by hand from the boats outside the Final series fleet     │  │
│  │   Rep. A   R1 ✓  R2 ✓                                              │  │
│  │   Rep. B   R1 ✓  R2 ◐                                              │  │
│  │   [ Add R3 ]              [ Promote from the repêchage… ]          │  │
│  └────────────────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────────────────┤
│ ▾ FINAL SERIES                             4 boats selected · 2 seats open│
└──────────────────────────────────────────────────────────────────────────┘
```

"2 seats open" is the medal card's size less the boats in its round, a fact
and not a limit.

### Adding it

The dialog lists every boat outside the next stage's fleet, in the order of
the ranking she was cut from, with her fleet and her rank in it. The scorer
ticks the boats the committee names; nothing is ticked for them, because the
app does not know the band (the 2026 Dinghy NoR opens the repêchage to 3rd–6th
in each flight, its draft SIs to 3rd–5th).

A repêchage has **one or more fleets**, named and coloured like any other, so
that "two flights of four" is one repêchage rather than two. With more than
one fleet the dialog assigns the ticked boats to them, by hand, with the
same move-a-boat preview as seeding. Each fleet is ranked on its own: the
fleets are separate selection pools, so there is no cross-fleet ranking and
no rule that a race counts only once every fleet has sailed it.

The membership can be edited, and the repêchage deleted, until a boat is
promoted from it.

### Racing it

Repêchage races are numbered R1, R2 …, whatever words the sailing
instructions use elsewhere. They are ordinary races on the Races tab, grouped
under the repêchage, with the same one-sheet-or-a-sheet-per-fleet choice as
any other stage race. Finish entry offers only the repêchage's boats. A boat
that does not finish scores the boats in her repêchage fleet, plus one.

### Promoting

`Promote from the repêchage…` is the same preview-then-commit as every other
ceremony step. It adds boats to the committed round as attributed additions,
marked *via repêchage* — the same override record the split card's
`Promote…` writes for redress, with a different reason.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Promote into the Final series fleet            2 seats open (of 6)  │
│                                                                      │
│  From  (●) Repêchage ranking   ( ) Qualification series ranking      │
│                                                                      │
│   Rep. A   ☑ 1  IRL 2211  Hall          2.0                          │
│            ☐ 2  IRL 1807  Byrne         4.0                          │
│   Rep. B   ☑ 1  IRL 3145  Kenny         3.0                          │
│            ☐ 2  IRL 1409  Walsh         3.0   tie broken by A8       │
│                                                                      │
│  [ Cancel ]                                  [ Promote 2 boats ]     │
└──────────────────────────────────────────────────────────────────────┘
```

- **The suggestion is the leaders**, up to the seats open, and it is only a
  suggestion. The scorer can promote fewer, more, or different boats; the
  split of seats between repêchage fleets is theirs to read from the
  instructions.
- **The second source is the fallback.** When there is no time to sail the
  repêchage, the instructions usually name the boats to promote instead,
  such as the third boat of each flight — which is what both 2025 Champions'
  Cups did. Promoting from the ranking the boats were cut from covers that
  with no repêchage at all.
- **Before the next stage's first race**, promotion is clean. After it, the
  late-promotion warning of the split card's `Promote…` applies.
- **A companion race changes when the medal fleet does.** Its first place
  scores the medal fleet's size plus one, and its boats are the ones outside
  that fleet, so promoting afterwards would re-place it. The dialog warns
  when a companion race exists, and `Add companion race` points to any
  repêchage not yet promoted from.

### Standings

The standings page shows each ranking separately, in this order:

1. **The championship ranking** — the final (or medal) stage. Promoted boats
   rank in it like any other, their row marked *via repêchage*.
2. **The repêchage ranking** — one table per repêchage fleet, over R1, R2 …
   alone.
3. **The ranking the boats were cut from** — the qualification series, in
   its own tables.

Where nothing is carried, as at the Champions' Cups, the championship table
holds the final stage's races only: no qualifying columns and no carried
column, because none of it counts. A boat who was never promoted appears in
the rankings she sailed in, and in no championship table — the two-tables,
not-one-ranking result those events publish. Where a score is carried, the
championship table keeps its carried column as it does today, and the other
rankings still stand alone below it.

Repêchage races are never columns in the championship table: setting races
that count beside races that don't invites the misreading the instructions
forbid. The publish dialog offers the repêchage as a page of its own, and the
per-race results page lists R1, R2 … with the rest.

### Next action, and the sailing instructions

The event strip steps through it like any other stage: *Enter R2 · Rep. B*,
then *Promote from the repêchage*. Once every seat is filled it moves on to
the next stage's first race.

The sailing-instructions view says nothing about a repêchage until one
exists. Then it states the rule: the repêchage is scored on its own races
only, and a boat promoted from it carries her score as the other boats of the
fleet she joins do.

---

## What the automation touches

Every action maps onto ordinary entities — this table is the "no parallel
system" guarantee, and each row lands in the activity log:

| Action | Creates / edits |
|---|---|
| Seed / reassign / split / medal select | `Fleet` rows; competitor↔fleet memberships; the round record (basis, method, overrides); revision checkpoint |
| Add a race | One `Race` with a `RaceStart` per fleet (one finish sheet), or a `Race` per fleet (a sheet each), chosen as the race is added |
| Enter finishes | Standard `Finish` rows via S-06 |
| Publish standings / assignment lists | Standard publications under the series' `/p/` slug |
| Promote / wrong-fleet resolution | Override on the round record + membership edit |
| Add a repêchage / edit its membership | The repêchage's `Fleet` rows and memberships, outside the stage sequence; revision checkpoint |
| Promote from a repêchage | Override on the next stage's round record (reason *via repêchage*) + membership edit; revision checkpoint |

**Drift handling:** because the view re-derives from entities, hand edits
in the standard tabs are absorbed silently when consistent (renaming a
fleet, fixing a start time) and flagged when they contradict a round
("IRL 214's membership was hand-moved to Blue; Round 2 assigned Yellow —
keep the edit as an override, or revert"). Flags sit on the round card,
never modal.

---

## Guardrails (summary)

- Preview → commit → provenance for every ceremony step; revision
  checkpoint auto-captured at each commit.
- Round basis is computed and frozen; no hand-typed race ranges anywhere.
- Rescoring is never locked; frozen rounds explain themselves with banners
  instead of blocking edits (Sailwave's freeze-checkbox, inverted).
- The next-action computation never crosses into rules judgement: it
  points at incomplete work, not at SI decisions.
- A repêchage's membership and its promotions are the scorer's; the app
  suggests the leaders up to the seats open and enforces no quota.
- Finish entry fleet-scoping plus the explicit wrong-fleet exception flow
  replaces wrong-fleet forensics.

---

## Small screens

The desk runs on a laptop; the view is designed for it. But tweaks happen
away from the desk — a late scoring code, a wrong-fleet exception, a
republish after a jury decision — sometimes by the lead scorer with
nothing but a phone. So the view degrades to a phone deliberately rather
than accidentally: the phase stack and day strip collapse naturally,
every action stays reachable, and the ceremony previews compress to
their summary lines ("38 of 141 boats change fleet") with the full table
a tap away. No separate read-only mode — the pinch-tweak scorer needs
the same buttons, just smaller.
