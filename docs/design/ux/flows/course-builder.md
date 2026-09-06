# Constructed Course Builder Flow

UX for building the courses an ORC race was scored over: the marks the race
committee laid, the courses made from them and a club's course card, and how a
start gets one. It replaces hand-computing distances and bearings into the leg
table.

Context: #437 (ORC M7). The model behind these screens — what is stored, what
is derived, what the card format still owes — is
[`docs/design/orc/course-builder.md`](../../orc/course-builder.md).

**Status: draft.** Expect iteration before any code.

---

## Design priorities, in order

1. **This is ORC's extra work, and it looks like it.** Constructed courses
   exist because ORC scores over them; no other system in the app has any use
   for a leg. So the whole thing lives in one place a scorer visits *because
   they are scoring ORC*, and nothing about it leaks into the screens every
   other series uses. A scratch or IRC series never sees a mark, a course or a
   leg.
2. **One kind of thing, not a hierarchy.** Marks and courses are named objects
   a scorer makes and re-uses. Nothing is "race data" versus "start data" —
   a distinction that is tidy on paper and unpredictable in the head of someone
   who scores twice a season. A start picks a course; that is the only
   relationship to remember.
3. **Build once, use many times.** A five-start sequence will not have five
   courses; it will have two or three. Making the second one must be
   duplicate-and-swap-a-mark, not a re-run of the first one's data entry.
4. **Make a wrong number look wrong.** The scorer is transcribing coordinates
   from a VHF call or a photo of the committee boat's log. A drawing that
   redraws as they type catches a dropped digit that no validation rule will.
5. **Never trap the scorer behind the card.** The three-column leg table stays
   reachable and editable throughout. A club with no card, a passage race, an
   RC that hands over its own distances — all still work exactly as today.

---

## Where it lives

A **Courses** tab on the series, beside Competitors / Races / Standings, shown
only when a fleet in the series scores ORC. It holds two libraries:

- **Marks** — everything with a position. Marks that came from a course card
  (fixed, read-only) and marks the scorer created for a race day: the line, the
  finish, the laid windward marks.
- **Courses** — named sequences of those marks, each resolving to a set of
  legs. Made from a card's numbered course, or built by hand.

Everywhere else, the only trace is one line on the race start dialog: which
course this start sailed.

The mark and course libraries are the same idea as the logo library: a
built-in tier that arrives with the app (the course cards published at
`courses.sailscoring.ie`), and the scorer's own entries on top of it.

---

## Courses tab

```
Series ▸ Courses                                 [+ New mark]  [+ New course]

Course card   [ HYC Autumn League 2025 — offshore  ▾ ]   180 courses · 14 marks

MARKS
  From the card
    I   Island          53° 24.70' N  006° 04.36' W    conical, black
    W   Waverider       53° 22.94' N  006° 03.11' W    spherical, yellow
    …  11 more                                                    [ Show all ]
  This series
    Start — 6 Sep       53° 24.33' N  006° 04.05' W    ⋯
    Z outer — 6 Sep R2  53° 23.74' N  006° 04.21' W    0.54 NM @ 190° from Start
    Z inner — 6 Sep R2  53° 23.98' N  006° 04.14' W    0.32 NM @ 190° from Start
    F — 6 Sep           53° 24.51' N  006° 04.23' W    ⋯

COURSES
  004 outer — 6 Sep R2      Start › Z outer › W › C › H › S(p) › F   7.70 NM   ⋯
  004 inner — 6 Sep R2      Start › Z inner › W › C › H › S(p) › F   7.26 NM   ⋯
  003 — 6 Sep R2            Start › Z inner › W › S(p) › F           4.91 NM   ⋯
```

Each row's `⋯` offers *Edit*, *Duplicate*, *Delete* — and on a course,
*Swap a mark…*, which is the fastest path to the second course of a race.

Names are the reuse key, so the app proposes them and the scorer edits: a mark
created while a race is open is offered `Z — 6 Sep R2`, a course made from card
course 004 is offered `004 — 6 Sep R2`. The qualifiers a scorer actually needs
(*inner*, *outer*, *inshore*) are theirs to add; the date and race are ours.

---

## New mark

