# Constructed Course Builder Flow

UX for building a race's course from a club's course card instead of typing
distances and bearings: where the scorer enters the race-day geometry, how a
start gets its course number, and how the course is drawn back at them so a
mistake is visible.

Context: #437 (ORC M7). The model behind this screen — what is stored, what is
derived, what the card format still owes — is
[`docs/design/orc/course-builder.md`](../../orc/course-builder.md).

**Status: draft.** Expect iteration before any code.

---

## Design priorities, in order

1. **Enter each fact once, at its own grain.** The card is the season's; the
   line and the laid marks are the race's; the course number is the start's.
   Re-typing a windward mark for each of four starts is the failure this
   screen exists to remove.
2. **Make a wrong number look wrong.** The scorer is transcribing coordinates
   from a VHF call or a photo of the committee boat's log. A drawing that
   redraws as they type catches a dropped digit that no validation rule will.
3. **Never trap the scorer behind the card.** The three-column leg table stays
   reachable and editable at all times. A club with no card, a passage race, an
   RC that gives its own distances — all still work exactly as they do today.
4. **Say what is missing, by name.** "No position for Z (Upwind of Start Line)"
   is actionable at the committee boat; "course incomplete" is not.

---

## Entry points

Two, matching the two lifetimes:

| Where | What it sets | Grain |
|---|---|---|
| Race record dialog (`r` on the race page — already "conditions, course, who ran the race") | The card, the start line, the laid marks | Per race |
| Race start dialog | The course number, the wind, the legs | Per start |

A scorer who never opens the first one gets today's behaviour: an empty course
line on the start, and the leg table.

---

## Race record dialog — course geometry

A block below conditions. Shown when the series has a card selected, or when
some fleet scores ORC; collapsed to one line until there is something to say.

```
┌─ Race record · Race 3 ────────────────────────────────────────┐
│ Wind          [ 12 ]–[ 18 ] kt   [ SW ▾ ]                     │
│                                                               │
│ Course card   [ HYC Autumn League 2025 — offshore  ▾ ]        │
│                                                               │
│ Where the marks were                    [ Copy from race 2 ]  │
│                                                               │
│   Start line   ( ) Coordinates  (•) Bearing & distance        │
│                from [ I — Island ▾ ]  [ 190 ]°  [ 0.42 ] NM   │
│                → 53° 24.33' N  006° 04.05' W                  │
│                                                               │
│   Z  Zephyr    (•) Coordinates  ( ) Bearing & distance        │
│    (Upwind of  [ 53 23.740 N ] [ 006 04.215 W ]               │
│     Start Line)                                               │
│                                                               │
│   F  Finish    (•) Coordinates  ( ) Bearing & distance        │
│                [                ] [                ]  not set │
│                                                               │
│ Officials     …                                               │
│                                            [Cancel]   [Save]  │
└───────────────────────────────────────────────────────────────┘
```

Notes on the rows:

- **Only the marks that need one appear.** The card's marks with fixed
  positions are not listed; a mark the card describes as laid per race is,
  labelled with the club's own words for where it goes.
- **Two ways to give a position, per mark.** Coordinates, or a bearing and
  distance from another mark — the second is how a laid windward mark is
  actually logged ("1,000 m upwind of the line on 190°").
- **Coordinates are read in the format the log is written in.** Degrees and
  decimal minutes with or without symbols (`53 23.740 N`, `53° 23.740' N`),
  and decimal degrees (`53.39566, -6.07025`). Whatever is typed, the row echoes
  back the canonical rendering underneath, so a transposed digit shows up
  before the dialog closes.
- **Copy from race N** fills every position from the previous race of the same
  day — the DBSC case where nothing moved, and the HYC case where only the
  windward mark did.

---

## Race start dialog — the course

Replacing the bare leg table that is there today:

```
Course      [ 041 ▾ ]   Z › W › C › H › S(p) › F        [ Edit sequence ]
            6 legs · 7.70 NM · wind [ 190 ]°

            ┌────────────────────────────────────┐
            │                                    │
            │        (course drawing)            │
            │                                    │
            └────────────────────────────────────┘

            ▸ Legs (6)
```

- **The number picker** is a searchable list of the card's course ids — typing
  `041` gets there directly, which matters on a card with 128 of them. Each
  entry shows its mark sequence so the right column of the card can be
  recognised, not just remembered.
- **The wind** is one field for the whole course, written into every leg. Where
  the card declares an id encoding, picking a number pre-fills it (HYC's `190`
  → 190°) and the field stays editable.
