# Qualifying and Final Series (Flights)

Design for scoring championship events that split a large entry into rotating
**flights** for a qualifying series, then lock boats into **Gold / Silver /
Bronze** fleets for a final series — the RRS "Appendix LE Addendum C" format
used by ILCA, Optimist, 420, 29er/49er and Topper world championships, and by
big multi-class regattas like Kieler Woche. Nothing is implemented yet; this
document is the primer, the data-model design, the UX outline, and the open
questions.

Sources: the ISAF Appendix LE templates
(`reference-docs:rrs/Appendix-LE-Expanded-SI-Guide-2006.md`,
`reference-docs:rrs/Appendix-LE-Expanded-SI-Guide-2013.md`), the Sailwave
flights guides
(`reference-docs:tool-manuals/sailwave/Sailwave-Setting-Up-And-Running-Flights-YNZ.md`,
`reference-docs:tool-manuals/sailwave/Sailwave-Appendix-LE-Slides-Irish-Sailing.md`,
the User Guide, and the CORK results-management manual), and the published
NoRs/SIs of recent ILCA, IODA, 49er, 29er, 420, Topper and Kieler Woche
championships (URLs in References).

---

## Part 1 — Primer

### Why events split the fleet

A start line can handle roughly 40–80 boats. A world championship attracts
100–300. So the entry is divided into groups that race separately — smaller,
fairer starts, and manageable launching ashore. But a simple static split
would crown group winners, not a champion: boats in different groups never
meet. The qualifying/final format solves this in two phases:

1. **Qualifying series (Q):** boats race in *flights* (typically named
   Yellow, Blue, Red, Green) of roughly equal size **and ability**. After
   each day, flights are **reshuffled by current overall rank** so that the
   groups stay balanced — every flight contains a spread of leaders and
   backmarkers, and everyone eventually races comparable opposition.
2. **Final series (F):** once enough qualifying races are sailed, the overall
   ranking is frozen and boats are assigned **once** to tiered final fleets —
   Gold (the top block), Silver, Bronze, Emerald… Each fleet then races only
   among itself. **A boat's final fleet is a hard ceiling:** every Gold boat
   ranks above every Silver boat in the championship, regardless of points.

Some events add a **medal race/series** on top: the top 10 after the "opening
series" (= qualifying + final) sail one or two extra races, usually at double
points and non-discardable, that decide the podium.

### Where the rules live — the strange story of Appendix LE

The RRS proper contain **none of this**. Appendix A knows nothing about
groups or splits; the entire mechanism is sailing-instructions material. The
canonical wording came from **Appendix LE — Expanded Sailing Instructions
Guide**, an ISAF web-only expansion of the in-book Appendix L (SI Guide),
whose **Addendum C — "Qualifying Series and Final Series; Opening Series and
Medal Race"** was the template every class copied.

The publication history explains why a .doc dated 2006 still circulates as if
canonical:

- Editions were published for **2005–2008** (version 17 Oct 2006 — our
  template copy), **2009–2012** (26 Feb 2009), and **2013–2016** (27 Jan
  2013). All three are still downloadable from sailing.org's old document
  store.
- **No 2017–2020 edition was ever published** (the Sailwave user guide
  footnotes this, mystified).
- The 2021 rules restructure (RRC submission 221-19) removed Appendices K and
  L from the rulebook entirely, replacing them with online NoR/SI guides
  ("Appendix KG"/"LG"). **The successor guides dropped the LE addenda** — the
  current March 2025 SI Guide contains only a supplied-boats addendum. RRS
  2025–2028 has no Appendix L at all.

So the **27 January 2013 edition is the final official text**, and nothing
has replaced it. The format lives on as de-facto class boilerplate: classes
maintain the 2006/2013 Addendum C wording themselves, hand-patching rule
numbers as the RRS shift under it (Addendum C's "rule A4.2 is changed…" is
rule **A5.2** since 2021; the old A9 long-series rule is gone and A9 is now
redress guidance; Addendum C's "rule 5 or 69" carve-out is "rule 6 or 69"
today). ILCA's SIs carry a standardised "Addendum A — Qualifying & Final
Series Formats" descended from it; IODA's championship SIs are nearly
verbatim Addendum C. When implementing, the 2013 Addendum C is the reference
wording, cross-checked against a current class SI for rule-number drift.

### The canonical mechanics (Addendum C walkthrough)

