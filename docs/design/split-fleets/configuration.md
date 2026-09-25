# Split-fleet configuration: the settings reference

Every setting a split-fleet championship still has: which stage card it sits
on, whether the scorer gets a control for it or only reads it as a rule, and
which scored event it comes from.

Context: #636, which replaces the format templates and the format dialog of
#606 with a configuration rebuilt from the events we have actually scored. The
cards themselves are
[`docs/design/ux/flows/split-fleets-setup.md`](../ux/flows/split-fleets-setup.md);
the scoring rules and data model are
[`docs/design/split-fleets.md`](../split-fleets.md). Format codes (F1–F9) cite
[`format-survey.md`](format-survey.md) and
[`champions-cup-survey.md`](champions-cup-survey.md).

---

## The rule

**A setting gets a control only when two events we have scored need different
answers.** Where every scored event agrees, the setting is not a setting. It is
how the championship works, shown on its card in words and in the
sailing-instructions view.

A new variant arrives with the event that needs it. It brings a fixture taken
from that event and a row in this document, and it is placed on the card of
the stage it governs. It is never added because a survey found it.

The events it is measured against:

- **JCC:** Irish Sailing Junior Champions' Cup 2026, `/p/irishsailing/2026/junior-champions-cup`
- **ILCA 7:** ILCA 7 Men's Worlds 2026, `/p/ilca-worlds/2026/ilca7-men`
- **ILCA 6:** ILCA 6 Women's Worlds 2026, `/p/ilca-worlds/2026/ilca6-women`

---

## Chosen when the series is created

| Setting | Control | In use | Why it is a control |
|---|---|---|---|
| Terminology | Two options | JCC opening-medal; ILCA qualification-final | The two sets reuse each other's words for different stages. "The final series begins when qualifying ends" is true under one and false under the other. |

Terminology can be changed until the first race exists. After that it decides
race labels competitors have already quoted on the notice board, so it stays
fixed.

## Opening series card

"Opening series" or "Qualification series", depending on the terminology.

| Setting | Control or rule | In use |
|---|---|---|
| Divided or not | Divide / undivide action | JCC no; ILCA yes |
| Fleets (undivided) | Count, names, colours | JCC 1 |
| Discard ladder | Editable ladder | JCC 1 from 5; ILCA 1 from 3, 2 from 10 |
| Race labels (undivided) | Rule: Q (both sets) | |
| Non-finisher score (undivided) | Rule: boats in the largest fleet + 1, which is entries + 1 with one fleet | JCC |
| Companion race (undivided) | Rule: once the medal fleet is selected, the next race is for the rest, scored from medal-fleet size + 1 | none yet (found in testing, Sept 2026) |

When the opening series is divided, the ladder stays on this card and runs
over both of its parts. The discard count is reached over the opening series'
races combined, as it always was.

## Stage 1 card, once divided

"Qualifying series" or "Preliminary series".

| Setting | Control or rule | In use |
|---|---|---|
| Fleets | Count (1 or more), names, colours | ILCA 7 3 (Yellow/Blue/Red); ILCA 6 2 |
| Race labels | Rule: Q, or QP | ILCA QP |
| Non-finisher score | Rule: boats in the largest fleet + 1 | both ILCA |
| A race counts | Rule: only once every fleet of its round has sailed it | both ILCA |

One fleet is allowed. It is the shape #600 describes: everyone races together,
then the fleet splits.

## Stage 2 card, once divided

"Final series" or "Elimination series".

| Setting | Control or rule | In use |
|---|---|---|
| Fleets | Count (2 or more), names, colours | ILCA 7 3 (Gold/Silver/Bronze); ILCA 6 2 |
| How boats are divided | Rule: near-equal fleets by rank, top fleet largest; block sizes adjustable in the split dialog | both ILCA |
| Race labels | Rule: F, or QE | ILCA QE |
| Non-finisher score | Rule: boats in her own fleet + 1 | both ILCA |
| Carried from stage 1 | Rule: points, as one continuous series | both ILCA |
| Discard cap | Rule: at most one excluded score from this stage, and never from a lone completed race of it | both ILCA |
| Companion race | Rule: scored from medal-fleet size + 1 in each fleet that lost boats to the medal fleet | both ILCA |

The companion race is an action on this card, not a setting. See the flow doc.

## Medal card

"Medal races" or "Final series".