- **The sequence chips** are the course as sailed; `(p)` marks a passing mark.
  Clicking through to *Edit sequence* is how a course is shortened, extended or
  built from nothing.
- **Legs** is today's three-column table, collapsed behind a disclosure and
  pre-filled from the drawing above it. Opening it and typing is always
  allowed; splitting a leg on a wind shift happens here, as it does now.

### Edit sequence

```
┌─ Course 041 — sequence ───────────────────────────────────────┐
│  1  Z   Zephyr          leave [ port ▾ ]   ( ) passing   [×]  │
│  2  W   Waverider       leave [ port ▾ ]   ( ) passing   [×]  │
│  3  C   Cush            leave [ port ▾ ]   ( ) passing   [×]  │
│  4  H   Howth Sound     leave [ port ▾ ]   ( ) passing   [×]  │
│  5  S   South Rowan     leave [ stbd ▾ ]   (•) passing   [×]  │
│  6  F   Finish          leave [ port ▾ ]   ( ) passing   [×]  │
│                                                               │
│  [+ Add mark ▾]   [Repeat marks 1–4]        [Shorten at… ▾]   │
│                                                               │
│  Shortened at C — the finish is at the mark.                  │
│                                            [Cancel]   [Done]  │
└───────────────────────────────────────────────────────────────┘
```

One editor covers three of the scenarios:

- **Shorten** — pick the mark shortened at; the rows after it drop, and the
  course finishes there.
- **Extend** — *Repeat marks 1–4* appends another lap; *Add mark* appends any
  mark from the card.
- **Ad-hoc** — start from an empty sequence and add marks in order. The course
  then has no number, and the start's course line reads the sequence itself.

Editing away from the card's own sequence keeps the number for provenance but
labels it: `041 (modified)`.

---

## The drawing

It is a sanity check, not a chart, and it has one job: a coordinate that went
in wrong should be obviously wrong at a glance.

- Marks at their real relative positions, each labelled with its id.
- Legs drawn in order, numbered, each carrying its bearing and distance.
- A north arrow and a scale bar — without them a rotated mental image passes
  for correct.
- The start line and the laid marks visually distinct from the card's fixed
  marks: the scorer is checking what they typed, not what the club published.
- It redraws as positions are edited, in the race record dialog as well as on
  the start.

A course whose first leg runs 40 miles offshore is unmistakable at this size;
that is the whole requirement.

---

## States

| State | What the scorer sees |
|---|---|
| No card selected for the race | Course line reads *No course card* with a link to pick one; the leg table is the whole UI, exactly as today |
| Card selected, no geometry | *Pick a course* is available; picking one reports what it needs by name — "Course 041 needs a position for Z (Upwind of Start Line)" — with a link straight to the race record dialog |
| Course resolved | Sequence, leg count, total distance, drawing |
| Legs edited by hand | Badge on the course line — *legs edited* — and the drawing keeps showing the resolved course; a *Recompute from course* action discards the edits, and says so before it does |
| Geometry changed after resolving | The affected starts show *out of date*; recomputing is offered per start |
| Read-only series | The course line, sequence and drawing render as text and picture; no picker, no editor |

The nudge already on the start dialog — "Constructed-course scoring needs the
course legs below" — becomes the first row of this table rather than a separate
mechanism.

---

## Keyboard

Per the feature checklist, the course picker gets a `ShortcutSpec` through
`useShortcuts` on the race page, so the `?` dialog lists it. Within the
dialogs: the number picker is type-to-filter with `Enter` to choose; the
sequence editor moves between rows with the arrow keys; both close on `Esc` and
save on `Ctrl`/`Cmd` + `Enter`, matching the other race dialogs.

---

## On published pages

The drawing is the published course record, embedded as static SVG beside the
existing PCS audit line (legs, implied wind, scoring wind). A competitor
checking their track against the course sees the same picture the scorer
checked. Nothing on the page is interactive and nothing is fetched from
elsewhere.

---

## Open UX questions

1. **Does the geometry belong in the race record dialog, or on its own?** It
   fits the "what happened at this race" framing, but that dialog is reached
   from the finish-entry header and is currently a quick note-taking surface.
   A course with four laid marks is a heavier thing to put behind it.
2. **Where does a series choose its card?** Series settings is the obvious
   home, but HYC's Autumn League runs two cards by class, which makes it a
   per-race or per-start choice with a series-level default.
3. **How much of the card should the picker show?** The mark sequence is
   probably enough; the club's course-selection notes (which the format
   carries) may be worth a link rather than a panel.
4. **Is the drawing large enough at dialog width?** If not, the sanity check
   may want its own expanded view rather than an inline panel.
