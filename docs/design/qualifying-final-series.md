# Qualifying and Final Series

Design for scoring **split-fleet** championship events: a large entry is
divided into qualifying fleets that are reshuffled by rank after each day's
racing, then locked into Gold / Silver / Bronze fleets for a final series —
the RRS "Appendix LE Addendum C" format used by ILCA, Optimist, 420,
29er/49er and Topper world championships, and by big multi-class regattas
like Kieler Woche. Nothing is implemented yet; this document is the primer,
the data-model design, the UX outline, and the open questions.

Sources: the ISAF Appendix LE templates
(`reference-docs:rrs/Appendix-LE-Expanded-SI-Guide-2006.md`,
`reference-docs:rrs/Appendix-LE-Expanded-SI-Guide-2013.md`), the 2024 ILCA 7
Worlds SIs (`reference-docs:events/ilca7-worlds-2024/SI-Amendment-1.md` —
the fixture-source event), the Sailwave flights guides
(`reference-docs:tool-manuals/sailwave/Sailwave-Setting-Up-And-Running-Flights-YNZ.md`,
`reference-docs:tool-manuals/sailwave/Sailwave-Appendix-LE-Slides-Irish-Sailing.md`,
the User Guide, and the CORK results-management manual), and the published
NoRs/SIs of recent ILCA, IODA, 49er, 29er, 420, Topper and Kieler Woche
championships (URLs in References).

## Glossary

The SIs' own vocabulary, which the app should follow. The SIs say "fleet"
throughout — they never say "flight" (that's Sailwave's word for a
qualifying fleet; we avoid it in the app).

