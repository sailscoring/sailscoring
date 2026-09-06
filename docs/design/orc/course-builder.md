# Constructed Course Builder

App integration of the course-cards format (#437, ORC M7): building a race's
sequence of legs from a club's course card and the marks the race committee
laid, instead of hand-computing distances and bearings.

The UX — screens, wireframes, entry affordances, states — is
[`docs/design/ux/flows/course-builder.md`](../ux/flows/course-builder.md).
This doc is the model behind it.

**Status: draft.** First pass; expect iteration before any code.

---

## Where this starts from

Two things already exist, at opposite ends:

- **The app** takes a constructed course as a leg array —
  `RaceStart.courseLegs`, one row per leg of `{distanceNm, bearingDeg,
  windDirectionDeg}` (+ optional current), typed into a three-column table in
  the race-start dialog. That is ORC's own input shape (rule 402.5), it is what
  the engine scores, and it is what published pages record. It is the
  interchange floor and it stays.
- **`sailscoring/course-cards`** holds the versioned format and the library:
  marks (id, name, shape, colour, position or "laid per race"), course cards
  (course id → ordered mark sequence with side and passing/rounding), and
  `courseLegs(card, marks, courseId, racePositions)` returning each leg's
  great-circle distance and true bearing. Six data sets are encoded (HYC AL and
  Brass Monkeys, DBSC Summer, DLCC regattas), released and served from
  `courses.sailscoring.ie` with a `catalogue.json`. The app takes it as an
  ordinary dependency, `@sailscoring/course-cards`.

The gap between them is entirely manual: a scorer with the card in front of
them, a course number signalled from the committee boat, a start line position
and a laid windward mark, and a calculator. That is what this builds.

## Two libraries and a reference

The tempting model — the card is the season's, the geometry is the race's, the
course number is the start's — does not survive contact with a race day. A
committee lays *two* windward marks, inner and outer, and starts five classes
across them; the first two beat to the outer, the rest to the inner. There is
no level at which "the race's windward mark" is a fact.

So there is no hierarchy. There are named objects the scorer makes and re-uses,
and one reference from the thing being scored:

```
   course card (external, versioned)
    marks + numbered courses
              |
              |  fixed marks arrive with it
              v
        MARK LIBRARY  <----  the scorer, as the RC lays them
    Start — 6 Sep · Z inner — 6 Sep R2 · Z outer — 6 Sep R2 · F — 6 Sep
              |
              |  a card course, or a sequence built by hand
              v
       COURSE LIBRARY
    004 outer — 6 Sep R2 · 004 inner — 6 Sep R2 · 003 — 6 Sep R2
              |
              |  RaceStart.course → one of them, + the wind
              v
       RaceStart.courseLegs  — scored, published, editable
```

A start picks a course. That is the only relationship a scorer has to hold in
their head, and it is the one the paperwork already has: the board said 004.

Four rules follow.

1. **The libraries hold references; the start holds a snapshot.** A course
   names its marks, so fixing a mistyped mark position fixes every course built
   on it. But what a start was *scored* over must not change under it: the
   start stores the resolved waypoints and the legs, and the reference to the
   library course is provenance and the key for recomputing. Published results
   stay reproducible when a mark is corrected, a course renamed, or the club
   re-issues its card.
2. **Legs stay editable.** Everything above is a way of *filling in* the leg
   table. A scorer who splits a leg on a wind shift, or nudges a distance to
   match the RC's own figure, keeps that edit: the start is marked edited
   rather than silently recomputed, and recomputing is an explicit offer that
   says what it will discard.
3. **The wind belongs to the start, not the course.** The same marks and the
   same course serve several races of a day; the breeze does not. The course
   supplies distance and bearing, the start supplies the wind direction that
   completes each leg — with per-leg overrides staying where they are, in the
   leg table.
4. **A name is the reuse key.** Every library entry is named, and reuse depends
   on the name being recognisable a fortnight later. The app proposes the parts
   it knows (date, race, card course id); the qualifiers that matter — *inner*,
   *outer*, *inshore* — are the scorer's.

## What each scenario asks of the model

| Scenario | What the scorer supplies |
|---|---|
| Course card where every mark is fixed (DBSC) | One mark (the line), then a course per card number |
| Course + start and finish marks | Two marks, then the course |
| Course + start, finish, first upwind | Three marks, then the course — the HYC Autumn League case |
| A mark by GPS | Lat/lng, in the degrees-and-decimal-minutes the log is written in; decimal degrees accepted |
| A mark as bearing + distance from another | Origin mark, bearing, distance — the library's `destination`. "1,000 m upwind of the line on 190°" is how a laid windward mark is actually recorded |
| Two windward marks, different starts using each | Two marks, two courses differing in one mark, starts picking between them |
| The same course across several starts, or several races | Nothing: the course is in the library, and picking it is one click |
| A course as an ad-hoc mark sequence | Marks from the library in order, each with a side; no card, no number |
| Shorten a course | Duplicate, drop trailing marks; the finish is at the mark shortened at |
| Extend a course | Duplicate, append marks or repeat a lap |

The reuse rows are the point. A five-start sequence has two or three distinct
courses, not five, and each after the first is a duplicate with one mark
swapped.

## What the card format still owes us

Two things want work in `course-cards` rather than the app:

- **The wind direction** is not on the card and is not derivable from the
  geometry, but HYC's three-digit course ids encode the first beat's bearing
  (first two digits × 10) — so picking course `190` should propose 190° as the
  start's wind. That convention is per-club and currently lives only in the
  repo's README prose. Proposal: an optional `courseIdEncoding` on the card
  file describing it, so the app can offer the number without hard-coding one
  club's habit.
- **The start line.** DBSC's line is fixed — the hut, the committee vessel
  station — and if the card knew it, a DBSC course would need no scorer-made
  marks at all. The format has no place for it today. Either add a `startLine`
  to the marks file, or let the line be a mark like any other with a
  `placement`.

## Data model sketch

Two new series-scoped collections, and one reference from the start:

```ts
/** A mark with a position: either the scorer's, or one adopted from the card.
 *  `from` keeps a laid mark as it was logged — a bearing and distance off
 *  another mark — and the position is what that resolves to. */
interface SeriesMark {
  id: string;
  seriesId: string;
  name: string;                       // "Z outer — 6 Sep R2"
  cardMarkId?: string;                // set when it came from the card ("Z")
  lat: number;
  lng: number;
  from?: { markId: string; bearingDeg: number; distanceM: number };
}

/** A named course: marks in sailing order. Distances and bearings are derived
 *  from the marks, never stored here — a corrected mark corrects the course. */
interface SeriesCourse {
  id: string;
  seriesId: string;
  name: string;                       // "004 outer — 6 Sep R2"
  card?: { set: string; cardId: string; courseId: string; release: string };
  modified?: boolean;                 // sequence edited away from the card's
  marks: Array<{
    markId: string;
    side?: 'port' | 'starboard';
    passing?: boolean;
  }>;
}

/** On RaceStart, beside the legs it produced. */
interface RaceStartCourse {
  courseId?: string;                  // the library course, for recompute
  waypoints: Array<{                  // the snapshot: what was actually scored
    markId?: string; label: string;
    lat: number; lng: number;
    side?: 'port' | 'starboard'; passing?: boolean;
  }>;
  windDirectionDeg?: number;
  legsEdited?: boolean;               // legs no longer match the waypoints
}
```

`Series.marks` / `Series.courses` and `RaceStart.course`, all sparse and all
absent from a series with no ORC fleet. `courseLegs` stays where it is and
keeps its current meaning. These are new persistent fields, so: series file
version bump, public-export carriage, Drizzle tables, validation schemas.

The first mark of a course's sequence is the start line like any other mark,
which keeps the sequence uniform; the card's own sequences begin after the
line, so adopting one prepends it.

## Rendering the course

One renderer, two surfaces. Promote the `course-cards` repo's
`tools/card-html.ts` drawing into the published library as a pure
`renderCourseSvg(...)` returning standalone, script-free SVG: the app renders
it in the builder, the results renderer embeds the same string in the published
page. No client-side map library, no runtime tile fetching, no dependency on an
external origin from a published page.

No chart background in the first cut — marks, legs, leg labels, a north arrow
and a scale bar on a plain ground. Hot-linking OSM tiles from published pages
is against their tile policy, and per-race tile capture is a project of its
own. A later refinement is nearly free: each data set already ships a captured
`map/background.png` with bounds, so a course inside its set's bounds can be
drawn on the club's own chart with the set's attribution.

## Getting cards into a workspace

Mirror the logo library's tiers (`logo-library` / `canonical-logos`), which
solved the same problem:

1. **Built-in tier** — the `courses.sailscoring.ie` catalogue. A vendored
   manifest of the available sets (club, event, card ids, counts) so the picker
   renders without a network call; the card JSON itself fetched on demand and
   cached, because DBSC's five cards are 592 courses and do not belong in the
   app bundle.
2. **Workspace tier (later)** — upload a card JSON for a club not in the
   dataset.
3. **The designer (later, its own product)** — draws a card and exports the
   same JSON.

A series names the card it uses — usually one, though HYC's Autumn League runs
two, offshore and inshore, by class, which is an argument for the card being a
property of a course rather than of the series.

## Open questions

1. **Series-scoped or workspace-scoped libraries?** Series is the smaller first
   cut and matches how laid marks are dated. But a club running weekly races
   accumulates `Start — 6 Sep`, `Start — 13 Sep`, … in every series, and the
   fixed marks it keeps re-adopting are workspace facts. A workspace tier under
   the series one is the logo-library shape, and may be the right end state.
2. **What happens to a scored start when its course changes?** Rule 1 says the
   snapshot holds and recompute is explicit. Open: whether the app should
   *notice* — an "out of date" badge on starts whose course moved under them —
   or stay silent and let the scorer recompute when they mean to.
3. **Do courses need the card at all, or just marks?** Everything a course is
   can be expressed as a mark sequence. The card contributes the numbered
   sequences and the fixed marks; a first cut could adopt marks from the card
   and let every course be built by hand, deferring the course-number lookup.
   That is a smaller build but loses the scenario the milestone is named for.
4. **Shortened courses and the finish.** Shortening at a rounding mark means
   the finish is *at* that mark; shortening on a leg means a line laid somewhere
   along it — which in this model is just another scorer-made mark. Is that
   good enough, or does shortening deserve its own affordance?
5. **Scope of the first cut.** All of this is post-Autumn-League. The minimum
   that earns its keep: a mark library, a course from a card number, a start
   picking one, a drawing. Build-by-hand, shorten/extend and the workspace tier
   are separable follow-ups.

## Feature checklist notes

Gated behind the existing `orc` key: constructed courses exist because ORC
scores over them, and the design principle is that a non-ORC series never sees
any of it. Needs: an e2e covering new mark → new course → start picks it →
legs filled, unit tests for coordinate parsing and the resolve/recompute rules,
a help section in the scoring chapter, a feature-inventory row and a shot, and
a `series-file.ts` version bump with public-export carriage.