**Initial seeding.** A seeding committee assigns boats to flights "of, as
nearly as possible, equal size and ability", posted before racing (ILCA: by
2000 on the last registration day). In practice the sort key is a class
ranking list, or nationality-then-sail-number so compatriots are spread
across flights, or plain sail number.

**Daily reassignment (the serpentine).** After each day of qualifying racing
— except if only the first race of the event is completed — boats are
redistributed by current series rank, snaking through the flights so each
flight gets an equal share of every band of the ranking. The 2013 LE table
for four flights (rank → flight): 1 Yellow, 2 Blue, 3 Red, 4 Green, 5 Green,
6 Red, 7 Blue, 8 Yellow, and so on. ILCA's Addendum A gives the tables for
two flights (Y B B Y | Y B B Y …) and three (Y B R | R B Y | Y B R …) as
well. Two subtleties:

- *Tied ranks:* LE says tied boats enter the serpentine "in the order of
  fleets in instruction 7.2" (i.e. deliberately scattered); the 2024 IODA
  South Americans instead break residual ties by the registration sort order
  after applying RRS A8. Both variants exist in the wild.
- *The snapshot:* assignments are computed from "the ranking available at
  2100 [ILCA: 2000] that day **regardless of protests or requests for
  redress not yet decided**". The assignment is a snapshot, deliberately
  insulated from later score changes — a crucial property for the data model.

**Unequal race counts.** If flights get out of step (one flight's race
abandoned), the reassignment ranking is computed only over "those races,
numbered in order of completion, **completed by all fleets**". The lagging
flights race first the next day until counts equalise, and "all boats will
thereafter race in the new fleets" — so a catch-up race is sailed in the
*old* assignment while later races that day use the *new* one. At the end of
qualifying, leftovers are equalised: LE/IODA **exclude each boat's
most-recent extra scores** so everyone has the same number of race scores;
ILCA's variant instead **abandons and cancels the extra races outright**.
Either way, a qualifying race only ever counts "when all fleets have
completed that race".

**The split.** Final fleets mirror the flight count (3 flights → Gold,
Silver, Bronze), sized "as nearly as possible equal, but so that the Silver
fleet is not larger than the Gold fleet", filled by qualifying rank in
blocks. Some classes fix the top-fleet size instead (49er 2022: Gold = top
25; 29er standard SIs: Gold = 45). Once made, the split is frozen: "any
recalculation of qualifying-series ranking … will not affect the assignments
**except that a redress decision may promote a boat to a higher fleet**" —
promotion only, nobody is demoted to make room, fleets may end up unequal.

**Final ranking.** Fleet tier dominates: Gold boats rank above Silver boats
above Bronze, points second — with the carve-out that a boat disqualified
from a final race under RRS 6 (was 5) or 69 loses the tier guarantee, and
(IODA variant) a boat scored DNE in *all* races ranks last overall.

### Scoring mechanics that differ from a normal series

**Score-code points ("based on the largest fleet").** RRS A5.2 scores DNC &
friends as "entries in the series + 1" — meaningless when each race is
sailed by a 47-boat flight out of 141 entries. So the SIs change A5.2:

- *Qualifying:* codes score **the number of boats assigned to the largest
  flight, plus one** (assigned, not starters — DNC boats stay in the
  divisor). Verified: 2025 ILCA 7 Worlds, 138 entries in 3 flights of 46 →
  every BFD/DNC/RET/UFD scored 47.
- *Final:* codes score **the boat's own fleet size plus one** (ILCA,
  Santander); a Silver DNC costs Silver-fleet points, not entry-list points.

**Within-flight places.** Each flight's race produces its own 1, 2, 3… — a
qualifying race day yields three 1sts, three 2nds. (Sailwave calls this
"allow multiple 1sts"; for our engine, places are simply computed within the
group that sailed the race.)

**One continuous points line — usually.** In the dominant model (ILCA, IODA,
420, 49er, Kieler Woche, Santander) qualifying scores **carry forward as
points** into one series total; Q1…Qn and F1…Fn are columns of a single
line. But three other carry models exist:

| Carry model | Events | Mechanics |
|---|---|---|
| **Continuous points** | ILCA, IODA, 420, 49er, KiWo | One total across Q+F; discards float across the boundary (KiWo makes this explicit: a qualifying discard "may be substituted by a worse score in the final series") |
| **Net + net** | 29er | Q and F are separately-discarded series; championship score = Q net + F net; F ties broken on F scores only |
| **Rank as seed** | Topper | Finals restart from a carried, non-discardable score equal to the boat's qualifying **rank** |
| **Knockout bracket** | iQFOiL, Formula Kite | Opening series seeds quarter/semi/grand finals scored on match points — not low-point arithmetic at all (out of scope; see horizon) |

