# Constructed Course Builder

App integration of the course-cards format (#437, ORC M7): building a race's
sequence of legs from a club's course card and the race-day geometry, instead
of hand-computing distances and bearings.

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

## Three kinds of fact

| Fact | Lifetime | Source |
|---|---|---|
| Marks and their fixed positions; the numbered courses | The season | The club's course card (external data) |
| Where the line was, where the laid marks went | One race (HYC re-lays between races) | The committee boat's log |
| Which course each start sailed, and the wind on it | One start | The board / VHF |

Keeping these apart is the whole design: each is entered once, at its own
grain. The common HYC case is *set the race's geometry once, then pick a number
per start*; the common DBSC case is *every mark is fixed, so pick a number and
you are done*.

## The model

```
  course card (external, versioned)      race geometry (app data, per race)
   marks + numbered courses                 start line, finish, laid marks
              \                                    /
               \                                  /
                v                                v
              resolved course  (waypoints in order, each with a position)
                                |
                                |  + wind direction (per course, per leg override)
                                v
                    RaceStart.courseLegs  — scored, published, editable
```

Two rules fall out of it:

1. **The stored record is the resolved course, not a card reference.** The app
   persists the waypoints it computed from — mark id, label, position, side,
   passing — alongside the legs. A published result must stay reproducible
   after the club re-issues its card, and a published page must draw the course
   without reaching for a release that may have moved. The card pointer
   (`set/card/courseId` + release version) rides along as provenance and as the
   key for reopening the picker; it is never what scoring depends on.
2. **Legs stay editable.** Everything the builder does is a way of *filling in*
   the leg table. A scorer who splits a leg on a wind shift, or nudges a
   distance to match the RC's own figure, keeps that edit: the course is marked
   edited rather than silently recomputed, and recomputing is an explicit
   offer.

## What each scenario asks of the model

| Scenario | What the scorer supplies |
|---|---|
| Course card where every mark is fixed (DBSC) | Course number. Start line position — or the card's own start, when the set records one. |
| Course + start and finish marks | Course number, two positions |
| Course + start, finish, first upwind | Course number, three positions — the HYC Autumn League case |
| A mark by GPS | Lat/lng, in the degrees-and-decimal-minutes the log is written in, decimal degrees accepted |
| A mark as bearing + distance from another | Origin mark, bearing, distance — the library's `destination`. "1,000 m upwind of the line on 190°" is how a laid windward mark is actually recorded |
| Reuse the day's geometry across starts | Nothing: geometry lives on the race, and the starts of that race share it. Between races of the same day, copy forward |
| A course as an ad-hoc mark sequence | Marks from the card's mark list in order, each with a side; no course number |
| Shorten a course | Drop trailing waypoints; finish at the mark shortened at, or at a finish position |
| Extend a course | Append waypoints, or repeat a lap of the sequence |

Longer and shorter courses for different fleets in one start sequence — Class 1
sailing 041 while Class 3 sails 040 — is the normal club pattern and falls out
free: same race, same geometry, different course numbers per start.

## What the card format still owes us

Two of the scenarios want work in `course-cards` rather than the app:

- **The wind direction** is not on the card and is not derivable from the
  geometry, but HYC's three-digit course ids encode the first beat's bearing
  (first two digits × 10) — so picking course `190` should propose 190° as the
  wind. That convention is per-club and currently lives only in the repo's
  README prose. Proposal: an optional `courseIdEncoding` on the card file
  describing it, so the app can offer the number without hard-coding one club's
  habit. Otherwise the wind is typed once per start and written into every leg.
- **The start line.** DBSC's line is fixed — the hut, the committee vessel
  station — and if the card knew it, a DBSC course would resolve with no
  race-day input at all. The format has no place for it today. Either add a
  `startLine` to the marks file, or let the line be a mark like any other with
  a `placement`.

## Data model sketch

Deliberately small, and additive:

```ts
/** A position as recorded, keeping how it was given. */
type MarkPosition =
  | { lat: number; lng: number }
  | { fromMark: string; bearingDeg: number; distanceM: number };  // resolved on read

/** Race-day geometry: where the line and the laid marks were. On the Race —
 *  one start sequence shares it — and copied forward between races. */
interface RaceCourseGeometry {
  card?: { set: string; cardId: string; release: string };   // provenance
  start?: MarkPosition;
  marks?: Record<string, MarkPosition>;    // mark id → where it was laid
}

/** What a start sailed, beside the legs it produced. */
interface RaceStartCourse {
  courseId?: string;                        // absent for an ad-hoc sequence
  waypoints: Array<{                        // the resolved course, self-contained
    mark?: string; label: string;
    lat: number; lng: number;
    side?: 'port' | 'starboard'; passing?: boolean;
  }>;
  windDirectionDeg?: number;                // the course-level wind
  legsEdited?: boolean;                     // legs no longer match the waypoints
}
```

`Race.courseGeometry` and `RaceStart.course`, both sparse; `courseLegs` stays
where it is and keeps its current meaning. Both are new persistent fields, so:
series file version bump, public-export carriage, Drizzle columns, validation
schemas.

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

A series names the cards it uses — usually one, though HYC's Autumn League uses
two, offshore and inshore, by class. When a series has two, the start's picker
chooses card *and* number.

## Open questions

1. **Geometry on the race, or on the day?** Proposed: on the `Race`, with copy
   forward, because HYC re-lays the windward mark between races and a race is
   one start sequence. A day-level record would be fewer keystrokes for DBSC,
   where nothing moves — but DBSC needs no geometry beyond the line anyway.
2. **Does the start line come from the card?** See above; it is a format
   question with a real payoff for fixed-line clubs.
3. **Recompute semantics.** When the geometry changes after legs were edited,
   is the offer per-start, or race-level ("3 starts use this geometry")?
4. **Ad-hoc courses with no card at all.** Worth supporting a bare list of
   typed positions (a passage race round headlands), or is raw leg entry the
   right answer there?
5. **Shortened courses and the finish.** Shortening at a rounding mark means
   the finish is *at* that mark; shortening on a leg means a line laid somewhere
   along it. Does the builder need the second case, or is trimming the tail and
   adjusting the last leg's distance enough?
6. **Scope of the first cut.** All of this is post-Autumn-League. The minimum
   that earns its keep: pick a card, pick a number, three positions, legs
   filled, drawing. Ad-hoc sequences, shorten/extend, and the workspace card
   tier are separable follow-ups.

## Feature checklist notes

Gated behind the existing `orc` key, or its own `course-library` key if the
builder should serve non-ORC series — a scratch or IRC series has no use for
legs, so probably not. Needs: an e2e covering pick-course → legs filled, unit
tests for coordinate parsing and the resolve/recompute rules, a help section in
the scoring chapter, a feature-inventory row and a shot, and a `series-file.ts`
version bump with public-export carriage.