- **Split-fleet series** — our general name for a series using this format
  (from the SIs' "the event will be split into 3 fleets", "while racing in
  split fleets").
- **Event structure** — the *event* consists of an **opening series** and,
  usually conditionally, a **medal race** (or medal series of two races).
  The opening series is divided into a **qualifying series** and a **final
  series**.
- **Qualifying series** — races sailed in qualifying fleets, reassigned
  between rounds. A *qualifying race* (Q1…Qn) is complete only when every
  qualifying fleet has sailed it; the *qualifying ranking* is the combined
  ranking of all boats across fleets.
- **Qualifying fleet** — one of the groups racing together during
  qualifying, named by colour: Yellow, Blue, Red, Green.
- **Final series** — races sailed in final fleets (F1…Fn per fleet).
- **Final fleet** — the tiers boats are locked into for the final series:
  Gold, Silver, Bronze, Emerald. A boat's final fleet dominates the event
  ranking: every Gold boat ranks above every Silver boat.
- **Medal fleet / medal race** — the top boats (usually ten) after the
  opening series, sailing one or two extra races that usually score double
  points and cannot be discarded. Non-medal boats may sail a companion
  "last race" scored from below the medal fleet (first finisher = 11 points
  when the medal fleet is ten boats).
- **Round** — one assignment of competitors to fleets, covering a span of
  races: the initial seeding, each qualifying reassignment, the final-fleet
  split, and medal-fleet selection are all rounds. Not "day": a round's
  fleets can race across multiple days in the degenerate catch-up cases.
- **Seeding** — the initial pre-racing assignment (by a class ranking list,
  nationality-spread, or sail-number order).
- **Event ranking** — the overall result: medal fleet first, then Gold,
  Silver, Bronze blocks, points within each.
- **Logical race vs physical race** — internal modelling terms (probably
  not user-visible): qualifying race Q3 is one *logical* race made up of
  three *physical* races, one per qualifying fleet, each with its own
  start, finish sheet, and completion status.

---

## Part 1 — Primer

### Why events split the fleet

A start line can handle roughly 40–80 boats. A world championship attracts
100–300. So the entry is divided into fleets that race separately —
smaller, fairer starts, and manageable launching ashore. But a simple
static split would crown group winners, not a champion: boats in different
groups never meet. The qualifying/final format solves this in two phases:

1. **Qualifying series:** boats race in qualifying fleets of roughly equal
   size **and ability**. After each day, fleets are **reshuffled by current
   overall rank** so that the groups stay balanced — every fleet contains a
   spread of leaders and backmarkers, and everyone eventually races
   comparable opposition.
2. **Final series:** once enough qualifying races are sailed, the overall
   ranking is frozen and boats are assigned **once** to the final fleets,
   filled by rank in blocks. Each fleet then races only among itself, and a
   boat's final fleet is a hard ceiling on her event ranking.

Some events add the medal race on top; the 2024 ILCA 7 Worlds shape was: 10
opening-series races over 5 days, then on the last day one umpired medal
race for the top ten plus one companion opening-series race for everyone
else.

### Where the rules live — the strange story of Appendix LE

The RRS proper contain **none of this**. Appendix A knows nothing about
split fleets; the entire mechanism is sailing-instructions material. The
canonical wording came from **Appendix LE — Expanded Sailing Instructions
Guide**, an ISAF web-only expansion of the in-book Appendix L (SI Guide),
whose **Addendum C — "Qualifying Series and Final Series; Opening Series
and Medal Race"** was the template every class copied.

The publication history explains why a .doc dated 2006 still circulates as
if canonical:

- Editions were published for **2005–2008** (version 17 Oct 2006 — our
  template copy), **2009–2012** (26 Feb 2009), and **2013–2016** (27 Jan
  2013). All three are still downloadable from sailing.org's old document
  store.
- **No 2017–2020 edition was ever published** (the Sailwave user guide
  footnotes this, mystified).
- The 2021 rules restructure (RRC submission 221-19) removed Appendices K
  and L from the rulebook entirely, replacing them with online NoR/SI
  guides ("Appendix KG"/"LG"). **The successor guides dropped the LE
  addenda** — the current March 2025 SI Guide contains only a supplied-
  boats addendum. RRS 2025–2028 has no Appendix L at all.

So the **27 January 2013 edition is the final official text**, and nothing
has replaced it. The format lives on as de-facto class boilerplate: classes
maintain the 2006/2013 Addendum C wording themselves, hand-patching rule
numbers as the RRS shift under it (Addendum C's "rule A4.2 is changed…" is
rule **A5.2** since 2021; the old A9 long-series rule is gone and A9 is now
redress guidance; Addendum C's "rule 5 or 69" carve-out is "rule 6 or 69"
today). ILCA's SIs carry a standardised "Addendum A — Qualifying & Final
Series Formats" descended from it; IODA's championship SIs are nearly
verbatim Addendum C. When implementing, the 2013 Addendum C is the
reference wording, cross-checked against a current class SI for rule-number
drift.

### The canonical mechanics (Addendum C walkthrough)

**Initial seeding.** A seeding committee assigns boats to qualifying fleets
"of, as nearly as possible, equal size and ability", posted before racing
(ILCA: by 2000 on the last registration day). In practice the sort key is a
class ranking list, or nationality-then-sail-number so compatriots are
spread across the fleets, or plain sail number.

**Reassignment after each day.** After each day of qualifying racing —
except if only the first race of the event is completed — boats are
redistributed by current series rank, working down the fleet list and back
up again so each fleet gets an equal share of every band of the ranking.
The ILCA table for three fleets (rank → fleet): 1 Yellow, 2 Blue, 3 Red,
4 Red, 5 Blue, 6 Yellow, then 7 Yellow, 8 Blue, 9 Red, and so on; the 2013
LE table for four: Y B R G | G R B Y | Y B R G …. Two subtleties:

- *Tied ranks:* LE says tied boats enter the pattern "in the order of
  fleets in instruction 7.2" (i.e. deliberately scattered); the 2024 IODA
  South Americans instead break residual ties by the registration sort
  order after applying RRS A8. Both variants exist in the wild.
- *The snapshot:* assignments are computed from "the ranking available at
  2100 [ILCA: 2000] that day **regardless of protests or requests for
  redress not yet decided**". The assignment is a snapshot, deliberately
  insulated from later score changes — a crucial property for the data
  model.

**Unequal race counts.** If fleets get out of step (one fleet's race
abandoned), the reassignment ranking is computed only over "those races,
numbered in order of completion, **completed by all fleets**". The lagging
fleets race first the next day until counts equalise, and "all boats will
thereafter race in the new fleets" — so a catch-up race is sailed in the
*old* round's fleets while later races that day use the *new* round's. At
the end of qualifying, leftovers are equalised: LE/IODA **exclude each
boat's most-recent extra scores** so everyone has the same number of race
scores; ILCA's variant instead **abandons and cancels the extra races
outright**. Either way, a qualifying race only ever counts "when all
fleets have completed that race".

**The split.** Final fleets mirror the qualifying fleet count (3 → Gold,
Silver, Bronze), sized "as nearly as possible equal, but so that the
Silver fleet is not larger than the Gold fleet", filled by qualifying rank
in blocks. Some classes fix the top-fleet size instead (49er 2022: Gold =
top 25; 29er standard SIs: Gold = 45). Once made, the split is frozen:
"any recalculation of qualifying-series ranking … will not affect the
assignments **except that a redress decision may promote a boat to a
higher fleet**" — promotion only, nobody is demoted to make room, fleets
may end up unequal.

**Event ranking.** Fleet tier dominates: Gold boats rank above Silver
boats above Bronze, points second — with the carve-out that a boat
disqualified from a final race under RRS 6 (was 5) or 69 loses the tier
guarantee, and (IODA variant) a boat scored DNE in *all* races ranks last
overall.

### Scoring mechanics that differ from a normal series

**Score-code points ("based on the largest fleet").** RRS A5.2 scores DNC
& friends as "entries in the series + 1" — meaningless when each race is
sailed by a 47-boat fleet out of 141 entries. So the SIs change A5.2:

- *Qualifying:* codes score **the number of boats assigned to the largest
  qualifying fleet, plus one** (assigned, not starters — DNC boats stay in
  the divisor). Verified: 2025 ILCA 7 Worlds, 138 entries in 3 fleets of
  46 → every BFD/DNC/RET/UFD scored 47.
- *Final:* codes score **the boat's own fleet size plus one** (ILCA,
  Santander); a Silver DNC costs Silver-fleet points, not entry-list
  points.