**Stage-aware discard profiles.** The famous "special ILCA discard profile"
(2025 Worlds SI 18.2, 2026 NoR 15.2): 1 discard from 4 races, 2 from 10 —
but **at most one discard may fall on a final-series race**, a lone
completed final race may not be discarded at all, and medal-series scores
are never discardable (and don't advance the race count for discard
thresholds). Note what this is *not*: the folk description "a discard earned
in qualifying can't be used in the finals" is wrong — discards float across
the whole line, subject to those per-stage caps.

**Redress.** Three interlocking rules: reassignment/split snapshots ignore
pending protests; a later redress decision may promote (only promote) a boat
across the split; and RDG averages need care — US Sailing's Appendix A
guidance warns the protest committee must "specify exactly which races to
include in the 'average points' calculation" when a series spans a split.
Our RDG model (method + explicit include/exclude race sets) already carries
exactly this.

**Ties.** Standard A8 within a series/fleet; 49er breaks final-series ties
on final-series scores only; the 2013 LE medal-race tie-break (medal score
first, then A8 over the opening series) applies where a medal race exists.

### The 2026 ILCA Worlds — the concrete target

The **2026 ILCA 7 Men's Worlds run 23–30 August 2026 at Dun Laoghaire**
(National YC / Royal St George YC; entry cap 160, ~141 entered from 45
nations → 3 flights), and the **ILCA 6 Women's Worlds follow there 5–12
September** (~100 entries → 2 flights). Format per the NoRs: 12 races over 6
days, two per day; qualifying ends once at least 4 races are complete at a
day boundary (days 1–3 nominally); then Gold/Silver(/Bronze); **new for
2026, a two-race medal series** for the top 10 on the last day, with one
more opening-series race for everyone else. Codes: largest flight + 1 in
qualifying, own fleet + 1 in finals; discards 1 from 3 (NoR: 3–9 races), 2
from 10, max one from finals, medal races excluded. Starts and OCS/BFD calls
via Vakaros RaceSense (electronic identification replaces visual for 30.3/
30.4). Races are named **Q1…Qn / F1…Fn** officially. The 2025 Qingdao
edition is a valuable degenerate fixture: weather meant **neither class ever
split** — the qualifying ranking became the official result under the
"if no final race is completed" fallback.

The 2026 SIs (including exact medal-series scoring) publish on the event
notice board before registration; the format sections above are stable
class-standard wording, but the medal-series points multiplier needs
confirming from the SIs when they appear.

### How Sailwave does it — and where it hurts

Sailwave is the de-facto scorer for these events (recent ILCA Worlds, Youth
Worlds, Masters, U21s, and CORK's Optimist events all publish Sailwave
HTML), and its vocabulary is instructive: a **flight is a per-race
competitor attribute** populated by a flight-assignment tool (serpentine per
Addendum C, or seeded orders); the Q-series is scored "as one group" with
multiple 1sts and a raised code base; the F-series is scored "groups
separately" over a static Fleet field. But the workflow is a manual
high-wire act, documented in loving detail by the CORK manual (whose
"Senior Scorer" job definition is literally the ability to run a Q/F
split):

- The recommended shape is **two separate files** (Q and F), bridged by a
  merge step that writes each boat's qualifying points/rank into a
  non-discardable "carried forward" field — except ILCA's floating-discard
  profile *requires* one file, a special "Appendix LE tab" (first final race
  number, F-discard caps, finals-only tie-break), and a **"do not
  recalculate qualifying race points" freeze checkbox** once finals begin.
- The assignment tool applies to *whatever order the grid is currently
  sorted in* — forget to re-score first and the flights are silently wrong.
  Entering the wrong race-number range overwrites flights already sailed.
  There is no undo anywhere; the mitigation is ritual file copies.
- The unequal-race-count case is a documented **seven-step manual dance**
  (clear the completed race's results, re-score, re-assign, re-publish,
  re-enter the cleared finish sheets), flagged "EXTRA EXTRA careful" in the
  manual; the community forum calls the workarounds "very error prone".
- A jury reopening a qualifying race after the split triggers CORK's
  multi-step unwind: unfreeze, flip code bases back, fix, re-score,
  re-freeze, restore code bases.
- Wrong-flight finishers are expected ("quite likely"); detection is a
  heuristic — "a tell-tale sign is suddenly a competitor gets a first-place
  finish in their supposed new flight".

