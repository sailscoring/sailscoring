# Constructed Course Builder

App integration of the course-cards format (#437, ORC M7): building a race's
sequence of legs from a club's course card and the race-day geometry, instead
of hand-computing distances and bearings.

**Status: draft.** First pass at the design; expect iteration before any code.

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
  `courses.sailscoring.ie` with a `catalogue.json`.

The gap between them is entirely manual: a scorer with the card in front of
them, a course number signalled from the committee boat, a start line position
and a laid windward mark, and a calculator. That is what this builds.

## What the scorer is actually doing

Three kinds of fact, with three different lifetimes:

| Fact | Lifetime | Source |
|---|---|---|
| Marks and their fixed positions; the numbered courses | The season | The club's course card (external data) |
| Where the line was, where the laid marks went | One race (HYC re-lays between races) | The committee boat's log |
| Which course each start sailed, and the wind on it | One start | The board / VHF |

The builder's job is to keep these separate and let each be entered once. The
common HYC case is: *set the day's geometry once, then pick a number per
start.* The common DBSC case is: *every mark is fixed, so pick a number and
you are done.*

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

The two rules that fall out of it:

1. **The stored record is the resolved course, not a card reference.** The app
   persists the waypoints it computed from — mark id, label, position, side,
   passing — alongside the legs. A published result must stay reproducible
   after the club re-issues its card, and a published page must draw the course
   without reaching for a release that may have moved. The card pointer
   (`set/card/courseId` + release version) rides along as provenance and as the
   key for reopening the picker; it is never the thing scoring depends on.
2. **Legs stay editable.** Everything the builder does is a way of *filling in*
   the leg table. A scorer who splits a leg on a wind shift, or nudges a
   distance to match the RC's own figure, keeps that edit; the builder marks
   the course "edited" rather than silently recomputing over it, and offers an
   explicit "recompute from the course" when the geometry changes.

## The scenarios, against that model

| Scenario | What the scorer supplies |
|---|---|
| Course card where every mark is fixed (DBSC) | Course number. Start line position — or the card's own start, when the set records one. |
| Course + start and finish marks | Course number, two positions |
| Course + start, finish, first upwind | Course number, three positions — the HYC Autumn League case |
| A mark by GPS | Lat/lng, in the degrees-and-decimal-minutes the log is written in (`53° 24.33' N`), decimal degrees accepted |
| A mark as bearing + distance from another | Origin mark, bearing, distance (m or NM) — the library's `destination`. "1,000 m upwind of the line on 190°" is how a laid windward mark is actually recorded |
| Reuse the day's geometry across starts | Nothing: geometry lives on the race, and the starts of that race share it. Between races of the same day, "copy from the previous race" |
| A course as an ad-hoc mark sequence | Pick marks from the card's mark list in order, each with a side; no course number |
| Shorten a course | Drop trailing waypoints; finish at the mark shortened at, or at a finish position |
| Extend a course | Append waypoints, or repeat a lap of the sequence |

Two of these need format work upstream rather than app work:

- **Longer/shorter courses for different fleets in one start sequence** is the
  normal club pattern (Class 1 sails 041, Class 3 sails 040). It falls out
  free: different starts, same geometry, different course numbers.
- **The wind direction** is not on the card and not derivable from the
  geometry, but HYC's three-digit course ids encode the first beat's bearing
  (first two digits × 10) — so picking course `190` should propose 190° as the
  wind. That convention is per-club and currently lives only in the
  `course-cards` README prose. Proposal: an optional `courseIdEncoding` on the
  card file describing it, so the app can offer the number without hard-coding
  a club's habit. Otherwise the wind is typed once per start and written into
  every leg.

## Screens

Two surfaces, not one, matching the two lifetimes:

**Race geometry — the race record dialog** (`r` on the race page, already
"conditions, course, who ran the race"). A "Course geometry" block: the card
this race uses, a position for the start line and for each mark the card marks
as laid-per-race, and a "copy from race N" button. Each position entry takes
either coordinates or a bearing/distance from another mark, and shows the
resolved coordinates either way. Nothing here is required — a race whose card
has only fixed marks needs a start position and nothing else.

**Course per start — the race-start dialog.** Where the leg table is today:

```
Course      [ 041  ▾ ]  Z · W · C · H · S(p) · F        [ Edit legs ]
            6 legs · 7.70 NM · wind 190°
            ┌──────────────────────────────────┐
            │        (course drawing)          │
            └──────────────────────────────────┘
```

Picking a number resolves the legs and draws them. `Edit legs` reveals today's
three-column table, pre-filled, which is also the whole UI when there is no
card. Shorten/extend/ad-hoc live behind the mark sequence: it is a chip row,
and clicking it opens the sequence editor (add mark, drop tail, repeat lap).

The nudge already on the dialog — "Constructed-course scoring needs the course
legs below" — grows a second clause when a card is available but the race has
no geometry: it should say *what is missing*, by name ("no position for Z
(Upwind of Start Line)"), which is exactly what the library's `CourseError`
already says.

## The drawing

The sanity check is the point: a mistyped longitude has to look wrong. So the
drawing needs bearings and distances on the legs, and the marks in their real
relative positions, and not much else.

- **One renderer, two surfaces.** Promote the repo's `tools/card-html.ts`
  drawing into the published library as a pure `renderCourseSvg(...)` returning
  standalone, script-free SVG. The app renders it in the builder; the results
  renderer embeds the same string in the published page. No client-side map
  library, no runtime tile fetching, no dependency on an external origin from a
  published page.
- **No chart background in the first cut.** Marks, legs, leg labels, a north
  arrow and a scale bar on a plain ground. Hot-linking OSM tiles from published
  pages is against their tile policy, and per-race tile capture is a project of
  its own. A later refinement is nearly free: each `course-cards` data set
  already ships a captured `map/background.png` with bounds, so a course that
  falls inside its set's bounds can be drawn on the club's own chart with the
  set's attribution.

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
exactly where it is and keeps its current meaning. Both are new persistent
fields, so: series file version bump, public-export carriage, Drizzle columns,
validation schemas.

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

A series names the cards it uses (usually one; HYC's Autumn League uses two,
offshore and inshore, by class). When a series has two, the start's picker
chooses card *and* number.

## The CommonJS worry, spiked and closed

`@sailscoring/course-cards` is ESM-only (`"type": "module"`); this repo is
CommonJS throughout and must stay that way, since Vercel's Next launcher breaks
on a root `type: module`. The worry was that a `tsx scripts/` path could not
`require` the library, leaving no option but to vendor the geometry functions.

Spiked against the published `0.1.0` on Node 24.20, with one import site in
`lib/` consumed from all four surfaces. Three passed: `next build` traced
`dist/geo.js` and `dist/legs.js` into the server chunk, Vitest ran, `tsc`
was happy. Only `tsx` failed, with `ERR_PACKAGE_PATH_NOT_EXPORTED`.

The ESM-ness was never the obstacle. `require(esm)` has been unflagged since
Node 22.12 and nothing in `dist/` uses top-level await, so the module loads
through `require()` unchanged. What failed was resolution one step earlier: the
package's `exports` map declared only an `import` condition, so CommonJS
resolution found no match for the bare specifier. Bundlers and Vitest resolve
through `import`, which is why only the plain-Node path showed it.

Fixed upstream in `course-cards` 0.1.1 by adding the `require` condition, with
a `check:cjs` guard that resolves the bare specifier in CI and again against
the packed artifact before publishing. **Depend on `^0.1.1` and the whole
matrix is green.** Vendoring is off the table.

One trap for anyone developing against a local checkout: `pnpm add
@sailscoring/course-cards@link:../course-cards` makes Turbopack fail with
`Module not found`, because the symlink target is outside the consuming
project's root. `tsx`, Vitest and `tsc` all resolve a `link:` dependency fine,
so the build is the only place it shows.

## Open questions

1. **Geometry on the race, or on the day?** Proposed: on the `Race`, with
   copy-forward, because HYC re-lays the windward mark between races and a
   race is one start sequence. A day-level record would be fewer keystrokes for
   DBSC, where nothing moves, but DBSC needs no geometry at all beyond the
   line.
2. **Does the start line get a position from the card?** DBSC's line is fixed
   (the hut, the committee vessel station); the format has no place for it, and
   every course would resolve with no race-day input at all if it did. Add
   `startLine` to the marks file, or make it a mark like any other with a
   `placement`?
3. **Recompute semantics.** When the geometry changes after legs were edited,
   is the offer per-start ("recompute course") or a race-level "3 starts use
   this geometry — recompute all"?
4. **Ad-hoc sequences without a card at all.** Worth supporting a bare list of
   typed positions (a passage race round headlands with no card), or is raw leg
   entry the right answer there?
5. **Shortened courses and the finish.** Shortening at a rounding mark means
   the finish is *at* that mark; shortening on a leg means a finish line laid
   somewhere along it. Does the builder need the second case, or is trimming
   the tail and adjusting the last leg's distance enough?
6. **Scope of the first cut.** Everything here is post-Autumn-League. The
   minimum that earns its keep is: pick a card, pick a number, three positions,
   legs filled, drawing. Ad-hoc sequences, shorten/extend, and the workspace
   card tier are separable follow-ups.

## Feature checklist notes

Gated behind the existing `orc` key (or its own `course-library` key, if the
builder should be usable by non-ORC series — a scratch or IRC series has no use
for legs, so probably not). Needs: an e2e covering pick-course → legs filled,
unit tests for position parsing (DDM) and the resolve/recompute rules,
a help section in the scoring chapter, a feature-inventory row and a shot, and
a `series-file.ts` version bump with public-export carriage.
