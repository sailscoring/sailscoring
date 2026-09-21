# Split Fleets Setup Flow

UX for settling a split-fleet championship's **format** — the guided dialog
that replaces today's silent default, and the Format card that afterwards
offers only what this particular event decides.

Context: #606. The settings themselves, and which of them the format decides,
are
[`docs/design/split-fleets/configuration.md`](../../split-fleets/configuration.md).
The rest of the Split Fleets view — rounds, the split ceremony, the medal
stage — is [`split-fleets.md`](split-fleets.md), whose "Phase: Setup" section
this document replaces.

---

## Design priorities, in order

1. **Recognise, don't compose.** The scorer is holding a notice of race
   someone else wrote and is trying to find their event in our words. Every
   question is one they can answer by looking at that document, and the
   answers name real championships rather than describing mechanisms.
2. **Never write a format nobody chose.** Today, picking "Split-fleet
   championship" in the setup wizard silently writes ILCA 2026 with three
   fleets, and the scorer meets the format later, on a tab, as a value in a
   dropdown. Nothing is written until a format is chosen.
3. **What the format decides, it decides.** Choosing a format settles the
   things the class settles, and they stop being offered. A card where the
   halved carry sits at the same weight as the fleet colours is a card that
   says every value is equally the scorer's — which is how a championship ends
   up scored to a configuration nobody intended.
4. **Baked is hidden, never unreachable.** A format's settled values will be
   wrong for a real event, and the scorer will find out mid-week. Topper's
   sailing instructions overrode the notice of race's carry model for two
   years; an Optimist scorer applied a per-fleet finals base a year before the
   SI said so; two Moth hosts shipped instructions with no split clause at
   all (D9). Every settled value opens, one at a time, and doing so is
   recorded rather than prevented.
5. **The prose is the check.** A scorer cannot verify a configuration against
   a document by reading dropdowns. They can by reading sentences — so the
   dialog ends on the sailing-instruction translation, with the parts that
   remain theirs marked, before anything is committed.

---

## Where it opens from

**The setup wizard.** Picking "Split-fleet championship" opens the dialog
immediately, in place of the current silent write. Cancelling leaves the radio
where it was and writes nothing, so the wizard's two kinds of series stay
genuinely reversible.

**The Format card**, as `Change format…` beside the format's name.

Nothing else reaches it. This is an action a scorer takes once an event, so it
gets no keyboard shortcut of its own; inside the dialog, Enter continues, Esc
cancels, and the arrow keys move within each list.

---

## Page 1 — Which words does your document use?

```
┌─ How is this championship scored?                          1 of 3 ─┐
│                                                                    │
│  Which words does your document use?                               │
│                                                                    │
│  Both sets are in circulation, and each borrows the other's        │
│  words for a different stage — so this is one choice, not a name   │
│  per stage. Everything after it is worded in the set you pick.     │
│                                                                    │
│  ○  qualifying series → final series → medal races                 │
│     Races Q, F and M. Appendix LE's wording, and most classes'.    │
│                                                                    │
│  ○  Preliminary series → Elimination series → Final series         │
│     Races Q1 onward, then F. The first two stages together are     │
│     the Qualification series. ILCA from 2026.                      │
│                                                                    │
│  My document doesn't say — show me every format                    │
│                                                                    │
│                                           [ Cancel ]  [ Next → ]   │
└────────────────────────────────────────────────────────────────────┘
```

The options are the terms themselves, because the terms are what the scorer
is matching. A scorer holding an SI knows within a second whether it says
"Preliminary series" or "qualifying series", and that is the one thing about
their event they can answer without understanding anything about ours.

**This answer is a filter, not a setting.** It narrows page 2 and nothing
else; the format chosen there carries its own words and wins. That is
deliberate: the vocabulary is decided by the format in every surveyed case, so
offering it as a setting alongside the format lets a scorer contradict the
format they are about to choose. Asking it *first*, as recognition, gets the
value of the question without the contradiction.

Two honest limits, both worth stating rather than discovering:

- **It does not halve the list today.** One tabulated format uses the second
  dialect and five use the first. The question earns its place as recognition
  and as the right wording to lead with, not as list reduction — and the
  second dialect grows as the 2026 rewrites land.
- **The escape is a link, not a third option.** Two Moth hosts published
  sailing instructions with no split clause at all, and those scorers have no
  dialect to recognise. The link unfilters page 2 rather than adding a third
  radio nobody with a document would pick.

---

## Page 2 — Which format?