Every one of these pain points is an artifact of bolting per-race group
state onto a static-fleet single-user desktop model. A server-native
implementation with first-class assignments, snapshots, and revision
history (#166) can make the same operations safe: that is the design goal.

The wider landscape, for calibration: **Manage2Sail's ORM** scores Q/F
natively (fleet split methods, serpentine, per-fleet starting lists; used
for World Sailing Youth Worlds results and ILCA U21 Europeans), the Dutch
**ZW** tool has arguably more automated group assignment, and **St Pete
Scorer** is IODA's co-recommendation alongside Sailwave. Almost nothing
else in the market — HalSail, ORC Scorer, Yacht Scoring, Regatta Network,
Clubspot — has real flight machinery. Supporting this format well puts Sail
Scoring in a club of about four.

### Contrast: IODAI's national majors are *not* this format

Relevant to our Irish Optimist users: the IODAI Major Event SIs
(`reference-docs:events/iodai-2025/Major-Event-SIs-v1.0.md`) use **static**
Gold/Silver/Bronze fleets within Senior/Junior divisions, pre-assigned by
IODAI fleet-qualification criteria — no qualifying series, no reassignment,
plus a stand-down rule that scores rested groups average points mid-series.
Today that's handled with our existing fleets/subdivisions. The flights
feature is for the rotating-assignment championship format; the two must not
be conflated in the UI.

---

## Part 2 — Data model

### What exists, and why it isn't enough

- **`Fleet`** is Sail Scoring's scoring group — static membership
  (`Competitor.fleetIds`), a handicap system, its own standings. A flight is
  the opposite: scratch, **membership varies per race**, and standings are
  computed *across* flights, not per flight.
- **`RaceStart`** already scopes which fleets sail a race and models
  multiple guns. It is fleet-keyed, not group-keyed, and cannot express "the
  Yellow third of the entry".
- **`SubSeries`** (#203) scores a race subset independently over static
  fleet membership. Q and F are not independent — points carry across, and
  the final ranking interleaves both — and sub-series have no concept of
  per-race membership either.
- **`SubdivisionAxis`** is display/prizes-only, deliberately non-scoring.

So flights need new first-class state. Three ideas anchor the design:

1. **A physical race per (logical race × group).** "Q3" is not one race; it
   is three races on the water — Q3-Yellow, Q3-Blue, Q3-Red — each with its
   own start, finish sheet, abandonment, and possibly its own day (catch-up
   races). Modelling each as a `Race` row keeps the existing finish-sheet
   model, per-race abandonment, and protest-time-limit machinery intact.
   The *logical race* (stage + number) is the standings column; the engine
   picks each boat's score from the group-race she sailed.
2. **Assignments are snapshots, not derived state.** The SIs are explicit
   that assignments are computed from a stated ranking at a stated time and
   are *not* revisited when scores change. So assignments are stored data
   with provenance (what standings, computed when, by what method), never
   recomputed on the fly. Rescoring a protest can never silently reshuffle
   a sailed flight — the exact property Sailwave enforces with a freeze
   checkbox falls out of the model.
3. **One mechanism for every assignment event.** Initial seeding, each
   daily reassignment, the Gold/Silver split, and medal-series selection
   are all the same act: "assign competitors to groups for stage races ≥
   N, based on a stated ranking". One entity — an assignment round —
   covers all four, giving a uniform audit trail and a uniform publishing
   artifact (the posted assignment list).

### New types (sketch)

```ts
export type SeriesStage = 'qualifying' | 'final' | 'medal';

/** A racing group within a stage: a qualifying flight (Yellow, Blue…) or a
 *  final fleet (Gold, Silver…). Distinct from `Fleet` (the scoring-system
 *  construct); a Q/F series typically has exactly one Fleet (the class). */
export interface RaceGroup {
  id: string;
  seriesId: string;
  stage: SeriesStage;
  label: string;        // "Yellow", "Gold", "Medal"
  color?: string;       // display colour for race cells / assignment lists
  order: number;        // qualifying: SI 7.2 order (serpentine + tie order);
                        // final: tier order (Gold first) — ranking dominance
}

/** One assignment event: competitors → groups for `stage` races numbered
 *  `fromStageRace` onward, until superseded by a later round of the same
 *  stage. Snapshot semantics: `basis` records what it was computed from;
 *  the stored map is authoritative regardless of later rescoring. */
export interface AssignmentRound {
  id: string;
  seriesId: string;
  stage: SeriesStage;
  fromStageRace: number;                    // e.g. finals: 1; day 3: 5
  method: 'seeded' | 'serpentine' | 'split' | 'manual';
  basis?: {
    throughStageRace: number;               // ranking over races 1..N
    capturedAt: number;                     // the 2000/2100 snapshot time
  };
  assignments: Record<string, string>;      // competitorId → raceGroupId
  /** Post-hoc corrections (late entry, RC decision, redress promotion),
   *  layered over `assignments` and individually attributable. */
  overrides?: Record<string, string>;
  publishedAt?: number;                     // assignment list published
  version?: number;
}

/** Series-level format configuration. Present iff the series uses the
 *  qualifying/final format. */
export interface QualifyingFinalConfig {
  carry: 'points' | 'net-plus-net' | 'rank-seed';
  /** Final-fleet sizing: LE-style near-equal blocks (Gold ≥ Silver ≥ …),
   *  or a fixed top-fleet size (49er/29er). */
  split: { kind: 'equal-blocks' } | { kind: 'fixed-top'; topSize: number };
  codeBasis: {
    qualifying: 'largest-flight' | 'fixed';  // fixed: Sailwave's safe option
    fixedPoints?: number;
    final: 'own-fleet' | 'largest-flight';
  };
  /** End-of-qualifying equalisation when flights completed unequal counts:
   *  exclude each boat's most-recent extra scores (LE/IODA) or abandon the
   *  extra races outright (ILCA). */
  equalization: 'exclude-extra-scores' | 'abandon-extra-races';
  /** Stage caps layered on Series.discardThresholds: max discards that may
   *  fall on final races (ILCA: 1), and a lone completed final race is
   *  undiscardable. Medal races are never discardable and don't count
   *  toward discard thresholds. */
  maxFinalDiscards?: number;
  protectLoneFinalRace?: boolean;
  serpentineTieOrder: 'group-order' | 'a8-then-entry-order';
  medal?: { size: number; raceCount: number; multiplier: number };
}
```

`Race` gains three optional fields (absent on standard series):

```ts
stage?: SeriesStage;
stageRaceNumber?: number;   // Q3 → ('qualifying', 3); the standings column
raceGroupId?: string;       // which flight/fleet sailed this physical race
```

`Series` gains `qfConfig?: QualifyingFinalConfig`. Membership of a physical
race resolves as: the latest `AssignmentRound` of that stage with
`fromStageRace <= race.stageRaceNumber`. Because rounds are keyed by logical
race number, not date, catch-up races sailed a day late automatically use
the assignment under which they were scheduled — the LE 7.3(c) behaviour
falls out with no special case.

### Scoring engine changes

The engine (`lib/scoring.ts`) gains a Q/F path alongside fleet standings:

- **Per-group places.** Places/points computed within each physical race's
  resolved membership (this is `RaceScore.rank`'s logic applied to a group
  instead of a fleet — the "multiple 1sts" property).
- **Code points** from `codeBasis`: largest-flight-assigned-size + 1 during
  qualifying (assigned size — DNC boats included in the divisor), own-fleet
  size + 1 in finals, or the fixed value.
- **Logical-race columns.** Standings aggregate by `(stage,
  stageRaceNumber)`; each boat's cell comes from the group-race she was
  assigned to. A qualifying logical race contributes nothing until **all**
  flights have completed it (ILCA 7.4); end-of-stage leftovers are handled
  per `equalization` — note the LE/IODA mode is *per-boat* score exclusion
  (a new exclusion reason, distinct from discards and from
  `RaceFleetExclusion`), while the ILCA mode marks the physical races
  abandoned.
- **Stage-aware discards.** `getDiscardCount` unchanged for the threshold;
  discard *selection* honours `maxFinalDiscards`, `protectLoneFinalRace`,
  and medal exclusions. Medal races are excluded from the race count that
  drives thresholds (2024 ILCA wording).
- **Carried scores.** `carry: 'points'` is a no-op (one continuous line);
  `net-plus-net` computes per-stage nets and sums; `rank-seed` synthesises
  a non-discardable carried score equal to qualifying rank (this is
  Sailwave's CarriedFwd field, but computed, not hand-merged).
- **Tiered final ranking.** Overall order: medal participants first (where
  a medal stage exists), then Gold block, Silver block, … — each block
  internally by net points + A8 — with the RRS 6/69 carve-out surfaced as a
  per-boat flag rather than automated (it needs a jury decision anyway).
- **The serpentine itself** is a pure function (`lib/flights.ts`):
  `(rankedCompetitorIds, groups, tieOrder) → assignments`, plus the seeded
  initial orders (seed rank / nationality-spread / sail number). Pure,
  fixture-tested, and reused by the reassignment preview UI.
- **Wrong-group finishes.** A finish row for a boat not in the race's
  resolved membership scores nothing there and DNC in her own group's race
  (the SI-default outcome) and surfaces a `ScoringRejection` so the scorer
  sees it immediately — Sailwave's "suspicious 1st place" heuristic
  becomes a deterministic warning with a one-click fix (move the finish to
  her group's race, or record an RC-sanctioned assignment override).

### Persistence, files, exports

- New tables `race_groups` and `assignment_rounds` (assignments as JSONB),
  three nullable columns on `races`, `qf_config` JSONB on `series` — all
  mirrored in `lib/db/schema/`, validation in `lib/validation/`, and the
  repositories.
- **Series-file format bump**: groups, rounds, race stage fields, and
  `qfConfig` must round-trip through `lib/series-file.ts` (v13 or
  whatever's next; omitting any of it is silent data loss).
- **Public JSON export** carries the same (flights are public information —
  they're on every published results page); the rrs.org push and CSV
  import gain nothing mandatory, but CSV import should accept a
  seeding/flight column (Sailwave-compatible ingest of an OA seeding list).

## Part 3 — UX (high level)

### Series setup

Format is chosen at series creation (and immutable once any race has
finishes, like `scoringMode`): a "Qualifying + final series" option, gated
(see Part 4), asking only: number of flights (offering the standard colour
sets — with the race-officer folklore rule that colour names must not share
an initial letter), final fleet names (defaulting Gold/Silver/Bronze to
match the flight count), and the carry/discard preset. Presets matter more
than knobs here: "ILCA World/European Championship", "IODA Championship",
"Custom" — each filling `QualifyingFinalConfig` with the class-standard
values, the way NHC profiles default to SWNHC2015.

### The Flights tab

A Q/F series gets a **Flights** tab (alongside Competitors / Races /
Standings): the timeline of assignment rounds, each showing method, basis
("from standings through Q4, captured 20:00"), the per-flight rosters, any
overrides, and its published state. Actions:

- **Seed initial flights** — sort key choice (seeding column from CSV,
  nationality-spread, sail number), preview, save as round 1.
- **Reassign for tomorrow** — the serpentine over current standings, with a
  side-by-side preview (who moves where) before committing; the snapshot
  basis is recorded automatically. The tool proposes `fromStageRace` =
  next unsailed logical race — never a hand-typed race range, eliminating
  Sailwave's overwrite-sailed-flights failure mode.
- **Split into final fleets** — end-of-qualifying wizard: shows the
  equalised qualifying ranking (with any per-boat excluded scores), the
  proposed Gold/Silver/Bronze blocks per the split rule, tie diagnostics,
  and creates the final-stage round plus the F-race skeletons.
- **Promote (redress)** — a targeted override on the final round moving one
  boat up a fleet, attributed and logged, without touching anyone else.

Every round mutation is an activity-log entry, and revision history (#166)
covers the disaster cases Sailwave handles with file copies.

### Races and finish entry

The Races tab groups physical races under their logical race: "Q3" is a row
with Yellow / Blue / Red chips, each a physical race with its own start
time, finish sheet, and status. Finish entry is the existing per-race sheet,
scoped to the group's roster — the sail-number wizard only offers boats
assigned to that flight, and an out-of-roster number triggers the
wrong-flight warning flow rather than silent acceptance. Per-group
abandonment is just abandoning that physical race; the standings and
reassignment math react per the rules above.

### Standings and publishing

- **Qualifying:** one combined table, every boat, ranked together; each race
  cell tinted with its flight colour (matching the Sailwave-published
  convention scorers and sailors already read: yellow/blue/red cell
  backgrounds, discards in parentheses).
- **Final:** one table per fleet — Gold ranked 1…n, Silver continuing n+1…,
  visibly tiered — with Q columns (flight-tinted) followed by F columns,
  carried-score column for the rank-seed mode, and medal column where
  present.
- **Assignment lists** become a publishable artifact: per-flight rosters
  for the notice board and the boat park, published to the series' `/p/`
  page alongside results, print-friendly (CORK prints the web page for the
  official notice board; so will our users). This mirrors the pursuit-race
  start-schedule idea in horizon.md — the second case of "publishing
  something that isn't results".

## Part 4 — Rollout, scope, and open questions

### Gating and rollout

A new feature key (working name **`flights`**) registered in
`lib/features.ts` with `selfService: false` — operator-managed, like
`competitor-identity`: this is expert machinery for a handful of
championship workspaces, and mis-configuring it produces authoritative-
looking nonsense. Enabled per-workspace via `provision-org` (with the
required row in `docs/workspace-provisioning.md`). **GA — if it ever
becomes self-service at all — waits until after the 2026 ILCA Worlds**
(Dun Laoghaire, Aug/Sept 2026), which are the natural proving ground for
the implementation; until then the audience stays enumerable.

Validation plan, in order:

1. **Fixtures from published history:** rebuild the 2024 ILCA 7 Worlds
   (Adelaide — 152 boats, 3 flights, Gold/Silver/Bronze, medal race, SPI/
   SCP codes) and the 2025 Qingdao editions (including the never-split
   degenerate case) as YAML scoring fixtures from the published Sailwave
   HTML, exact to the point. Add synthetic fixtures for the edge cases: the
   unequal-race equalisation in both modes, serpentine ties in both
   orders, redress promotion, lone-final-race discard protection.
2. **Dry-run a full event replay** (enter day by day, reassign daily,
   split, medal series) against the 2026 SIs once published.

### Scope recommendation for v1

In: continuous-points carry, 2–4 flights, equal-blocks and fixed-top
splits, both code bases + fixed, both equalisation modes, stage-aware
discard caps, serpentine + seeded assignment + manual overrides, the
Flights tab, combined/tiered standings, flight-coloured published pages,
assignment-list publishing, medal series as config (`size` / `raceCount` /
`multiplier`).

Modelled but deferred UI: `net-plus-net` (29er) and `rank-seed` (Topper) —
they cost little in the engine (worth fixture coverage early, since they
stress the same stage machinery) but their authoring UX can wait.

Out (horizon): knockout medal-series brackets (iQFOiL / Formula Kite match
points — not low-point arithmetic); Manage2Sail-style online notice-board
integration; electronic finish ingestion from RaceSense/Vakaros (the
existing CSV finish import is the interim answer).

### Open questions

1. **Naming.** "Flight" for qualifying groups follows Sailwave/race-office
   usage and avoids colliding with our `Fleet`; but the SIs themselves say
   "fleet" for both stages, and the final tiers are "fleets" in every
   sailor's mouth. Current lean: *flight* (Q) and *final fleet* (F) in UI
   copy, `RaceGroup` as the neutral model name. Needs a naming pass before
   the schema lands.
2. **One series or two?** This design commits to one Series holding both
   stages (Sailwave's two-file recommendation exists to work around its
   own model; the ILCA discard profile can't even be expressed across two
   files without the CarriedFwd hack). The cost is that `SubSeries` and
   `qfConfig` are mutually exclusive on a series, at least initially —
   acceptable, but worth confirming nothing at HYC/DBSC wants both.
3. **Completion-order pairing.** The reassignment ranking pairs races "in
   order of completion" per flight, which can diverge from logical-number
   pairing when a flight's race is abandoned and resailed after its next
   race. The model stores logical numbers; is number-pairing (with the
   resail keeping its number, per ILCA 12.8.2) always equivalent in
   practice? Believed yes for reassignment-relevant states; needs a
   worked adversarial example before locking the engine behaviour.
4. **Sailwave import.** Should `sailwave-import` learn to ingest a Q/F
   .blw (flight columns, LE tab, CarriedFwd) — useful for adopting an
   in-progress event or cross-checking against another scorer's file —
   or is CSV seeding-list import enough for v1?
5. **Mid-event config changes.** The 2026 NoR adds a medal series that
   2025 didn't have; SIs get amended mid-event. Which of
   `QualifyingFinalConfig`'s fields are safely editable after racing
   starts (discard caps, medal config) vs frozen (flight count, carry
   mode)?
6. **Scratch only?** All target events are one-design scratch. Proposal:
   v1 requires `scoringMode: 'scratch'` and a single Fleet; flights ×
   handicap systems is uncharted (no known real event) and stays
   unsupported until one exists.
7. **Assignment-list publishing details.** Standalone page under the
   series' `/p/` slug vs a section of the results page; and whether
   unpublished-but-computed next-day flights are visible to workspace
   members only (CORK deliberately withholds assignments from some
   printouts — "the onus is on the competitor to pick up his/her correct
   flag colour").

### Feature-checklist mapping (when implementation starts)

Keyboard shortcuts for the Flights tab actions; help-page section (a new
scorer's guide to running a Q/F event); Vitest + YAML fixtures per the
validation plan; Playwright happy path (seed → race → reassign → split →
final → publish); series-file format bump; public JSON export; CSV
seeding-column import; feature-table row in `docs/workspace-provisioning.md`.

---

## References

- `reference-docs:rrs/Appendix-LE-Expanded-SI-Guide-2013.md` — the final
  (27 Jan 2013) Appendix LE; Addendum C in full, with deltas vs 2006.
- `reference-docs:rrs/Appendix-LE-Expanded-SI-Guide-2006.md` — the 2006
  edition, full SI body.
- `reference-docs:tool-manuals/sailwave/Sailwave-Setting-Up-And-Running-Flights-YNZ.md`,
  `…/Sailwave-Appendix-LE-Slides-Irish-Sailing.md`,
  `…/Sailwave-User-Guide-2025-V16.md` (flights: the User-interface
  toggles, flight-assignment tool, App LE tab, merge/CarriedFwd, unequal-
  races procedures), `reference-docs:tool-manuals/cork/CORK-Results-Management-Manual-V10-Sept2019.md`
  (ch. 5–6: the operational workflow).
- 2026 ILCA 7 Men's Worlds NoR (Amend 3): <https://2026ilca7men.ilca-worlds.org/wp-content/uploads/sites/39/2026/04/NOR-2026-ILCA-7M-IRL-Amend-3.pdf>;
  ILCA 6 Women's: <https://2026ilca6women.ilca-worlds.org/wp-content/uploads/sites/40/2026/04/NOR-2026-ILCA-6W-IRL-Amend-3.pdf>.
- 2025 Worlds SIs (Qingdao, Amend 2 — SI Addendum A is the class-standard
  Q/F format text): <https://onb.ilca.roms.ar/ilcaoly2025/images/onbdocs/SAILING_INSTRUCTIONS_Amend_2.pdf>;
  2024 Adelaide SIs (medal race): <https://onb.ilca.roms.ar/ilca7men2024/images/onbdocs/SAILING_INSTRUCTIONS_Amendment_1.pdf>.
- Published results (Sailwave HTML, fixture sources):
  2025 Worlds <https://2025ilcaolympic.ilca-worlds.org/wp-content/uploads/sites/28/2025/05/ILCA-7M-2025-CHN-Results.html>,
  2024 Adelaide <https://jpvm.org/results/2024/ILCA_7/results.html>.
- IODA fleet scoring: <https://www.optiworld.org/content/ioda-fleet-scoring>;
  2024 Optimist South Americans SI (modern IODA wording, A5.2 renumber):
  <https://2024southamericans.optiworld.org/uploaded_files/Document_96715_20240901222900_en.pdf>.
- 49er 2022 Worlds SI: <https://49er.org/wp-content/uploads/2022/08/49er-SIs-Worlds-2022-Halifax-final-v2.pdf>;
  29er standard SIs: <https://29er.org/assets/29erMedia/pdf/Standard-29er-SIs.pdf>;
  Topper 2023 Worlds NoR (rank-seed carry): <https://www.itcaworld.org/assets/itcamedia/documents/Topper%20NOR%20Worlds%202023v1.2.pdf>;
  Kieler Woche 2026 international-classes SI (floating-discard wording):
  <https://sailing.kieler-woche.de/files/CONTENT/Dokumente/Segelanweisungen/SI%202026/Sailing%20Instructions_International%20classes_Kieler%20Woche%202026.pdf>.
- Appendix LE editions on sailing.org: 2006 `AppLE171006template-[540].doc`,
  2009 `AppendixLEtemplate-[6945].doc`, 2013 `AppendixLEtemplate-[14241].doc`
  (all under `https://sailing.org/tools/documents/`); RRC submission 221-19
  (the 2021 Appendix L restructure):
  <https://www.sailing.org/tools/documents/22119RacingRulesofSailingAppendixL-[25516].pdf>;
  current SI Guide (March 2025, no Q/F addendum):
  <https://media.sailing.org/sailing/wp-content/uploads/2025/03/26022916/SI-Guide-v2025.docx>.
- US Sailing, *Guidance on Scoring under Appendix A* (RDG across a split):
  <https://www.ussailing.org/wp-content/uploads/2018/01/AppA-Guidance-V4-0.pdf>.
- Manage2Sail ORM scorer manual (the main non-Sailwave implementation):
  <https://www.acvl.ch/wp-content/uploads/2022/01/ORM_scorer-profile_v4.pdf>.