```
┌─ New mark ────────────────────────────────────────────────────┐
│ Name        [ Z outer — 6 Sep R2                            ] │
│                                                               │
│ Position    ( ) Coordinates    (•) Bearing & distance         │
│                                                               │
│             from  [ Start — 6 Sep ▾ ]                         │
│             [ 190 ]°   [ 0.54 ] NM ▾                          │
│             → 53° 23.74' N  006° 04.21' W                     │
│                                                               │
│             ┌──────────────────────────────┐                  │
│             │      (marks drawing)         │                  │
│             └──────────────────────────────┘                  │
│                                            [Cancel]   [Save]  │
└───────────────────────────────────────────────────────────────┘
```

- **Two ways to give a position.** Coordinates, or a bearing and distance from
  a mark already in the library — the second is how a laid windward mark is
  logged ("1,000 m upwind of the line on 190°"), and the unit selector takes
  metres, cables or miles.
- **Coordinates are read the way the log is written.** Degrees and decimal
  minutes with or without symbols (`53 23.740 N`, `53° 23.740' N`), and decimal
  degrees (`53.39566, -6.07025`). Whatever is typed, the canonical rendering is
  echoed underneath, so a transposed digit shows before the dialog closes.
- **The drawing shows the new mark among the ones already there**, which is
  where a mistyped longitude announces itself.

---

## New course

```
┌─ New course ──────────────────────────────────────────────────┐
│ From        (•) A course on the card    ( ) Build by hand     │
│             [ 004 ▾ ]   Z › W › C › H › S(p) › F              │
│                                                               │
│ Marks       Start   [ Start — 6 Sep       ▾ ]                 │
│             Z       [ Z outer — 6 Sep R2  ▾ ]  ← needs one    │
│             F       [ F — 6 Sep           ▾ ]  ← needs one    │
│             W, C, H, S come from the card                     │
│                                                               │
│ Name        [ 004 outer — 6 Sep R2                          ] │
│                                                               │
│             6 legs · 7.70 NM              [ Edit sequence… ]  │
│             ┌──────────────────────────────┐                  │
│             │      (course drawing)        │                  │
│             └──────────────────────────────┘                  │
│                                            [Cancel]   [Save]  │
└───────────────────────────────────────────────────────────────┘
```

Picking a card course lists exactly the marks it cannot place itself — the
line, and whatever the card describes as laid per race — each a dropdown over
the library with *New mark…* at the bottom, so a missing mark is created
without losing the half-built course. A club whose marks are all fixed (DBSC)
answers one question, the line, and is done.

*Build by hand* starts from an empty sequence: the same editor, no card course,
no number.

### Edit sequence

```
┌─ 004 outer — 6 Sep R2 · sequence ─────────────────────────────┐
│  1  Z outer — 6 Sep R2   leave [ port ▾ ]  ( ) passing   [×]  │
│  2  W  Waverider         leave [ port ▾ ]  ( ) passing   [×]  │
│  3  C  Cush              leave [ port ▾ ]  ( ) passing   [×]  │
│  4  H  Howth Sound       leave [ port ▾ ]  ( ) passing   [×]  │
│  5  S  South Rowan       leave [ stbd ▾ ]  (•) passing   [×]  │
│  6  F — 6 Sep            leave [ port ▾ ]  ( ) passing   [×]  │
│                                                               │
│  [+ Add mark ▾]  [Repeat marks 1–4]        [Shorten at… ▾]    │
│                                                               │
│  Shortened at C — the finish is at the mark.                  │
│                                            [Cancel]   [Done]  │
└───────────────────────────────────────────────────────────────┘
```

One editor covers the rest of the scenarios:

- **Shorten** — pick the mark shortened at; the rows after it drop and the
  course finishes there.
- **Extend** — *Repeat marks 1–4* appends another lap; *Add mark* appends
  anything in the mark library.
- **By hand** — add marks in order into an empty sequence.

A course edited away from the card's own sequence keeps the number for
provenance and says so: `004 (modified)`.

---

## The race start dialog

The whole of the builder's footprint outside the Courses tab:

```
Course      [ 004 outer — 6 Sep R2  ▾ ]              [ New course… ]
            6 legs · 7.70 NM · wind [ 190 ]°

            ┌────────────────────────────────────┐
            │        (course drawing)            │
            └────────────────────────────────────┘

            ▸ Legs (6)
```

- **The picker lists the series' courses**, most recently used first — with
  five starts to get through, the second start is two clicks and the third is
  one. *New course…* opens the same dialog as the tab and returns with the new
  course selected.
