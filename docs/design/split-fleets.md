# Qualifying and Final Series

Design for scoring **split-fleet** championship events: a large entry is
divided into qualifying fleets that are reassigned by series rank after each day's
racing, then locked into Gold / Silver / Bronze fleets for a final series —
the RRS "Appendix LE Addendum C" format used by ILCA, Optimist, 420,
29er/49er and Topper world championships, and by big multi-class regattas
like Kieler Woche. This document is the primer, the data-model design, the
UX outline, and the open questions; the engine and the Split Fleets view
are implemented (#328, #346) behind the `split-fleets` gate.

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

**Two vocabularies are in circulation, and this document writes in the
first.** Appendix LE's — opening series, qualifying series, final series,
medal race — is the one below and the one used throughout this document. The
2026 ILCA wording renames every one of those (Part 1's 2026 ILCA section has
the mapping) and, worse, reuses two of the words for different stages. A
series therefore picks a `vocabulary` and the app speaks only that one; the
code's `SeriesStage` values (`qualifying` / `final` / `medal`) are structural
identifiers that happen to read like the first vocabulary and are never
shown. Read the terms below as roles, not as the words a given event uses.

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
  start, places, and completion status. A stored `Race` is neither — it
  is one **start sequence**: the fleets that started in succession and
  finished over one combined sheet. A physical race is a (race, start)
  pair; one sequence may hold one physical race or several (Part 2).

---

## Part 1 — Primer

### Why events split the fleet

A start line can handle roughly 40–80 boats. A world championship attracts
100–300. So the entry is divided into fleets that race separately —
smaller, fairer starts, and manageable launching ashore. But a simple
static split would crown group winners, not a champion: boats in different
groups never meet. The qualifying/final format solves this in two phases:

1. **Qualifying series:** boats race in qualifying fleets of roughly equal
   size **and ability**. After each day, fleets are **reassigned by current
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
a single line. But three other carry models exist, all implemented, and the
scorer picks between them in the split-fleet settings. A fourth shape —
compressing the carried score — is not a carry model at all but a transform
laid over any of them, and is listed here beside its cousins:

| Carry model | Events | Mechanics |
|---|---|---|
| **Continuous points** | ILCA, IODA, 420, 49er, KiWo | One total across Q+F; discards float across the boundary (KiWo makes this explicit: a qualifying discard "may be substituted by a worse score in the final series") |
| **Net + net** | 29er | Q and F are separately-discarded series; championship score = Q net + F net; F ties broken on F scores only |
| **Rank as seed** | Topper, 470 Europeans 2026 | Finals restart from a carried, non-discardable score equal to the boat's qualifying **rank**; her qualifying race scores then drop out of the championship total |
| **Compressed carry** (a medal-stage option, not a carry mode) | ILCA 2026, 49er/FX/Nacra 2026, 470 Europeans 2026 | The medal boats' opening-series **net** is divided and rounded before the medal races are added to it — ILCA 2026 halves it, rounding 0.5 up (SI 18.7.3); the skiffs divide by 2.25 and truncate — so the leaders' gaps compress before the last races. The opening series still scores and discards normally underneath, which is why this sits on `medal.carryTransform` rather than beside the modes above |
| **Knockout bracket** | iQFOiL, Formula Kite | Opening series seeds quarter/semi/grand finals scored on match points — not low-point arithmetic at all (out of scope; see horizon) |

**Stage-aware discard profiles.** The famous "special ILCA discard
profile" (2025 Worlds SI 18.2): 1 discard from 4 races, 2 from 10 — the
2026 SIs unlock the first a race earlier, at 3 (SI 18.4) — but **at most
one discard may fall on a final-series race**, a
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

### Sequenced starts and the combined finish sheet

How the racing is physically run (scorer feedback from real split-fleet
events): a session's fleets start in sequence — five-minute gaps on the
same line — and faster boats in a later-starting fleet catch and pass the
tail of the fleet ahead. The finish team therefore records **one
interleaved sheet across every fleet in the sequence**, not one sheet per
fleet. Which fleets share a sequence varies session by session: all of
Q3's fleets on a qualifying day; Gold F2 + Silver F2 + Bronze F1 when the
final fleets are a race out of step; the medal race and its companion
race. The one combination a sequence never contains is two fleets that
share a boat — she cannot be on two start lines five minutes apart —
which is why a catch-up race for a lagging fleet (whose old-round
membership cuts across every new-round fleet) is always run as its own
separate sequence, first (LE 7.3(c)). The data model leans on both halves
of this: the combined sheet is the input to represent faithfully, and the
disjointness is the validation rule (Part 2).

### The 2026 ILCA Worlds — the concrete target

The **2026 ILCA 7 Men's Worlds run 23–30 August 2026 at Dun Laoghaire**
(National YC / Royal St George YC; entry cap 160, ~141 entered from 45
nations → 3 qualifying fleets), and the **ILCA 6 Women's Worlds follow
there 5–12 September** (~100 entries → 2 fleets). The SIs (Amendment 2,
18 August 2026) are captured at
`reference-docs:events/ilca7-worlds-2026/SI-with-Amendment-2.md` and
settle the questions the NoRs left open. They also use a **three-word
vocabulary this design does not**: the event has a *Qualification* series
divided into a **Preliminary** series (SI 7.3 — 5 races over 2 days,
reassigned nightly) and an **Elimination** series (SI 7.5 — 6 races over
3 days, Gold/Silver/Bronze), followed by a **Final** series (SI 7.6–7.7 —
the top ten, two races on the last day). Those map onto our
qualifying / final / medal stages in that order; the mapping is exact,
the words are not.

What the SIs settle, and where each answer differed from what this design
had assumed. All of it is implemented and fixture-covered — the ILCA 2026
preset sets the lot — so this list now reads as the event's parameters
rather than as a gap list:

- **The finale is not a doubled medal race.** Final series races score ×1
  and are simply added (SI 18.7.2), and *the Qualification score is halved
  first*: "divided by 2 (two), rounded to the nearest whole number (0.5
  rounded upward)" (SI 18.7.3). That is the survey's **F3 compressed
  carry**, not F2 — `medal.carryTransform`, fixture 15.