```
┌─ How is this championship scored?                          2 of 3 ─┐
│                                                                    │
│  Which format?                                                     │
│                                                                    │
│  Named for the championships that sail them. Pick the one your     │
│  notice of race describes — you will read it back as sailing       │
│  instructions on the next page before anything is saved.           │
│                                                                    │
│  ●  ILCA World/European Championship                               │
│     One continuous series, then a short final series for the top   │
│     ten on a halved score.                                         │
│       ● 2026 onward   ○ Through 2025                               │
│                                                                    │
│  ○  IODA (Optimist) Championship                                   │
│     One continuous series throughout, no deciding race.            │
│                                                                    │
│  ○  Two series added together (29er and similar)                   │
│     Each stage scored as its own series with its own discards.     │
│                                                                    │
│  ○  First-stage position carried forward (470, Topper)             │
│     A boat carries her position, not her scores.                   │
│                                                                    │
│  ○  One fleet, no split, with a deciding race                      │
│     Champions' Cup, Junior. The fleet is never divided.            │
│  ─────────────────────────────────────────────────────────────     │
│  ○  Start fully custom                                             │
│     Nothing is decided for you. For an event that matches none     │
│     of the above.                                                  │
│                                                                    │
│                                    [ ← Back ]  [ Next → ]          │
└────────────────────────────────────────────────────────────────────┘
```

**Class names, not families.** A scorer knows they are scoring an ILCA
championship; they do not know their event is a continuous-points format with
a compressed carry. Grouping by mechanism is a taxonomy we have and they
don't. The one-line description under each name does the sorting work a
grouping would, and reads as a confirmation rather than a category.

**Eras nest under their class.** ILCA's 2026 rewrite ships alongside the
2021–25 regime, which past championships are still rebuilt from; the 470 and
the skiffs are heading the same way. Nesting the era as a secondary choice
keeps the list at one row per class as the era count grows, which is what
stops this page needing groups at eight or ten formats. If it ever does grow
past that, the answer is a type-to-filter field, not headings.

**Order is by how often Sail Scoring will meet them** — the survey's priority
argument, not alphabetical.

**Fully custom is a format named Custom**, set below a rule: `origin.format`
is `custom`, every setting is visible on the card from the start, nothing is
hidden and there is no drift chip because there is nothing to drift from. It
is not the same thing as unlocking a real format, and the two do not
collapse into one another — unlocking keeps the origin, which is what makes
the diff and the per-setting restore possible.

**The fleet count is not asked here.** It is the event's, and the Format card
can show the arithmetic that makes it a real decision — *141 entries → 3
fleets of 47* — which this dialog, opening before a single competitor is
imported, cannot. A format whose split is `none` is the exception: it has one
fleet by construction, and the card states that rather than offering it.

---

## Page 3 — Read it back

```
┌─ How is this championship scored?                          3 of 3 ─┐
│                                                                    │
│  ILCA World/European Championship (2026 onward)                    │
│  This is how it reads as sailing instructions.                     │
│                                                                    │
│  Underlined  is yours to set — everything else is what this        │
│  format decides.                                                   │
│                                                                    │
│  1. The championship will be sailed as a Qualification series      │
│     followed by the Final series.                                  │
│  2. The Qualification series will be divided into a Preliminary    │
│     series and an Elimination series.                              │
│  3. For the purposes of these instructions, races in the           │
│     Preliminary series and the Elimination series will be          │
│     numbered  Q1, Q2 and so on , continuing through both; races    │
│     in the Final series,  F1, F2 and so on .                       │
│  4. Boats will be assigned to  three  Preliminary fleets           │
│     ( Yellow, Blue and Red ) of, as nearly as possible, equal      │
│     size and ability.                                              │
│     …                                                              │
│  9. A boat's series score will be the total of her race scores,    │
│      excluding her worst score when 3 or more races have been      │
│      completed, and her two worst when 10 or more .                │
│     …                                                              │
│                                                                    │
│  Read this against the scoring section of your sailing             │
│  instructions. Where it disagrees, you can change any settled      │
│  value afterwards, one at a time.                                  │
│                                                                    │
│                              [ ← Back ]  [ Use this format ]       │
└────────────────────────────────────────────────────────────────────┘
```

**The smaller set is marked.** Eleven of sixteen sentences are settled by the
format outright, so marking those would wash out the list this page exists to
have read. What is marked is what remains the scorer's — a dotted underline and
a token background, so the mark is not hue alone.

**The marking is slot-level from the start.** Not one sentence in the
translation is written by event settings alone: every sentence a scorer has
any hand in mixes the format's prose with an event-chosen number inside it.
Sentence-level marking would mark the whole list fixed and say nothing. See
the configuration reference for how the attribution works — each span carries
the setting that wrote it, and the sentence-to-setting map is derived from
that rather than kept beside it.

**Where the dialect contradicts the format**, this page says so and offers the
one unlock it already knows might be wanted:

> You said your document writes *qualifying series* and *final series*. This
> format's own instructions write *Preliminary* and *Elimination*. — **Use my
> document's words instead**