| Setting | Control or rule | In use |
|---|---|---|
| Fleet size | Number. It draws the provisional cut line before selection, and the selection dialog starts from it | all 10 |
| Points | ×2 or ×1 | JCC ×2; ILCA ×1 |
| Score carried in | Net, or net halved with 0.5 rounded up | JCC net; ILCA halved |
| Ties among medal boats | The medal race first, then A8; or the last race alone | JCC NoR 15.3; ILCA SI 18.7.4 |
| Discards | Rule: no medal race is excluded, and none counts towards the ladder | all |
| Race labels | Rule: M, or F | JCC M; ILCA F |
| Who is selected | Rule: top N of the opening series, or top N of stage 2's top fleet once divided; ties by A8, then entry order | all |
| When a halved carry applies | Rule: from the first completed medal race, so an abandoned medal stage leaves the undivided score (2026 ILCA SI 18.7.5, Amendment 5) | ILCA |

---

## Not settings any more

These are fixed behaviour. Each one is the only value any scored event has
used.

| Was | Now |
|---|---|
| `carry` | Points, continuous |
| `codeBasis` | By position: largest fleet in stage 1 (or undivided), own fleet in stage 2 |
| `equalization` | The validity gate alone |
| `maxFinalDiscards`, `protectLoneFinalRace` | 1 and protected, when divided |
| `reassignmentTieOrder` | A8, then entry order |
| `raceLabels` | The fixed table above: Q/M, Q/F/M, Q/F, QP/QE/F |
| `finishSheets` | Chosen per race when it is added. A stage can mix both. |
| `medal.companionRace` | Divided: scored below. Undivided: there is no stage for it. |
| `carryTransform.appliesFrom` | First medal race |
| `vocabularyOverride`, legacy `stageNaming` | Gone |
| `plannedDays` | Gone. No control ever wrote it, so every series held a default. Rounds create no races, and the day strip shows the races that exist. |
| `medal.raceCount` | Gone. The scorer adds medal races as the SIs say. Once the medal fleet has sailed, the next action offers both another medal race and declaring the results final, and the app does not judge which. |

## Removed, and what would bring each back

| Removed | Last needed by | Returns when |
|---|---|---|
| `carry: net-plus-net` (F5) | 29er, WASZP, Topper surveys | We score an event whose NoR adds two series |
| `carry: rank-seed` (F6) | 470 Europeans 2026, Topper 2022 surveys | We score an event that carries a qualifying position |
| Carry nothing into the deciding stage | Champions' Cup (F9) | #417 |
| `split: fixed-top` | Skiffs, Moth, 29er surveys | We score an event with a fixed Gold size |
| `codeBasis: fixed`, `largest-qualifying` | Sailwave practice; pre-2026 Optimist | We score one |
| A5.3 as a code base | Champions' Cup | #417 |
| `exclude-extra-scores` (LE 20.4(a)) | IODA, 420, 29er surveys | We score one |
| `fleet-order` tie order | LE | We score one |
| `tieBreak: stage-rank` | ILCA 2026 SI before Amendment 3 | We score one |
| `companionRace: dnc` | Junior Champions' Cup 2025 NoR | A notice of race asks for it again (the 2026 event was scored without it) |
| Format templates, custom formats | – | Not planned |

Survey-only knowledge stays in the surveys. The engine carries only what a
scored event has used.

---

## The stored shape

`SplitFleetConfig` keeps its place in the `jsonb` column, the series file and
the public export, and it gets smaller:

```ts
interface SplitFleetConfig {
  vocabulary: 'opening-medal' | 'qualification-final';
  /** Stage 1's fleets, or the undivided opening series'. One or more. */
  qualifyingFleets: { label: string; color: string }[];
  /** Stage 2's fleets. Empty when undivided. */
  finalFleets: { label: string; color: string }[];
  split: { kind: 'equal-blocks' } | { kind: 'none' };
  discardThresholds: { minRaces: number; discardCount: number }[];
  medal: {
    size: number;
    multiplier: 1 | 2;
    carryTransform?: { kind: 'divide'; by: 2; rounding: 'half-up' };
    tieBreak: 'medal-race-then-a8' | 'last-race';
  };
}
```

Two rules keep it honest:

- **Values are written when a series is created, never filled in when it is
  read.** Today the race labels, the companion race and the carry timing are
  filled in on read, so changing a default changes championships already
  scored. ILCA 7's race labels would be the first casualty. A one-off backfill
  writes explicit values before anything else moves.
- **Old files keep importing**, under
  [ADR-013](../decisions/013-removing-meaning-from-stored-formats.md). Fields
  that are now fixed behaviour are dropped when they hold the value we kept.
  The relabel is presentational and simply happens. The halved carry's old
  timing is accepted wherever a medal race was completed. Any other removed
  value would score differently, so the file is refused with the setting
  named. No such file is known to exist.