- **There is no companion-race points offset.** The boats who miss the
  Final series sail "one additional Qualification series race" (SI 7.7) —
  an ordinary Elimination race in their own fleet, scored from 1,
  discardable, counting toward the discard ladder — not 2024's race
  scored from 11. All three fleets sail it; the Gold fleet sails it ten
  boats short, and the boats who left it for the Final series are absent
  from that race rather than scored DNC in it (`medal.companionRace: 'none'`,
  fixture 17).
- **A sub-series tie-break becomes load-bearing.** Halving to whole
  numbers manufactures ties among the ten, and SI 18.7.4 breaks what
  survives A8 on the boat's rank in the Elimination series, then the
  Preliminary series (`medal.tieBreak`, fixture 16).
- **Both equalisation clauses appear**, and read together they compose
  rather than contradict, in the Appendix LE shape: Addendum A 2.2.7
  abandons the fleet-level surplus (LE 20.5's "races completed by all
  fleets"), then SI 18.3 excludes any boat's remaining surplus scores
  (LE 20.4(a)). `equalization` selects whether the second clause applies.
- Codes are as expected: largest fleet + 1 in the Preliminary series, own
  fleet + 1 in the Elimination and Final series (SI 18.5) — so the Final
  series' base is 11. Discards 1 from 3 races, 2 from 10, at most one
  from the Elimination series, a lone Elimination race protected, Final
  races never excluded (SI 18.4). Addendum A 2.2.3's reassignment tables
  for 2, 3 and 4 fleets are the same down-and-back pattern this design
  describes.
- The whole **vocabulary** differs, not just three headings. These SIs have
  a *Qualification* series made of a Preliminary and an Elimination series,
  then a *Final* series; races run **Q1…Q12 continuously across the first
  two** and restart at **F1–F2** for the third. Both vocabularies use the
  words "qualifying/qualification series" and "final series" for different
  stages, so a series picks one and every word follows (`vocabulary`).

Starts and OCS/BFD calls are via Vakaros RaceSense (electronic
identification replaces visual for 30.3/30.4). The 2025 Qingdao edition
remains a valuable degenerate fixture: weather meant **neither class ever
split** — the qualifying ranking became the official result under the "if
no final race is completed" fallback (here SI 18.6.2).

The gaps these SIs opened were filed individually under
[**#403**](https://github.com/sailscoring/sailscoring/issues/403) and are
closed; one of them, the percentage-penalty rounding, was a plain RRS
44.3(c) bug in the split engine rather than anything to do with this event.

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
  semantics fall out structurally: rescoring a protest can never reassign
  a fleet that already exists. (This is the property Sailwave enforces
  with a freeze checkbox.)
- A `Race` already models how a session is actually run: a **start
  sequence** — one or more `RaceStart`s, each with its own gun time and
  fleets — finishing over **one unified crossing-order sheet** (ADR-007),
  with places computed within each fleet. That is exactly the combined
  finish sheet the finish team hands the scorer. So the stored `Race` is
  the on-water session, and a **physical race is a (race, start) pair**:
  *which* stage race each started fleet is sailing lives on the start
  (`RaceStart.stageRaceNumber`), not on the race. Q1-Yellow can be a
  standalone one-start race, Yellow/Blue/Red Q1 one race with three
  starts, Gold F2 + Silver F2 + Bronze F1 one race — whatever the RC ran
  that session. Finish entry scopes to the union of the started fleets,
  and each row's fleet follows from the round's stored assignments — a
  boat outside every started fleet still cannot be given a finish.
- The one structural rule: **fleets started in the same race must have
  pairwise-disjoint membership** (a boat can appear at most once on a
  sheet). That validation forbids exactly the sequences an RC cannot
  physically run — combining an old-round catch-up fleet with new-round
  fleets that overlap it — and permits everything it can: same-round
  qualifying fleets, final fleets in any stage-number combination, the
  medal race with its companion race.
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
export interface SplitFleetConfig {
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
  /** Races needed to constitute the championship (2026 ILCA SI 18.2);
   *  0 = the SIs set no minimum. */
  /** What the SIs call the three stages, their race prefixes, and whether
   *  the final stage numbers on from the qualifying one rather than
   *  restarting (2026 ILCA: Q1…Q12 across both, then F1–F2). */
  /** Which set of words this championship's SIs use for its stages and
   *  races. Prefixes and whether stage 2 numbers on from stage 1 follow from
   *  the choice — only some combinations mean anything. */
  vocabulary: VocabularyKey;
  /** Wording for a class the table doesn't cover. Engine-only; no UI writes
   *  it. */
  vocabularyOverride?: Vocabulary;
  /** Medal race(s): fleet size, race count, points multiplier, and whether
   *  the non-medal companion race starts scoring below the medal fleet
   *  (2024 ILCA SI 18.3.4: first finisher = 11 points). */
  medal?: {
    size: number;
    raceCount: number;
    multiplier: number;
    /** Compress the opening-series net before the medal races add to it
     *  (2026 ILCA SI 18.7.3 halves it, 0.5 up). */
    carryTransform?: { kind: 'divide'; by: number; rounding: 'half-up' | 'truncate' };
    /** Add the sub-series steps after A8 for the medal boats: higher rank
     *  in the final series, then the qualifying series (SI 18.7.4). */
    tieBreak?: 'stage-rank';
  };
}
```

Two of these are deliberately *not* hard-wired, so unusual events don't need
a config change:

- **The companion "last race" is a per-start primitive, not a medal flag.**
  A `RaceStart.firstPlaceOffset?: number` (first finisher scores
  `offset + 1`) lives on the start, so *any* started fleet can sail a
  companion race — the common case (non-medal Gold, first = medal size + 1)
  is just what the medal ceremony pre-fills, but a Silver last race or a
  one-off follows the same primitive with no new pattern to encode. It sits
  on the start rather than the race because the medal race and its
  companion race are typically one start sequence — one race, two starts,
  one sheet.
- **`medal.raceCount` is a planning hint, not a limit.** It seeds the day
  strip; the medal phase lets the scorer add M1, M2, … like final races (the
  2026 two-race medal series is two adds, not a special mode).

`RaceStart` gains optional fields (absent on standard series). Stage
identity is per start, not per race, because one sequence can span stage
race numbers (Gold F2 + Silver F2 + Bronze F1):

```ts
stage?: SeriesStage;
stageRaceNumber?: number;   // Q3 → ('qualifying', 3), per start; final/medal
                            // numbering is per fleet and needs no cross-fleet
                            // pairing
firstPlaceOffset?: number;  // companion-race offset (see above)
```

`Race` itself carries nothing split-fleet-specific: its number, name, and
date describe the session. Per-fleet completion is derived (a start is
complete when the sheet has rows for its fleet's boats); per-fleet
abandonment needs a per-start home — open question 8.

`Series` gains `qfConfig?: SplitFleetConfig`. `Fleet` needs no new
fields for v1: a fleet's stage, round, and order all live on the round
that created it. The logical qualifying race Qk is derived state: the set
of (race, start) pairs with `stageRaceNumber == k` across the covering
round's fleets, **valid** when every fleet's physical race is complete.
Because rounds are keyed by logical race number, not date, a catch-up race
sailed a day late automatically uses the round it was scheduled under —
the LE 7.3(c) behaviour falls out with no special case: the catch-up is
simply its own one-start race on the later date.

**`Competitor` gains an optional `seed?: number`** — the OA's initial
seeding rank (Sailwave's "Seeding" column). Initial seeding by a class
ranking list is *not* derivable from any field we already store: entry
order (`createdAt` / `displayOrder`), sail number, and nationality all
exist, but an externally-supplied ranking is a distinct value with nowhere
to live — which is exactly why Sailwave carries a dedicated Seeding field.
The seed order function therefore reads one of: `seed` (when the OA supplied
a ranking), nationality-then-sail (spread), or plain sail number. The CSV
import's seeding column (below) populates `seed`. It is workspace-local like
the other assignment inputs — carried in the file format but not the public
export (the seeding list is operational, not a result).

**`Competitor` also gains an optional `entryNumber?: string`** — the OA's
registration/admin number on the entry list. It sits alongside the existing
number fields, each with a distinct job:

- `sailNumber` — the boat's own number.
- `bowNumber` — the number a boat flies on the water, for finish-sheet
  matching. Currently framed narrowly ("when it differs from the sail
  number"); at championship scale every boat carries one (LE SI 2.1).
- `entryNumber` — the number the OA *filed* her under at registration. It
  and the bow number often coincide, but not always (bow numbers can be
  assigned per fleet or per day), so they are separate optional fields; where
  they coincide, `entryNumber` is simply left unset. Gated into
  `enabledCompetitorFields` like `bowNumber` — a club Tuesday series never
  needs it.

Its main value is identity/admin (entry lists, bow-number assignment,
import round-trips), but it also gives a **stable** basis for a
seed-by-entry-order option, rather than the internal `createdAt` (which
re-import and CSV order perturb). Note that real SIs seldom seed by entry
order — they use a seed ranking or nationality-then-sail — so entry order is
a secondary seeding basis, not a primary one.

An external entry system's own competitor/entry **id** (Manage2Sail, sailti,
Sailwave) is a different concern: import *provenance* for dedupe and
round-trip, belonging with the integration metadata (cf. the rrs.org push
config, the `CompetitorIdentity` spine) rather than a displayed field. It is
deferred to the entry-system import work, not added as a competitor field
now.

### Scoring engine changes

The engine (`lib/scoring.ts`) gains a split-fleet path alongside fleet
standings:

- **Per-fleet places** come from the existing within-fleet ranking over
  the race's combined sheet — a race shared by several fleets already
  yields an independent 1, 2, 3… per fleet, so "multiple 1sts" needs no
  new mechanism and the interleaved crossing order needs no disentangling
  at entry time.
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
  CarriedFwd field, but computed, not hand-merged). `medal.carryTransform`
  layers over any of them: after the discards, each medal boat's
  opening-series net is divided and rounded into one non-discardable
  carried score that supersedes her race cells. It applies from the moment
  the medal round is committed, not when a medal race is sailed, so "if no
  medal race is completed the adjusted scores decide" needs no second path.
- **Ties.** A8.1 then A8.2, and where `medal.tieBreak` is set, two further
  steps for the medal boats: rank in the final series alone, then the
  qualifying series alone. Ranking a stage on its own re-applies the
  discard ladder to that stage, which is also how `rank-seed` gets its
  carried position.
- **Medal scoring:** points × multiplier, never discarded; a start whose
  `RaceStart.firstPlaceOffset` is set scores its fleet's first finisher
  `offset + 1` and so on (like ZW's "First As") — the companion "last
  race" pre-filled with `offset = medal.size`, but usable on any start.
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
- **Wrong-fleet finishes.** The start-sequence model mostly dissolves
  this. In the common case the wrong fleet is in the *same* sequence, so
  the boat's row goes on the combined sheet like any other and her place
  computes within her assigned fleet — the sheet doesn't care which gun
  she actually took, and a wrong *start* inside one sequence is invisible
  to any scoring desk (it's an RC/jury observation, resolved by protest
  or an RC-sanctioned assignment override on the round). Only when her
  own fleet is in a *different* race — a catch-up day, or the medal race
  vs the companion race — is her number rejected at the desk, and there
  the SI-default outcome falls out with no action: leaving her off the
  sheet scores her implicit DNC in her own fleet's race, and the
  gate-crashed race ignores non-members. A dedicated in-wizard
  exception-recording flow was once planned for that residual case
  (#329); with combined sheets the window is so narrow it was dropped —
  the observation lives in the race's notes or the protest paperwork,
  where it was headed anyway.

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
  `assignment_rounds` (fleet ids + assignments/overrides as JSONB), three
  nullable columns on `race_starts` (stage, stage race number, first-place
  offset), `qf_config` JSONB on `series` — mirrored in `lib/db/schema/`,
  validation in `lib/validation/`, and the repositories.
- **Series-file format bump**: rounds, the start stage fields, and
  `qfConfig` must round-trip through `lib/series-file.ts` (fleets and
  starts already do); omitting any of it is silent data loss.
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
"IODA Championship", "Custom" — each filling `SplitFleetConfig` with
the class-standard values, the way NHC profiles default to SWNHC2015. A
class that changes its own format needs a preset per era rather than an
edit in place: ILCA's 2026 rewrite (a race earlier for the first discard, a
two-race finale at single points on a halved carry) ships alongside the
2021–2025 regime, which past championships are still rebuilt from.

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

- **Seed initial fleets** — order-source choice (`seed` column from CSV,
  nationality-spread, sail number) *or* the committee's named lists entered
  directly; an editable preview (drag a boat, recorded as an override),
  saved as round 1.
- **Reassign for tomorrow** — the rank-pattern reassignment over current
  standings, with a side-by-side preview (who moves where) before
  committing; the snapshot basis is recorded automatically. The tool
  proposes `fromStageRace` = next unsailed logical race — never a
  hand-typed race range, eliminating Sailwave's overwrite-sailed-
  assignments failure mode. Manual overrides layer on top for late entries,
  RC/jury moves, and wrong-fleet corrections.
- **Split into final fleets** — end-of-qualifying wizard: shows the
  equalised qualifying ranking (with any per-boat excluded scores), the
  proposed Gold/Silver/Bronze blocks with an adjustable **top-fleet size**
  and boundary, tie diagnostics (and which tie-order rule settled a
  boundary tie), and creates the final-stage round plus the F-race
  skeletons.
- **Promote (redress)** — a targeted override on the final round moving
  one boat up a fleet, attributed and logged, without touching anyone
  else; clean before the first final race, warned and jury-routed after.

Every round mutation is an activity-log entry, and revision history
(#166) covers the disaster cases Sailwave handles with file copies.

### Races and finish entry

The Races tab groups physical races under their logical race: "Q3" is a
row with Yellow / Blue / Red chips, each a (race, start) pair with its
own gun time and status — chips of one start sequence point into the same
race and its shared sheet — with a "not yet valid" marker on a logical
race some fleet hasn't completed. Finish entry is the existing unified
per-race sheet, entered exactly as the combined sheet comes off the water,
interleaved across the sequence's fleets, and scoped to their union: the
sail-number wizard only offers boats assigned to the started fleets, each
row tints with the boat's fleet colour as it resolves (a live visual check
against the paper sheet), and an out-of-roster number is rejected rather
than silently accepted (see "Wrong-fleet finishes" — the implicit DNC does
the rest). Per-fleet abandonment acts on the start, not the race (open
question 8); the standings and reassignment math react per the rules
above.

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
  for the notice board and the boat park, published to a single rolling
  page under the series' `/p/` slug with the latest round at the top,
  print-friendly (CORK prints the web page for the official notice board;
  so will our users); committed-but-unpublished assignments stay visible
  to workspace members only. This mirrors the pursuit-race start-schedule
  idea in horizon.md — the second case of "publishing something that
  isn't results".

  **This closes a real gap the survey hit.** When we tried to rebuild
  fixtures from past events, we could not reconstruct their qualifying
  fleet assignments: the published Sailwave/Sailti results carry each
  boat's per-race *score* but not *which fleet she sailed in that race*, so
  the reassignment history is lost the moment the event ends (see the survey's
  capture note). Because Sail Scoring publishes every round's assignment as
  a first-class, permanent artifact — not just the final standings — its
  own results are fully reconstructible: the assignment record is part of
  what's published, so a future reader (or a future scorer rebuilding a
  fixture) has the complete picture the sources we surveyed threw away.

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

Since shipped beyond that v1 scope:

- `net-plus-net` (29er) and `rank-seed` (Topper), which this design had
  modelled but left without authoring UX. Both are now scored and set from
  the same plain-language carry editor, with fixtures 13 and 14 pinning
  each against its SI wording.
- **F3 compressed carry** and its sub-series tie-break (fixtures 15–16),
  which the survey had put post-v1 until the 2026 ILCA SIs made it the
  format of the target event.
- The **per-boat equalisation** clause (LE 20.4(a)), which had been
  documented and deferred while its enum value was already accepted.
- A **chosen vocabulary**, and the extra last-day race for the boats who
  missed the medal fleet — which is a medal-block setting, since some classes
  give them a companion race scored below the medal fleet and others give
  them one more ordinary final-series race (fixture 17). See the 2026 ILCA
  section in Part 1.

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
   scorer's file — or is a Seeding rank column on the entry list enough
   for v1?
6. **The config-editability contract.** SIs get amended mid-event (the 2026
   NoR added a medal series 2025 didn't have; the 2025 IODA scorer applied a
   per-fleet finals code base a year before the SI codified it), so the
   config can't freeze wholesale at setup. The working split: **frozen once
   any race has finishes** — `carry` and the qualifying fleet *count*
   (structural: they shape rounds and the entity graph already built).
   **Editable throughout** — everything that only re-scores or affects a
   not-yet-run stage: `discardThresholds`, `maxFinalDiscards`,
   `protectLoneFinalRace`, `codeBasis`, `equalization`, `split` (the rule and
   its top-fleet size, until the split is committed), `reassignmentTieOrder`,
   `vocabulary` (purely presentational), and the `medal`
   block — which now carries the compressed carry and its tie-break, both of
   which only re-score. These live on the Settings card (a series-format
   card like scoring mode): visible always, frozen fields read-only after
   lock, the rest editable — a change just triggers a recompute.
7. **Scratch only?** All target events are one-design scratch. Proposal:
   v1 requires `scoringMode: 'scratch'`; split fleets × handicap systems
   is uncharted (no known real event) and stays unsupported until one
   exists.
8. **Per-start status machinery.** *Decided and implemented (#346):
   remove-and-re-race, not a flag.* Abandoning a fleet's physical race
   removes the fleet from the race's start sequence and voids its rows on
   the sheet; the rest of the sequence stands, and a race left with no
   starts is deleted. The resail is a fresh one-start catch-up race for
   that fleet (offered on the logical-race row), so each sheet stays the
   record of one session; the history lives in the activity log and
   revision snapshots rather than a per-start abandoned state. The two
   worked cases: a same-sequence resail (general recall, re-started after
   the other fleets) is just a later gun on the same start; a
   next-morning resail is the catch-up race. As a belt-and-braces rule
   the engine prefers a completed physical race over an incomplete one
   when two starts claim the same (fleet, stage race), so a lingering
   abandoned start can never invalidate its resail. Still open from this
   question: the protest-time-limit anchor (`lastFinisherTime`) — limits
   run per fleet, derivable from a timed sheet, needing a per-start
   fallback when the sheet is untimed.
9. **Race naming and numbering.** *Half-decided.* With the race as the
   start sequence, "Q3" is no longer a race name: a race is "Day 2,
   Race 1" holding Yellow Q3 + Blue Q3 + Red Q3 (or Gold F2 + Silver F2 +
   Bronze F1), and Q3 / F2 are per-start labels. The **words** are settled,
   and settled as one choice rather than a naming pass: `vocabulary` picks a
   whole coherent set (see Part 1's 2026 ILCA section), `stageRaceLabel`
   derives every race label from it, and a unit test fails the build if a
   stage word is written into a surface directly. The two vocabularies share
   terms for different stages, so nothing less than a complete swap would
   have been safe. What `raceNumber` should *mean* on a split-fleet series
   is still open, and still belongs with open questions 1–2.

### Feature-checklist mapping

Done with the feature: keyboard shortcuts for the Split Fleets view's
actions; the help-page section (a new scorer's guide to running a
split-fleet event); Vitest + YAML fixtures per the validation plan; the
Playwright happy path (seed → race → reassign → split → final → publish);
the series-file format bump; public JSON export; a Seeding column on entry
import; the feature-table row in `docs/workspace-provisioning.md`.

Config changes since carry the same obligations: a new field needs the Zod
schema, the config editor, its sentence in the sailing-instruction
translation, and — because `splitFleets.config` travels verbatim through
files — a format-version bump, so an older build dropping it is visible
rather than silent.

---

## Implementation checklist

The concrete work to take the prototype to "complete enough" for F1, F2, and
the prioritised scenarios (D1/D3/D5/D6/D8/D10) is tracked in
[**#328**](https://github.com/sailscoring/sailscoring/issues/328) — organised
by layer, each item tagging its scenario driver and the prototype shortcut it
undoes.

The start-sequence revision above (scorer feedback: fleets start in
sequence and finish onto one combined sheet) is implemented (#346): stage
identity lives on `RaceStart`, the engine keys physical races to
(race, start), the ceremonies create one race per stage race number with a
start per fleet (medal-stage races excepted — they run on their own
courses), and the add-races API takes per-start numbers for out-of-step
sequences. Open question 8 (per-start abandonment machinery) remains open;
question 9 is half-answered — race *labels* now come from the config, but
what `raceNumber` means on these series does not.

The 2026 ILCA 7 Worlds SIs, published in August 2026, then took the format
somewhere this design had put post-v1: their finale compresses the carried
score rather than doubling a medal race. That work, and the seven other
gaps those SIs opened, is
[**#403**](https://github.com/sailscoring/sailscoring/issues/403) and is
done — see the 2026 ILCA section in Part 1 for what the SIs actually say.

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
- `reference-docs:events/ilca7-worlds-2026/SI-with-Amendment-2.md` — the
  2026 ILCA 7 Worlds SIs (Amendment 2, 18 Aug 2026): the target event's
  scoring regime (SI 18), format (SI 7) and Addendum A fleet rules.
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
