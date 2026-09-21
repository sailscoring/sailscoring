# Split-fleet configuration — the settings reference

Every field of `SplitFleetConfig`: what it decides, what event made it
necessary, and which of two people it belongs to — the class that writes the
notice of race, or the organising authority that runs this particular event.

Context: #606, which splits the one Format card into a guided format dialog
and a card of only the event's own settings. The dialog is
[`docs/design/ux/flows/split-fleets-setup.md`](../ux/flows/split-fleets-setup.md);
the format primer, data model and scoring rules are
[`docs/design/split-fleets.md`](../split-fleets.md). This document supersedes
that one's `SplitFleetConfig` sketch, which predates half the medal block.

Format codes (F1–F8) and scenarios (D1–D10) cite
[`format-survey.md`](format-survey.md).

---

## The line, and why it is drawn there

A split-fleet championship is described by two documents written by two
different people. The **notice of race** carries the class's format: whether
the score so far is halved into a final series, whether a boat's qualifying
position carries as a rank or as points, what a non-finisher scores. The
**sailing instructions and the notice board** carry this event's decisions:
three fleets or four, what they are called, how many days, what the race
column says, how many discards.

Today all of it is one card of twenty-odd equally editable settings, which
invites the scorer to compose a format rather than recognise one. So the
settings are partitioned, and the partition decides three separate things:

- **What the format dialog settles**, and the Format card then no longer
  offers.
- **What a sentence of the sailing-instruction translation is marked as** —
  fixed by the format, or still the scorer's.
- **What survives a change of format**, which is the one place the partition
  needs three values rather than two.

### The three scopes

| Scope | Who decides | On a format change |
|---|---|---|
| **format** | The class, in the notice of race | Rewritten |
| **event parameter** | This event, but every format has a sensible default | Rewritten to the new format's default |
| **event identity** | This event, and nobody else could guess it | Kept |

Event identity is the scorer's own typing — fleet names and colours, the
schedule they sketched, the prefixes their notice board prints. Losing any of
it to a format change is pure damage, and today's `pickFormat` loses all of
it. An event parameter is a number the scorer owns but that the class has a
usual answer for: the discard ladder, the medal fleet size. Taking the new
format's answer for those is the better guess, and the dialog's third page
shows the resulting prose before anything is committed.

Drift — "ILCA 2026, with 2 changes" — is measured over the **format** scope
alone. An event setting has no format position to depart from, so it cannot
drift; that is what lets the new comparison drop the special cases that
today's `matchesFormat` needs (ignoring race labels, comparing fleets by
count alone). They fall out of the partition instead.

---

## Provenance

The format becomes a stored fact rather than a value the app infers from the
numbers:

```ts
origin: {
  /** The format chosen, or 'custom' for a configuration that started from
   *  nothing. */
  format: FormatKey | 'custom';
  /** Which build of that format. Bumped when a builder's values change. */
  formatVersion: number;
  chosenAt: number;
  /** Format-scope settings the scorer has deliberately taken back. Held
   *  apart from drift: unlocking a setting and leaving its value alone is
   *  not a change, and a re-locked setting is one whose value agrees again. */
  unlocked?: SettingKey[];
}
```

The **fully expanded configuration is still written**. A series file, a public
export and an as-published archive have to be self-describing: a series
storing only a format key would be silently re-scored the next time
`ilca2026SplitFleetConfig` is corrected. The origin is provenance beside the
values, never a replacement for them.

`formatVersion` earns its place by making the drift diff honest. Where it
equals the current build, every difference is the scorer's and the diff says
so. Where it is older, the format itself has been corrected since, and a
difference is not attributable to either party — so the diff says *that*
instead, and offers the correction rather than asserting the scorer made it.
No historical builders need keeping.

Cost: one additive `FORMAT_VERSION` bump. `splitFleets.config` travels
verbatim through `lib/series-file.ts`, sits in a `jsonb` column, and is copied
whole by the public export — so `origin` rides everywhere with no parser, no
schema change and no migration.

---

## The settings

One registry keyed by setting, not by field, because a setting is what the
scorer reaches and what a sentence is attributed to. Several settings read
more than one field, and one field (`split`) is read by two settings.

### Format scope