That is an ordinary per-setting unlock on `vocabulary`, taken early because
the dialog is the one moment we know the scorer has both documents in front of
them.

**The Format card's own translation panel is unchanged.** It already marks the
sentences the setting under the pointer writes, and a second marking over the
same list — fixed against yours — would be two meanings in one channel. The
fixed/yours marking is this page's; the card answers *which sentence does this
checkbox govern*, which is a different question and the only one worth asking
once the settings are in front of you.

---

## The Format card afterwards

```
Format            ILCA World/European Championship (2026 onward) · 2 changes
                                                       [ Change format… ]

  ▸ What this format decides   7 settings, 2 changed

  Preliminary fleets        [ 3 — Yellow, Blue, Red            ▾ ]
                            141 entries → Yellow 47, Blue 47, Red 47.
                            Boats are reassigned by series rank after
                            each day of racing.

  What the notice board     [ Q1 … Q5, then Q6, then F1        ▾ ]
  calls the races

  Days and races per day    [ 6 days · 2 a day                   ]

  Finish sheets             [ One per race, all fleets on it    ▾ ]

  Discards                  Exclude [1] score from [3] races
                            Exclude [2] scores from [10] races

  Boats in the Final series [ 10 ]
```

Beside it, the sailing-instruction translation, exactly as today.

The chip — *2 changes* — is a button, and it opens the panel with the changed
settings listed first. Where `origin.formatVersion` is behind the current
build it reads *corrected since you chose it* instead, because a difference is
then not attributable to the scorer and saying it is would be a lie the
scorer cannot check.

### What this format decides

```
  ▾ What this format decides                          7 settings, 2 changed

    Words the stages go by    Preliminary / Elimination / Final series
                                                                  Change

    How scores carry          One continuous series               Change

    How boats are divided     Near-equal fleets by rank           Change

    Discard caps              At most one from the Elimination series,
                              and never a lone Elimination series race
                                                                  Change

  ! Non-finisher scores       Boats in her own Elimination fleet, plus one
                              The format scores these from the largest
                              Preliminary fleet.        Restore · Re-lock

    …
```

Read-only rows of the settled values in words, not controls. `Change` turns
one row into its live control in place and records it on `origin.unlocked`;
the row stays open from then on, because a scorer who deliberately took a
setting back should not have to find it twice.

**Per-setting, never a global unlock.** D9's scenario is always one clause:
the sailing instructions say something different about the carry, or the
finals base, or the split. A single "unlock everything" button both
overshoots and reads as a warning, which is the wrong tone for the thing a
scorer will legitimately need in the middle of a championship.

**Unlocking and changing are separate facts.** An unlocked row whose value
still agrees with the format is not a change and does not appear in the chip's
count; `Re-lock` is offered on exactly those rows. A row whose value differs
carries `Restore`, which puts the format's value back — this is the "undo the
diff, one setting at a time" that the whole arrangement is for — and re-locking
is not offered while it differs, because re-locking would hide a value that
disagrees with the name on the card, which is the one thing this design must
never do.

---

## Once racing has started

`Change format…` goes as soon as any race has a finish, replaced by a line
saying why:

> Racing has started, so the format is settled. Individual settings can still
> be changed below — a sailing instruction that turns out to differ is what
> that is for.

Per-setting unlock stays, and is the point: the Topper and Optimist cases are
both discoveries made with the event underway. Two exceptions keep the
existing `locked` behaviour, which is genuine immutability rather than a
default worth defending — the fleet count and the carry model would re-deal or
re-score fleets that have already sailed, so those rows read as statements
whether or not they are unlocked.

Every unlock, change and restore after the first finish is an activity-log
entry. A championship whose scoring changed mid-week needs that to be
answerable afterwards, and it is the same trail every round mutation already
leaves.

---

## On published pages

Nothing changes. The published results already carry the translation folded
away — the sentences and nothing else — and that is the complete, self-describing
truth about how the event was scored.

No format name and no drift chip. Naming the format on a published page would
assert that a real event is or is not a faithful ILCA championship, which is
an editorial claim about someone else's sailing instructions that we are in no
position to make. The chip answers *did I change something I did not mean
to*, and that is a question only the scorer has.

---

## Open UX questions

1. Does the era sub-choice belong under the class name, or should an era
   appear as its own row once a class has three of them? Nesting is right at
   two; it may read as a hidden option at three.
2. The discard ladder is an event parameter, so a format change takes the new
   format's ladder. Should page 3 name that explicitly — *this format's usual
   ladder is one from three races* — when the ladder it replaces was edited by
   hand, or is the prose on that page enough?
3. Where should the assignment preview put `reassignmentTieOrder`? It is
   offered here as a control that appears with the tie it settles; that has
   not been drawn.
