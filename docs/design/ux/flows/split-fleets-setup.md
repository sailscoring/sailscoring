# Split Fleets Setup Flow

How a split-fleet championship is configured. There is one question when the
series is created. After that, each stage has a card holding only that stage's
settings, and cards appear as the scorer shapes the championship.

Context: #636, which replaces the format dialog of #606. Every setting, and
whether it is a control or a rule, is in
[`docs/design/split-fleets/configuration.md`](../../split-fleets/configuration.md).
The rest of the Split Fleets view (rounds, the split, the medal stage) is
[`split-fleets.md`](split-fleets.md).

---

## Design priorities, in order

1. **Start from the simplest real championship.** The default is the Junior
   Champions' Cup: one fleet sails a few races, and the top ten sail a medal
   race. A scorer with that event is done after one question.
2. **Complexity arrives with an action.** Dividing the opening series adds two
   cards, and adding a fleet adds its colour. Nothing about a three-stage,
   three-fleet championship is shown to someone who hasn't asked for one.
3. **A setting lives on the card of the stage it governs,** next to that
   stage's actions. The discard cap for the Elimination series is on the
   Elimination series card, not in a championship-wide list.
4. **A control only where real events disagree.** Everything else is shown on
   the card as the rule the championship follows, in words, so the scorer can
   check it against their sailing instructions.
5. **The prose is the check.** The sailing-instructions view restates the
   whole configuration as numbered instructions, and it is what a scorer reads
   against their own document.

---

## Creating the series

Choosing "Split-fleet championship" in the setup wizard asks one question in
place, under the radio:

```
  ●  Split-fleet championship

     Which words do your sailing instructions use?

     ●  Opening series, then medal races
        Races Q1, Q2 …, then M1. Divided: a qualifying series and a final
        series, races Q and F.

     ○  Qualification series, then Final series
        Races Q1, Q2 …, then F1. Divided: a Preliminary series and an
        Elimination series, races QP and QE. ILCA from 2026.
```

That writes the default championship: one fleet, one discard from three
races, a medal fleet of ten at double points. Nothing about fleets or
divisions is asked here, because the scorer may not know yet. The Melges 15
Sprint decided Sunday's format at Saturday's briefing.

---

## The cards

The Split Fleets tab stacks one card per stage, in event order. Each card has
a status line, its actions, and a **Settings** expander, closed by default.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ▾ OPENING SERIES                                          Q1–Q7 · 16 boats│
│                                                                          │
│   Q1 ✓  Q2 ✓  Q3 ✓  Q4 ✓  Q5 ✓  Q6 ✓  Q7 ✓            [ Add Q8 ]       │
│                                                                          │
│   ▸ Settings   1 fleet · 1 discard from 5 races                          │
├──────────────────────────────────────────────────────────────────────────┤
│ ▾ MEDAL RACES                                                Not started │
│                                                                          │
│   [ Select the medal fleet ]                                             │
│                                                                          │
│   ▸ Settings   10 boats · double points · net score carried              │
└──────────────────────────────────────────────────────────────────────────┘
```

The collapsed Settings line summarises the values that differ between real
events, so the scorer can see how the card is configured without opening it.

### Opening series card

```
   ▾ Settings
     Words used          Opening series, then medal races        [ Change ]
     Fleets              [ 1 ]
     Discards            Exclude [1] score from [5] races   [ + another ]
     ─────────────────────────────────────────────────────────────────────
     Races are numbered Q1, Q2 and so on.
     A boat that doesn't finish scores the number of entries, plus one.

     [ Divide into a qualifying and a final series ]
```

Above the line are controls; below it are rules, in the words the
sailing-instructions view uses. With one fleet there are no colours to pick
and no assignment to make. The first `Add Q1` creates the round quietly, as
the fleet is simply everyone.

With two or more fleets the card gains names and colours, the non-finisher
rule reads "boats in the largest fleet, plus one", and `Assign fleets` becomes
its first action. That is the undivided multi-fleet shape: fleets are drawn
once, with no split to follow.

`Change` on the words is offered until the first race exists.

### Dividing

`Divide into …` turns the opening series into a parent card holding its two
parts. Under the ILCA wording:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ▾ QUALIFICATION SERIES                                                   │
│   ▸ Settings   1 from 3 races, 2 from 10                    [ Undivide ] │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ ▾ PRELIMINARY SERIES                              Round 2 · QP3–QP5│  │
│  │   … rounds and races, as today …                                   │  │
│  │   ▸ Settings   3 fleets · Yellow, Blue, Red                        │  │
│  ├────────────────────────────────────────────────────────────────────┤  │
│  │ ▸ ELIMINATION SERIES                                  Not started  │  │
│  └────────────────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────────────────┤
│ ▸ FINAL SERIES                                                Not started│
└──────────────────────────────────────────────────────────────────────────┘
```