| Setting | Fields | What it decides | Where it comes from |
|---|---|---|---|
| `vocabulary` | `vocabulary`, `vocabularyOverride` | Which of the two dialects every stage word, heading and published page uses | The two vocabularies in circulation reuse each other's words for different stages — "the final series begins when qualifying ends" is true under one and false under the other, where six races of the Qualification series remain. One choice, never a name per stage. |
| `carry` | `carry` | How the first stage's results enter the championship score: one continuous series, two series added together, or the first stage's *position* carried as one non-excludable score | F1/F2 continuous is ILCA, Optimist, 420, 470, Moth and the classic skiffs. F5 net + net is the 29er 2022–26, WASZP 2025, Topper 4.2 2023. F6 rank-seed is Topper 5.3 2022, the 29er 2021, and the 470 Europeans 2026. |
| `splitKind` | `split.kind` | Near-equal fleets by rank, a fixed number in the top fleet, or no split at all | Near-equal blocks is Appendix LE's, Gold largest. Fixed-top is Moth 2025 (top 60), the skiffs (Gold 25), the 29er (Gold scaled 40/45/50 by entries), WASZP 2025 (Gold and Silver 70 each). `none` is the 49er/FX/Nacra Worlds 2021, the 470 Worlds 2021, WASZP 2023 and 2026, and the Irish Sailing Junior Champions' Cup every year — and it is what ILCA 2025 Qingdao fell back to (D1). |
| `codeBasis` | `codeBasis` | The RRS A5.2 replacement base per stage | `largest-fleet` is the standard first-stage base; `fixed` is Sailwave's safe option. In the second stage, `own-fleet` against `largest-qualifying` is the pre-2024 ILCA and pre-2026 Optimist practice — and D9: an Optimist scorer applied the per-fleet base a year before the SI said so, and the 2026 SI then codified it. |
| `equalization` | `equalization` | What happens when the first stage ends with boats holding different numbers of scores | `abandon-extra-races` is the validity gate alone — ILCA A2.8 and 2026 SI Addendum A 2.2.7, Appendix LE 20.5. `exclude-extra-scores` adds LE 20.4(a) on top, which IODA, 420, the 29er and Topper from 2024 carry. They compose; they are not two readings of one rule (D8). |
| `finalDiscardCap` | `maxFinalDiscards`, `protectLoneFinalRace` | How many excluded scores may fall on the second stage, and whether a lone completed second-stage race is protected | Both are ILCA's, and both exist because a finals stage can be very short: the 29er 2025 Porto finished its four final fleets on 2/2/1/1 races (D4). The *ladder* these cap is the event's — see below. |
| `medalStructure` | `medal` presence, `raceCount`, `multiplier`, `carryTransform`, `tieBreak`, `companionRace` | Whether there is a deciding stage, how its scores weigh, what it does to the score carried into it, how a tie between its boats is settled, and what the boats who miss the cut do | The classic ×2 single medal race is F2. F3 is ILCA 2026: two races at ×1 on a score halved 0.5 up (SI 18.7.3), the division undone if no race sails (SI 18.7.5 as Amendment 5 wrote it), rule A8 replaced outright by the last race (SI 18.7.4), and the boats outside the ten sailing one more race of their own fleets scored from 11 (SI 18.5.3 from Amendment 3). `medal-race-then-a8` is the Junior Champions' Cup NoR 15.3, which puts the deciding race *ahead* of A8 and leaves A8 the rest. D7 is the argument for having any of these at all: the ILCA 6 2021 world title was decided at 71.0 = 71.0 on an unmodified A8. |

### Event parameters

| Setting | Fields | What it decides | Where it comes from |
|---|---|---|---|
| `discards` | `discardThresholds` | The discard ladder | Every class writes its own and hosts vary it: Optimist exactly one from five, 420 one from three, ILCA one from four and two from ten, ILCA 2026 one from *three*, the 29er one from three per stage, Moth pooled two to three. The ladder is the event's; the caps above it are the format's. They share one editor row today, which is why that row splits. |
| `medalSize` | `medal.size` | How many boats sail the deciding stage | Ten is near-universal and is the format's default — but the Champions' Cup picks its own cut, so the number stays the event's. |
| `splitTopSize` | `split.topSize` | How many boats are in the top fleet, under a fixed-top split | Fixed by the class as a rule (skiffs 25, Moth 60) but scaled by entries in practice (29er 40/45/50). |
| `finishSheets` | `finishSheets` | One sheet per race with the fleets interleaved, or a sheet per fleet | Not a class matter at all: it is how this race committee hands results over — by hand off one sheet, or as one export per fleet, as RaceSense writes them. Every format defaults it to `combined`, so the scope is inert today and correct tomorrow. |

