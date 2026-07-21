# Split Fleets Flow

Detailed user flow and wireframes for the **Split Fleets** view — the guided
workflow for running a qualifying/final series (split-fleet) event. Companion
to [`docs/design/qualifying-final-series.md`](../../qualifying-final-series.md),
which holds the format primer, data model, and scoring rules; this document
is about what the scorer sees and does.

**Route:** `/series/[id]/split-fleets` — a series tab (between Races and
Standings) that exists only on a split-fleet series.

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
   (seeding, reassignment, split, medal selection) shows exactly what it
   will do — who moves where, from what ranking, captured when — before a
   commit that records its provenance and auto-captures a revision
   checkpoint. Nothing assignment-shaped ever happens as a side effect.
3. **Advisory, never authoritative.** Decisions that belong to the SIs and
   the race committee — is qualifying over? should a race be abandoned? —
   are the scorer's. The view surfaces the facts (races completed per
   fleet, what the preset's SIs typically require) but never blocks on its
   own interpretation of the rules.
4. **Hand edits are legitimate.** The scorer can always drop to the
   standard tabs and edit anything. The view re-derives its picture from
   the entities and flags contradictions instead of fighting them.

---

## Anatomy of the view

The three phases — **Qualifying Series → Final Series → Medal Races** — are
stacked vertically as expandable sections, in chronological order, plus a
Setup section at the top. Not tabs: the scorer works *down* the page over
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
│        │  ▸ Setup     ILCA Worlds preset · 3 fleets · 141 entries    ✓  │
│        ├─────────────────────────────────────────────────────────────────┤
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

## Phase: Setup

Setup runs once, when the series is created as a split-fleet series (see
`series-setup.md`; the format choice is immutable once racing starts, like
`scoringMode`). The section collapses to a summary strip afterwards.

- **Preset first**: "ILCA World/European Championship", "IODA
  Championship", "Custom". The preset fills the whole scoring regime
  (carry mode, code bases, equalisation mode, discard caps, medal config) —
  the scorer confirms rather than composes. Custom exposes the full
  `QualifyingFinalConfig` surface.
- **Fleet count and colours**: entry count is known, so the view shows the
  arithmetic live: "141 entries → 3 fleets of 47". Colour sets offered in
  SI-standard order (Yellow, Blue, Red, Green), with the race-office rule
  enforced softly: picking two colours with the same initial letter gets a
  warning, not a block.
- **Final fleet names** default to Gold/Silver/Bronze to match the count.
- **The planned schedule**: the scorer sketches the event's days and races
  per day (pre-filled by the preset — six days, two a day), which gives
  the day strip its future days before any race exists and each round its
  default coverage. Scorers like their ducks in a row: the whole event is
  laid out from day zero, as a plan the strip reconciles against reality
  as racing happens. Editing the plan mid-event is an ordinary setup
  edit, not a ceremony.

Setup creates *no* fleets or races — those belong to rounds, so that the
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

`[ Create Round 1 ]` opens the seeding dialog:

1. Choose the order source: the competitors' seeding column (imported via
   CSV), nationality-spread, or sail-number order. The chosen source is
   recorded on the round.
2. Preview: the full assignment table (rank order → fleet), with fleet-size
   totals and a per-nation spread summary when nationality-spread is used.
3. Commit. The automation then: creates the round's fleets ("Yellow",
   "Blue", "Red"), assigns every competitor, creates the physical races the
   round covers (Q1·Y, Q1·B, Q1·R, Q2·Y, …) each with its fleet-scoped
   start, captures a revision checkpoint, and writes the activity-log
   entry.
4. Offer: publish the assignment lists (see Publishing below).

How many races a round covers comes from the planned schedule sketched at
setup; the scorer can add another logical race to the current round in
one action ("Add Q5 to Round 2") when the committee races ahead of
schedule — the day strip updates to match.

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
  races together. In the LE/IODA equalisation mode the same moment is
  expressed differently — the logical race stays, and the affected boats'
  extra scores are marked excluded — the view presents whichever the
  config prescribes when qualifying ends with fleets out of step.

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
counted so far, the preset's typical minimum ("ILCA SIs require ≥4"), and
any pending equalisation. It never disables itself on rule grounds.

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

- Boundary ties get first-class diagnostics: any tie broken *across a cut
  line* is surfaced with its A8 resolution spelled out, because that's the
  decision a jury will ask the scorer to defend.
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

`[ Add ]` creates the physical race with its fleet-scoped start; chips open
finish entry as in qualifying. Fleets drifting out of step is normal and
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

---

## Phase: Medal Races

The medal section is the same round machinery at the top of the ranking:

- **Select the medal fleet**: preview shows the top-N (config; 10) of the
  opening-series ranking at the cutoff, with the same snapshot provenance
  ("captured Sat 20:00; jury may extend"). Commit creates the **Medal**
  fleet — and, when the preset says so, the **companion fleet** (the rest
  of Gold) for the additional opening-series race, with its points offset
  displayed as a fact on the race chip: *"+1 race · 1st scores 11"*.
- **Medal races** are created like final races, badged **×2** for the
  points multiplier and marked non-discardable. The standings preview
  shows the medal column with doubled points and the medal boats pinned to
  the top ten places.
- The last publish of the event is the same publish action as every other
  day — by now the scorer has done it a dozen times.

---

## What the automation touches

Every action maps onto ordinary entities — this table is the "no parallel
system" guarantee, and each row lands in the activity log:

| Action | Creates / edits |
|---|---|
| Seed / reassign / split / medal select | `Fleet` rows; competitor↔fleet memberships; the round record (basis, method, overrides); revision checkpoint |
| Round covers races | `Race` rows (one per fleet) + fleet-scoped `RaceStart`s |
| Enter finishes | Standard `Finish` rows via S-06 |
| Publish standings / assignment lists | Standard publications under the series' `/p/` slug |
| Promote / wrong-fleet resolution | Override on the round record + membership edit |

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
- Finish entry fleet-scoping plus the explicit wrong-fleet exception flow
  replaces wrong-flight forensics.

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