The discard ladder stays on the parent, because it runs over both parts.

**Dividing relabels the races already sailed**, when the wording's labels
differ between the two shapes. Under the ILCA wording an undivided series
numbers its races Q1, Q2 …; divided, the same races are QP1, QP2 …, which is
what the divided championship's instructions call them. So a Melges 15 scorer
who sails eight undivided races on Saturday and divides that night publishes
QP1–QP8 from then on. Under the opening-medal wording nothing moves: Q stays Q.

**Preliminary / qualifying series settings.** Fleet count, names and colours.
The count keeps whatever the opening series had, including one: the Melges 15
shape is one fleet on Saturday, split on Sunday. Rules: races are numbered QP1
(or Q1); a non-finisher scores the largest fleet plus one; a race counts only
once every fleet of its round has sailed it.

**Elimination / final series settings.** Fleet count (two or more, defaulting
to two), names and colours, Gold / Silver / Bronze first. Rules: races are
numbered QE1 (or F1); boats are divided by rank into near-equal fleets, top
fleet largest; a non-finisher scores her own fleet plus one; points carry on
from the Preliminary series as one series; at most one excluded score may come
from this series, and never a lone race of it.

`Undivide` is offered until the split is committed. After that, boats have
Gold and Silver scores and there is nothing to undo into.

### Medal card

```
   ▾ Settings
     Boats               [ 10 ]
     Points              ( ) Single   (●) Double
     Score carried in    (●) Net score   ( ) Net score halved, 0.5 rounded up
     Ties                (●) The medal race first, then rule A8
                         ( ) The last race alone
     ─────────────────────────────────────────────────────────────────────
     Races are numbered M1, M2 and so on.
     No medal race is excluded, and none counts towards the discards.
     The fleet is the top 10 of the opening series, ties settled by rule
     A8 and then entry order.
```

Once the opening series is divided, the selection rule reads "the top 10 of
the Gold fleet". Where the carry is halved, the rule gains its timing: "The
halved score applies from the first completed medal race. If no medal race is
completed, the undivided score stands."

The fleet size is a setting because it is needed before anyone is selected:
it draws the provisional cut line in the standings throughout the opening
series. `Select the medal fleet` opens the existing selection dialog with that
size pre-filled. It can be changed there for the selection itself, for
example when the jury extends the fleet after a redress decision.

### Adding a race

Wherever a stage has more than one fleet, its add-race button carries the
finish-sheet choice:

```
   [ Add QE4  ▾ ]
     ● One finish sheet, all fleets on it
     ○ A sheet per fleet
```

The default is whatever the stage's previous race used, so a RaceSense event
sets it once. A stage can mix the two: #600 sails its first three Elimination
races as separate starts and the sail-off onto one sheet. A one-fleet stage
shows a plain button.

### The companion race

Once the medal fleet is selected, the Elimination / final series card gains
`Add companion race`. It creates one more race of that series for every boat
not in the medal fleet, sailed in her own fleet. In each fleet that lost boats
to the medal fleet, the first finisher scores the medal-fleet size plus one.
It is otherwise an ordinary race of the series and can be excluded.

It is an action rather than a setting because it is a race the committee
decides to sail. The rule for scoring it only appears on the card once it can
be sailed.

---

## Read as sailing instructions

The tab keeps one panel, below the cards, restating the whole configuration as
numbered instructions. Hovering a setting on any card marks the sentences it
writes. The standings page keeps its folded-away copy, and published pages
keep theirs.

---

## Once racing has started

Locks follow what has been sailed, not a global switch:

| Setting | Locks when |
|---|---|
| Words used | The first race exists |
| A stage's fleet count | Its first round is committed |
| Divide / undivide | The split is committed |
| Discards, medal points, carry, ties | Never. A sailing instruction amended mid-week is what they are for. |
| Fleet names and colours | Never |

Every change after the first finish is an activity-log entry, as every round
action already is.

---