- **The wind** is one field for the whole course, written into every leg. It
  belongs to the start, not the course: the same marks get re-used across a
  day, the breeze does not. Where a card declares an id encoding, picking a
  course pre-fills it (HYC's `190` → 190°).
- **Legs** is today's three-column table, collapsed behind a disclosure and
  pre-filled from the course above it. Opening it and typing is always allowed;
  splitting a leg on a wind shift happens here, as it does now.

### Worked example — the five-start Saturday

Race 2, five classes, two windward marks laid inner and outer:

1. **Courses ▸ New mark**, four times: `Start — 6 Sep`, `F — 6 Sep`,
   `Z outer — 6 Sep R2`, `Z inner — 6 Sep R2` (the two Zs as bearing and
   distance from the line, which is how they were laid and logged).
2. **New course** from card course 004, picking `Z outer` → save as
   `004 outer — 6 Sep R2`.
3. On that course, **Swap a mark…** → `Z outer` for `Z inner`, saved as a
   duplicate → `004 inner — 6 Sep R2`.
4. Class 3 sails a shorter card course: **New course** from 003 → `003 — 6 Sep
   R2`. Same marks, no re-typing.
5. Five starts, each picking one of three courses from the dropdown.

Race 3 that afternoon, marks unmoved, is entirely picking: the courses are
already there. If the RC re-lays the windward mark, it is one new mark and one
*Swap a mark…* per course.

---

## The drawing

A sanity check, not a chart, with one job: a coordinate that went in wrong
should be obviously wrong at a glance.

- Marks at their real relative positions, labelled.
- Legs in order, numbered, each carrying its bearing and distance.
- A north arrow and a scale bar — without them a rotated mental image passes
  for correct.
- The scorer's own marks visually distinct from the card's fixed ones: they are
  checking what they typed, not what the club published.
- Redraws as positions and sequences are edited, in every dialog that has one.

A course whose first leg runs 40 miles offshore is unmistakable at this size;
that is the whole requirement.

---

## States

| State | What the scorer sees |
|---|---|
| Series scores no ORC fleet | No Courses tab, no course line on the start — nothing changes anywhere |
| No card selected | The tab still works: marks and courses can be built by hand. The card is a convenience, not a precondition |
| Course needs a mark that does not exist | The New course dialog says which, by the card's own words — "Z (Upwind of Start Line)" — with *New mark…* in place |
| Start with no course | Course line reads *Not recorded*; the leg table is reachable and is the whole UI, exactly as today |
| Legs edited by hand | Badge on the course line — *legs edited* — the drawing keeps showing the course, and *Recompute from course* discards the edits after saying so |
| A mark used by courses is edited | The courses using it are listed in the confirm ("3 courses use this mark"); starts already scored keep their legs until recomputed |
| Read-only series | Tab renders as lists and pictures; no pickers, no editors |

---

## Keyboard

Per the feature checklist the Courses tab registers its page-level actions
through `useShortcuts` — new mark, new course — so the `?` dialog lists them.
Within the dialogs: pickers are type-to-filter with `Enter` to choose, the
sequence editor moves between rows with the arrow keys, and everything closes
on `Esc` and saves on `Ctrl`/`Cmd` + `Enter`, matching the other race dialogs.

---

## On published pages

The drawing is the published course record, embedded as static SVG beside the
existing PCS audit line (legs, implied wind, scoring wind). A competitor
checking their track against the course sees the same picture the scorer
checked. Nothing on the page is interactive and nothing is fetched from
elsewhere.

---

## Open UX questions

1. ~~**Do the libraries belong to the series or the workspace?**~~ Decided
   (September 2026): **the series.** The card is the only cross-series tier;
   a club's fixed marks come back into each series from it. Whether weekly
   racing wants a season-spanning library is a question for after a season
   of use.
2. **How much naming should be automatic?** The proposal auto-fills date and
   race and leaves the qualifier to the scorer. The alternative — structured
   fields (date, race, variant) rather than a name — is more predictable and
   less writable. Names win on the reuse screen; fields win on the entry one.
3. **Does the tab need a race filter?** After eight race days a series has
   thirty marks and twenty courses. Most-recently-used ordering may be enough;
   grouping by date may not be.
4. **One drawing or two?** A course drawing and a mark-library drawing are the
   same picture with different emphasis. Worth building one component that
   takes a highlight, rather than two.
5. **Is the drawing large enough at dialog width?** If not, the sanity check
   may want an expanded view rather than an inline panel.