### Event identity

| Setting | Fields | What it decides | Where it comes from |
|---|---|---|---|
| `fleets` | `qualifyingFleets`, `finalFleets` | How many fleets, what they are called, what colour they are | Entry-banded in the notices (420 at 50/100, 470 at 40/80) and then overridden by the organiser in practice — the 470 2023 sailed 64 boats in one fleet, the 420 2025 two fleets at 101. One exception: a format whose split is `none` has one fleet and no second-stage fleets, so it overrides this. |
| `raceLabels` | `raceLabels` | The prefix per stage and whether the second stage numbers on from the first | The two 2026 ILCA Worlds were sailed under one class's sailing instructions and published three schemes between them — Q then E, QP then QE, and the SIs' own continuous Q in neither. The label is what a competitor writes on a scoring enquiry, so it cannot be derived from the words. |
| `plannedDays` | `plannedDays` | The day strip's future days and each round's default coverage | Scorers like their ducks in a row: the event is laid out from day zero as a plan reality is reconciled against. The format supplies a first sketch; after that it is the scorer's. |

### Leaving the card

`reassignmentTieOrder` writes no sentence of the translation and decides
nothing until two boats are exactly tied on a fleet boundary — which is to
say it is a property of the assignment ceremony, not of the format. It leaves
the Format card for the assignment preview, where the tie is on screen and
the choice reads as a choice: *Smith and Jones are tied on 24 points at the
boundary; the better seeding rank goes to the higher fleet.* Until that
control exists the field simply goes unedited — its default is right for every
surveyed event — which is better than a settings row nobody can act on.

---

## Attribution: which setting wrote which words

`lib/split-fleets-si.ts` restates the configuration as numbered sailing
instructions, and `SENTENCES_BY_SETTING` maps each setting to the sentences it
writes. The dialog needs the inverse — for a sentence, which settings wrote
it, hence whether it is fixed or still the scorer's.

Inverting the table as it stands does not work, for two reasons:

**Every sentence a scorer can change is mixed.** Of sixteen sentences, eleven
are written by format settings alone and *none* by event settings alone. The
five that a scorer has any hand in — the race-label clause, fleet assignment,
the split, discards and the medal clause — each mix format-shaped prose with an
event-chosen number inside it: "divided into Gold, Silver and Bronze" is the
format's division and the event's three. So slot-level marking is not a
refinement to promote two or three sentences to later; it is the only marking
that says anything, and sentence-level would mark the whole list fixed.

**The table over-claims.** `carry` is listed as writing `discards`, because
two of the three carry models append a clause to it. Under the dominant
continuous-points model it appends nothing, and the sentence is wholly the
scorer's — but the static table cannot know that.

Both are answered by attributing at the part rather than the sentence.
`describeSplitFleetConfig` returns each sentence as spans, a span carrying the
setting that wrote it (or nothing, for prose that is pure doctrine and so
fixed by definition). `SENTENCES_BY_SETTING` is then *derived* from a rendered
config instead of hand-maintained beside it — which also removes the drift the
current comment warns about, and leaves the editor's existing hover marking
reading from the same source as the dialog's.

A span with no setting is fixed. A sentence is fixed when none of its spans is
the scorer's. Event parameters and event identity mark identically: the
three-way scope is a rule about format changes, and to the scorer both are
simply theirs.

---

## To check before this ships

The survey records F3 — ILCA 2026 and the classes that copied it — as splitting
to a **fixed Gold of 25**, while `ilca2026SplitFleetConfig` inherits
near-equal blocks from the default. While the split rule is a freely editable
field the discrepancy costs a scorer one correction; once it is baked it is
the format asserting something the notice of race may not say. Read against
the 2026 SIs and settle it with the builder, not in the editor.