**Places are per fleet.** Each fleet's race produces its own 1, 2, 3… — a
qualifying race day yields three 1sts, three 2nds. (Sailwave calls this
"allow multiple 1sts"; for our engine, places are simply computed within
the physical race's fleet.)

**One continuous points line — usually.** In the dominant model (ILCA,
IODA, 420, 49er, Kieler Woche, Santander) qualifying scores **carry
forward as points** into one series total; Q1…Qn and F1…Fn are columns of
a single line. But three other carry models exist:

| Carry model | Events | Mechanics |
|---|---|---|
| **Continuous points** | ILCA, IODA, 420, 49er, KiWo | One total across Q+F; discards float across the boundary (KiWo makes this explicit: a qualifying discard "may be substituted by a worse score in the final series") |
| **Net + net** | 29er | Q and F are separately-discarded series; championship score = Q net + F net; F ties broken on F scores only |
| **Rank as seed** | Topper | Finals restart from a carried, non-discardable score equal to the boat's qualifying **rank** |
| **Knockout bracket** | iQFOiL, Formula Kite | Opening series seeds quarter/semi/grand finals scored on match points — not low-point arithmetic at all (out of scope; see horizon) |

**Stage-aware discard profiles.** The famous "special ILCA discard
profile" (2025 Worlds SI 18.2, 2026 NoR 15.2): 1 discard from 4 races, 2
from 10 — but **at most one discard may fall on a final-series race**, a
lone completed final race may not be discarded at all, and medal-race
scores are never discardable (and don't advance the race count for discard
thresholds). Note what this is *not*: the folk description "a discard
earned in qualifying can't be used in the finals" is wrong — discards
float across the whole line, subject to those per-stage caps.

**The medal race and its companion race.** Where a medal race exists
(2024 ILCA SI 18.6): the medal boat's score is "double the number of
points specified in RRS Appendix A4", non-discardable, and the medal race
doesn't trigger additional discards. The non-medal boats' extra
opening-series race has its own scoring quirk (2024 SI 18.3.4):

> For those competitors not assigned to the Medal race and scheduled to an
> additional Opening series race as detailed in SI 7.4, the first finisher
> will be scored 11 points, second 12 points and so on.

That is: the companion race's points start immediately below the ten medal
boats — a race whose first place is worth 11 points. (ZW models this with
a "First As" race attribute; our model needs an equivalent per-race points
offset.)

**Redress.** Three interlocking rules: reassignment/split snapshots ignore
pending protests; a later redress decision may promote (only promote) a
boat across the split; and RDG averages need care — US Sailing's Appendix
A guidance warns the protest committee must "specify exactly which races
to include in the 'average points' calculation" when a series spans a
split. Our RDG model (method + explicit include/exclude race sets) already
carries exactly this.

**Ties.** Standard A8 within a series/fleet; 49er breaks final-series ties
on final-series scores only; the 2013 LE medal-race tie-break (medal score
first, then A8 over the opening series) applies where a medal race exists.

### The 2026 ILCA Worlds — the concrete target

The **2026 ILCA 7 Men's Worlds run 23–30 August 2026 at Dun Laoghaire**
(National YC / Royal St George YC; entry cap 160, ~141 entered from 45
nations → 3 qualifying fleets), and the **ILCA 6 Women's Worlds follow
there 5–12 September** (~100 entries → 2 fleets). Format per the NoRs: 12
races over 6 days, two per day; qualifying ends once at least 4 races are
complete at a day boundary (days 1–3 nominally); then
Gold/Silver(/Bronze); **new for 2026, a two-race medal series** for the
top 10 on the last day, with one more opening-series race for everyone
else (expect the companion-race points offset above; confirm from the 2026
SIs). Codes: largest qualifying fleet + 1 in qualifying, own fleet + 1 in
finals; discards 1 from 3 (NoR: 3–9 races), 2 from 10, max one from
finals, medal races excluded. Starts and OCS/BFD calls via Vakaros
RaceSense (electronic identification replaces visual for 30.3/30.4).
Races are named **Q1…Qn / F1…Fn** officially. The 2025 Qingdao edition is
a valuable degenerate fixture: weather meant **neither class ever split**
— the qualifying ranking became the official result under the "if no
final race is completed" fallback.

The 2026 SIs (including exact medal-series scoring) publish on the event
notice board before registration; the format sections above are stable
class-standard wording, but the medal-series points multiplier and
companion-race offset need confirming from the SIs when they appear.

### How Sailwave does it — and where it hurts

Sailwave is the de-facto scorer for these events (recent ILCA Worlds,
Youth Worlds, Masters, U21s, and CORK's Optimist events all publish
Sailwave HTML). Its vocabulary differs from the SIs': Sailwave reserves
**"flight"** for a qualifying fleet (a per-race competitor attribute
populated by its flight-assignment tool) and "fleet" for the final-series
tiers. The Q-series is scored "as one group" with multiple 1sts and a
raised code base; the F-series is scored "groups separately" over a static
Fleet field. But the workflow is a manual high-wire act, documented in
loving detail by the CORK manual (whose "Senior Scorer" job definition is
literally the ability to run a qualifying/final split):

- The recommended shape is **two separate files** (Q and F), bridged by a
  merge step that writes each boat's qualifying points/rank into a
  non-discardable "carried forward" field — except ILCA's floating-discard
  profile *requires* one file, a special "Appendix LE tab" (first final
  race number, F-discard caps, finals-only tie-break), and a **"do not
  recalculate qualifying race points" freeze checkbox** once finals begin.
- The assignment tool applies to *whatever order the grid is currently
  sorted in* — forget to re-score first and the assignments are silently
  wrong. Entering the wrong race-number range overwrites assignments
  already sailed. There is no undo anywhere; the mitigation is ritual file
  copies.
- The unequal-race-count case is a documented **seven-step manual dance**
  (clear the completed race's results, re-score, re-assign, re-publish,
  re-enter the cleared finish sheets), flagged "EXTRA EXTRA careful" in
  the manual; the community forum calls the workarounds "very error
  prone".
- A jury reopening a qualifying race after the split triggers CORK's
  multi-step unwind: unfreeze, flip code bases back, fix, re-score,
  re-freeze, restore code bases.
- Wrong-fleet finishers are expected ("quite likely"); detection is a
  heuristic — "a tell-tale sign is suddenly a competitor gets a
  first-place finish in their supposed new flight".

Every one of these pain points is an artifact of bolting per-race group
state onto a static-fleet single-user desktop model. A server-native
implementation with first-class rounds, snapshots, and revision history
(#166) can make the same operations safe: that is the design goal.

The wider landscape, for calibration: **Manage2Sail's ORM** scores
qualifying/final events natively (fleet split methods, per-fleet starting
lists; used for World Sailing Youth Worlds results and ILCA U21
Europeans), the Dutch **ZW** tool has arguably more automated group
assignment, and **St Pete Scorer** is IODA's co-recommendation alongside
Sailwave. Almost nothing else in the market — HalSail, ORC Scorer, Yacht
Scoring, Regatta Network, Clubspot — has real split-fleet machinery.
Supporting this format well puts Sail Scoring in a club of about four.

### Contrast: IODAI's national majors are *not* this format

Relevant to our Irish Optimist users: the IODAI Major Event SIs
(`reference-docs:events/iodai-2025/Major-Event-SIs-v1.0.md`) use
**static** Gold/Silver/Bronze fleets within Senior/Junior divisions,
pre-assigned by IODAI fleet-qualification criteria — no qualifying series,
no reassignment, plus a stand-down rule that scores rested groups average
points mid-series. Today that's handled with our existing
fleets/subdivisions. The split-fleet feature is for the
rotating-assignment championship format; the two must not be conflated in
the UI.

---

## Part 2 — Data model

### The shape of the problem

Walk the 2024 Adelaide event through Sail Scoring concepts:

- "Day 1 Yellow" is a set of ~51 boats that race together, get places 1…51
  within themselves, and can have a race abandoned independently of Blue
  and Red. That is exactly what a `Fleet` already is: a named, stored
  membership that races and scores together (`Competitor.fleetIds`,
  `RaceStart.fleetIds`). **We represent each round's fleets as `Fleet`
  rows** — "Yellow (day 1)", "Gold" — created by the round, scratch-scored.
  A competitor accumulates one fleet membership per round, which the
  existing multi-fleet mechanics carry naturally.
- Because fleet membership is *stored*, not computed, the SIs' snapshot
  semantics fall out structurally: rescoring a protest can never reshuffle
  a fleet that already exists. (This is the property Sailwave enforces
  with a freeze checkbox.)
- Each scheduled qualifying race is sailed once per fleet: **one physical
  `Race` per (fleet × scheduled race)**, each with its own start, finish
  sheet, abandonment, and possibly its own day (catch-up races). The
  existing finish-sheet model, per-race abandonment, and
  protest-time-limit machinery apply unchanged; scoping a race to a
  single fleet also scopes finish entry to that fleet's roster — a Blue
  boat cannot be given a finish from the Yellow sheet.
- What no existing concept expresses is the relationships *between* those
  pieces: which fleets belong to which round and stage, which physical
  races make up qualifying race Q3, and the event-level scoring regime
  (stage code bases, the event-wide discard pool, carried points, tiered
  ranking). That connective tissue is the new state.

Three new ideas carry it:

1. **Rounds.** Initial seeding, each qualifying reassignment, the
   final-fleet split, and medal-fleet selection are all the same act:
   "create fleets and assign every competitor to one, for stage races
   ≥ N, based on a stated ranking". One entity — the assignment round —
   covers all four, giving a uniform audit trail and a uniform publishing
   artifact (the posted assignment list).
2. **Logical qualifying races.** Qualifying race Q3 is one logical race
   "filled up" by three physical races, one per fleet of the covering
   round — and it is **not valid until full**: it contributes nothing to
   any ranking until every fleet has completed it (2024 ILCA SI 7.7).
   This concept is qualifying-only: final and medal fleets race
   independently ("different final series fleets need not complete the
   same number of final races"), so their races need no cross-fleet
   pairing.
3. **Frozen computed state.** A round's assignments are *computed once,
   then stored* — the first state in Sail Scoring that is derived from
   scores but must **not** be recomputed when scores change. Everything
   downstream honours the stored assignment; a redress promotion is an
   explicit, attributed override, not a recompute.

### New types (sketch)

```ts
export type SeriesStage = 'qualifying' | 'final' | 'medal';

/** One assignment event: fleets created and competitors assigned, covering
 *  `stage` races numbered `fromStageRace` onward, until superseded by a
 *  later round of the same stage. Snapshot semantics: `basis` records what
 *  it was computed from; the resulting fleet memberships are authoritative
 *  regardless of later rescoring. */
export interface AssignmentRound {
  id: string;
  seriesId: string;
  stage: SeriesStage;
  fromStageRace: number;              // e.g. finals: 1; day-3 round: 5
  /** The round's fleets, in SI order — qualifying: the LE 7.2 order that
   *  the reassignment pattern and its tie rule use; final: tier order
   *  (Gold first), which is ranking dominance. */
  fleetIds: string[];
  method: 'seeded' | 'rank-pattern' | 'split' | 'manual';
  basis?: {
    throughStageRace: number;         // ranking over races 1..N
    capturedAt: number;               // the 2000/2100 snapshot time
  };
  /** Post-hoc corrections (late entry, RC decision, redress promotion):
   *  competitorId → fleetId, layered over the fleets' memberships and
   *  individually attributable. */
  overrides?: Record<string, string>;
  publishedAt?: number;               // assignment list published
  version?: number;
}

/** Series-level format configuration. Present iff the series is a
 *  split-fleet series. */
export interface QualifyingFinalConfig {
  carry: 'points' | 'net-plus-net' | 'rank-seed';
  /** Final-fleet sizing: LE-style near-equal blocks (Gold ≥ Silver ≥ …),
   *  or a fixed top-fleet size (49er/29er). */
  split: { kind: 'equal-blocks' } | { kind: 'fixed-top'; topSize: number };
  codeBasis: {
    qualifying: 'largest-fleet' | 'fixed';   // fixed: Sailwave's safe option
    fixedPoints?: number;
    final: 'own-fleet' | 'largest-fleet';
  };
  /** End-of-qualifying equalisation when fleets completed unequal counts:
   *  exclude each boat's most-recent extra scores (LE/IODA) or abandon the
   *  extra races outright (ILCA). */
  equalization: 'exclude-extra-scores' | 'abandon-extra-races';
  /** Stage caps layered on Series.discardThresholds: max discards that may
   *  fall on final races (ILCA: 1), and a lone completed final race is
   *  undiscardable. Medal races are never discardable and don't count
   *  toward discard thresholds. */
  maxFinalDiscards?: number;
  protectLoneFinalRace?: boolean;
  reassignmentTieOrder: 'fleet-order' | 'a8-then-entry-order';
  /** Medal race(s): fleet size, race count, points multiplier, and whether
   *  the non-medal companion race starts scoring below the medal fleet
   *  (2024 ILCA SI 18.3.4: first finisher = 11 points). */
  medal?: {
    size: number;
    raceCount: number;
    multiplier: number;
    companionRaceOffset?: boolean;
  };
}
```

`Race` gains optional fields (absent on standard series):

```ts
stage?: SeriesStage;
stageRaceNumber?: number;   // Q3 → ('qualifying', 3); final/medal races are
                            // numbered per fleet for display but need no
                            // cross-fleet pairing
```

`Series` gains `qfConfig?: QualifyingFinalConfig`. `Fleet` needs no new
fields for v1: a fleet's stage, round, and order all live on the round
that created it. The logical qualifying race Qk is derived state: the set
of physical races with `stageRaceNumber == k` across the covering round's
fleets, **valid** when there is one completed physical race per fleet.
Because rounds are keyed by logical race number, not date, a catch-up race
sailed a day late automatically uses the round it was scheduled under —
the LE 7.3(c) behaviour falls out with no special case.

### Scoring engine changes

The engine (`lib/scoring.ts`) gains a split-fleet path alongside fleet
standings:

- **Per-fleet places** come from the existing within-fleet ranking — each
  physical race is scoped to one fleet, so "multiple 1sts" needs no new
  mechanism.
- **Code points** from `codeBasis`: largest-fleet-assigned-size + 1 during
  qualifying — a *stage-wide* constant derived from the covering round's
  fleets (assigned size, DNC boats included), not each fleet's own size —
  own-fleet size + 1 in finals, or the fixed value.
- **Logical-race validity.** Qualifying standings aggregate one column per
  logical race, and only valid (complete-across-all-fleets) logical races
  contribute; end-of-stage leftovers are handled per `equalization` — note
  the LE/IODA mode is *per-boat* score exclusion (a new exclusion reason,
  distinct from discards and from `RaceFleetExclusion`), while the ILCA
  mode marks the physical races abandoned.
- **Stage-aware discards.** `getDiscardCount` unchanged for the threshold;
  discard *selection* honours `maxFinalDiscards`, `protectLoneFinalRace`,
  and medal exclusions. Medal races are excluded from the race count that
  drives thresholds (2024 ILCA wording).
- **Carried scores.** `carry: 'points'` is a no-op (one continuous line);
  `net-plus-net` computes per-stage nets and sums; `rank-seed` synthesises
  a non-discardable carried score equal to qualifying rank (Sailwave's
  CarriedFwd field, but computed, not hand-merged).
- **Medal scoring:** points × multiplier, never discarded; the companion
  race scores from `medal.size + 1` when `companionRaceOffset` is set (a
  per-race first-place offset, like ZW's "First As").
- **Event ranking.** Overall order: medal fleet first (where the stage
  exists), then Gold block, Silver block, … — each block internally by net
  points + A8 — with the RRS 6/69 carve-out surfaced as a per-boat flag
  rather than automated (it needs a jury decision anyway).
- **The reassignment pattern** is a pure function (`lib/split-fleets.ts`):
  `(rankedCompetitorIds, fleetCount, tieOrder) → assignments`, walking the
  ranking down the fleet list and back (1 Yellow, 2 Blue, 3 Red, 4 Red, 5
  Blue, 6 Yellow, …), plus the seeded initial orders (seed rank /
  nationality-spread / sail number). Pure, fixture-tested, and reused by
  the reassignment preview UI.
- **Wrong-fleet finishes.** Finish entry is fleet-scoped, so the Sailwave
  failure mode mostly can't occur at the desk; for the on-water case (a
  boat sails with the wrong fleet), the SI-default outcome is DNC in her
  own fleet's race and no score in the gate-crashed one. The scorer
  records what the sheet says via an explicit affordance ("finished with
  Blue — scores DNC in Yellow"), surfaced as a `ScoringRejection` until
  resolved (accept the DNC, or record an RC-sanctioned assignment
  override).

### Frozen state, and what it does to fixtures

Round assignments are the first **computed-then-frozen** state in Sail
Scoring: derived from a ranking at a moment, then stored and never safely
recomputable. Two consequences:

- The scoring engine must treat rounds as *input*, never output. Only the
  explicit round-creating actions (and their previews) run the assignment
  computation; everything else — including full recomputes after protest
  decisions, file re-imports, and revision restores — reads the stored
  assignments.
- **Test fixtures must be able to express a sequence of events, not just
  input and expected output.** Today's YAML scoring fixtures are (setup,
  finishes) → expected standings. A split-fleet fixture needs steps:
  seed → enter day-1 finishes → reassign (assert the computed assignment)
  → enter day-2 finishes → … → split → … → expected event ranking. The
  fixture format needs an ordered-steps form for these, with assertions
  allowed at each step — including replaying a protest decision *after* a
  round to assert the round doesn't move (and that a redress promotion is
  an override, not a recompute).

### Persistence, files, exports

- Fleets reuse the existing `fleets` table and mechanics. New:
  `assignment_rounds` (fleet ids + assignments/overrides as JSONB), two
  nullable columns on `races`, `qf_config` JSONB on `series` — mirrored in
  `lib/db/schema/`, validation in `lib/validation/`, and the repositories.
- **Series-file format bump**: rounds, race stage fields, and `qfConfig`
  must round-trip through `lib/series-file.ts` (fleets already do);
  omitting any of it is silent data loss.
- **Public JSON export** carries the same (fleet assignments are public
  information — they're on every published results page); CSV import
  should accept a seeding column (Sailwave-compatible ingest of an OA
  seeding list).

## Part 3 — UX (high level)

### Series setup

Format is chosen at series creation (and immutable once any race has
finishes, like `scoringMode`): a "Qualifying + final series" option, gated
(see Part 4), asking only: number of qualifying fleets (offering the
standard colour sets — with the race-officer folklore rule that colour
names must not share an initial letter), final fleet names (defaulting
Gold/Silver/Bronze to match the count), and the carry/discard preset.
Presets matter more than knobs here: "ILCA World/European Championship",
"IODA Championship", "Custom" — each filling `QualifyingFinalConfig` with
the class-standard values, the way NHC profiles default to SWNHC2015.

### The Split Fleets view

A split-fleet series gets a **Split Fleets** tab: a guided workflow view
that walks the scorer through the event's ceremony as an automation layer
over the standard entities — each phase (qualifying → final → medal) a
visually distinct section, each round a card carrying its assignment
provenance, each step a preview-then-commit action. The full flow design
lives in
[`docs/design/ux/flows/split-fleets.md`](ux/flows/split-fleets.md); in
outline, the round cards show method, basis ("from ranking after Q4,
captured 20:00"), per-fleet rosters, overrides, and published state, with
these actions:

- **Seed initial fleets** — sort key choice (seeding column from CSV,
  nationality-spread, sail number), preview, save as round 1.
- **Reassign for tomorrow** — the rank-pattern reassignment over current
  standings, with a side-by-side preview (who moves where) before
  committing; the snapshot basis is recorded automatically. The tool
  proposes `fromStageRace` = next unsailed logical race — never a
  hand-typed race range, eliminating Sailwave's overwrite-sailed-
  assignments failure mode.
- **Split into final fleets** — end-of-qualifying wizard: shows the
  equalised qualifying ranking (with any per-boat excluded scores), the
  proposed Gold/Silver/Bronze blocks per the split rule, tie diagnostics,
  and creates the final-stage round plus the F-race skeletons.
- **Promote (redress)** — a targeted override on the final round moving
  one boat up a fleet, attributed and logged, without touching anyone
  else.

Every round mutation is an activity-log entry, and revision history
(#166) covers the disaster cases Sailwave handles with file copies.

### Races and finish entry

The Races tab groups physical races under their logical race: "Q3" is a
row with Yellow / Blue / Red chips, each a physical race with its own
start time, finish sheet, and status — with a "not yet valid" marker on a
logical race some fleet hasn't completed. Finish entry is the existing
per-race sheet, scoped to the fleet's roster — the sail-number wizard only
offers boats assigned to that fleet, and an out-of-roster number triggers
the wrong-fleet flow rather than silent acceptance. Per-fleet abandonment
is just abandoning that physical race; the standings and reassignment
math react per the rules above.

### Standings and publishing

- **Qualifying:** one combined table, every boat, ranked together; each
  race cell tinted with its fleet colour (matching the Sailwave-published
  convention scorers and sailors already read: yellow/blue/red cell
  backgrounds, discards in parentheses).
- **Final:** one table per fleet — Gold ranked 1…n, Silver continuing
  n+1…, visibly tiered — with Q columns (fleet-tinted) followed by F
  columns, carried-score column for the rank-seed mode, and medal column
  where present.
- **Assignment lists** become a publishable artifact: per-fleet rosters
  for the notice board and the boat park, published to the series' `/p/`
  page alongside results, print-friendly (CORK prints the web page for
  the official notice board; so will our users). This mirrors the
  pursuit-race start-schedule idea in horizon.md — the second case of
  "publishing something that isn't results".

## Part 4 — Rollout, scope, and open questions

### Gating and rollout

A new feature key (working name **`split-fleets`**) registered in
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
   (Adelaide — 152 boats, 3 qualifying fleets, Gold/Silver/Bronze, medal
   race + companion race, SPI/SCP codes; SIs at
   `reference-docs:events/ilca7-worlds-2024/SI-Amendment-1.md`) and the
   2025 Qingdao editions (including the never-split degenerate case) as
   scoring fixtures from the published Sailwave HTML, exact to the point —
   using the new ordered-steps fixture form so the day-by-day rounds are
   part of what's asserted. Add synthetic fixtures for the edge cases: the
   unequal-race equalisation in both modes, reassignment ties in both
   orders, redress promotion, lone-final-race discard protection.
2. **Dry-run a full event replay** (enter day by day, reassign daily,
   split, medal series) against the 2026 SIs once published.

### Scope recommendation for v1

In: continuous-points carry, 2–4 qualifying fleets, equal-blocks and
fixed-top splits, both code bases + fixed, both equalisation modes,
stage-aware discard caps, rank-pattern + seeded assignment + manual
overrides, the Split Fleets view, combined/tiered standings, fleet-coloured
published pages, assignment-list publishing, medal race as config
(`size` / `raceCount` / `multiplier` / companion-race offset).

Modelled but deferred UI: `net-plus-net` (29er) and `rank-seed` (Topper)
— they cost little in the engine (worth fixture coverage early, since
they stress the same stage machinery) but their authoring UX can wait.

Out (horizon): knockout medal-series brackets (iQFOiL / Formula Kite
match points — not low-point arithmetic); Manage2Sail-style online
notice-board integration; electronic finish ingestion from
RaceSense/Vakaros (the existing CSV finish import is the interim answer).

### Open questions

1. **Fleet-surface interactions.** Reusing `Fleet` means a worlds series
   carries ~12–15 fleet rows ("Yellow (day 1)" … "Gold"). Every
   fleet-scoped surface needs a look: fleet pickers and the Competitors
   tab (round fleets shouldn't read as ordinary memberships), per-fleet
   published pages (we publish per logical structure, not per round
   fleet), `ftpPaths`, publishing groups, prize clauses referencing
   `fleetId`. Likely answer: fleets owned by a round are marked by that
   ownership and filtered from the general-purpose surfaces — but this
   needs a full pass.
2. **Fleet naming for rounds.** "Yellow (day 1)" vs "Q1–2 Yellow" vs
   colour-only names disambiguated by round context. Display wants
   "Yellow"; the fleet list wants uniqueness. Decide alongside question 1.
3. **One series or two?** This design commits to one Series holding both
   stages (Sailwave's two-file recommendation exists to work around its
   own model; the ILCA discard profile can't even be expressed across two
   files without the CarriedFwd hack). The cost is that `SubSeries` and
   `qfConfig` are mutually exclusive on a series, at least initially —
   acceptable, but worth confirming nothing at HYC/DBSC wants both.
4. **Completion-order pairing.** The reassignment ranking pairs races "in
   order of completion" per fleet, which can diverge from logical-number
   pairing when a fleet's race is abandoned and resailed after its next
   race. The model stores logical numbers; is number-pairing (with the
   resail keeping its number, per ILCA 12.8.2) always equivalent in
   practice? Believed yes for reassignment-relevant states; needs a
   worked adversarial example before locking the engine behaviour.
5. **Sailwave import.** Should `sailwave-import` learn to ingest a
   qualifying/final .blw (flight columns, LE tab, CarriedFwd) — useful
   for adopting an in-progress event or cross-checking against another
   scorer's file — or is CSV seeding-list import enough for v1?
6. **Mid-event config changes.** The 2026 NoR adds a medal series that
   2025 didn't have; SIs get amended mid-event. Which of
   `QualifyingFinalConfig`'s fields are safely editable after racing
   starts (discard caps, medal config) vs frozen (fleet count, carry
   mode)?
7. **Scratch only?** All target events are one-design scratch. Proposal:
   v1 requires `scoringMode: 'scratch'`; split fleets × handicap systems
   is uncharted (no known real event) and stays unsupported until one
   exists.
8. **Assignment-list publishing details.** Standalone page under the
   series' `/p/` slug vs a section of the results page; and whether
   unpublished-but-computed next-day assignments are visible to workspace
   members only (CORK deliberately withholds assignments from some
   printouts — "the onus is on the competitor to pick up his/her correct
   flag colour").

### Feature-checklist mapping (when implementation starts)

Keyboard shortcuts for the Split Fleets view's actions; help-page section (a new
scorer's guide to running a split-fleet event); Vitest + ordered-steps
YAML fixtures per the validation plan; Playwright happy path (seed → race
→ reassign → split → final → publish); series-file format bump; public
JSON export; CSV seeding-column import; feature-table row in
`docs/workspace-provisioning.md`.

---

## References

- `reference-docs:rrs/Appendix-LE-Expanded-SI-Guide-2013.md` — the final
  (27 Jan 2013) Appendix LE; Addendum C in full, with deltas vs 2006.
- `reference-docs:rrs/Appendix-LE-Expanded-SI-Guide-2006.md` — the 2006
  edition, full SI body.
- `reference-docs:events/ilca7-worlds-2024/SI-Amendment-1.md` — the 2024
  ILCA 7 Worlds SIs (fixture-source event; Addendum A = the class-standard
  Qualifying & Final Series Formats).
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
