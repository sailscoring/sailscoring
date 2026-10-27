/**
 * The arithmetic of a race start's constructed course (ORC rule 402.5):
 * filling its leg table at the course's wind, telling whether the legs are
 * still the ones the course gave, and drawing what the start scored. Pure
 * and client-safe; the geometry itself is the course-cards library's.
 */

import {
  METRES_PER_NM,
  destination,
  distanceNm as positionsApartNm,
  legsFromWaypoints,
  routedLegsFromWaypoints,
  type CourseLeg,
  type DrawnCourseMark,
  type DrawnLineEnd,
  type DrawnMark,
  type Position,
  type RoutingFile,
  type Waypoint,
} from '@sailscoring/course-cards';

import { chartSetCovering, chartSetHoldingMost } from './course-cards';
import { courseRoutingFor } from './course-cards/routing';
import type {
  OrcCourseLeg,
  RaceStart,
  RaceStartCourse,
  RaceStartCourseLineEnd,
  RaceStartCourseWaypoint,
  SeriesCourseLeg,
} from './types';

function toLibraryWaypoint(w: RaceStartCourseWaypoint): Waypoint {
  return {
    mark: w.markId ?? w.label,
    label: w.label,
    position: { lat: w.lat, lng: w.lng },
    ...(w.ends ? { line: 'midpoint' as const } : {}),
  };
}

/**
 * The legs a course's waypoints sail. Where its marks came from a data set
 * with a routing overlay, a leg the overlay routes round an obstruction is
 * the legs actually sailed through the passage's waypoints — Ringabella to
 * Cage by W2 and Rams Head, not across the headland — and every leg says
 * whether the overlay vouches for it. Elsewhere the legs are straight lines,
 * and claim nothing.
 *
 * The overlay names marks by the card's ids. An adopted mark's label is
 * its card id; a mark the scorer laid for a card course is known by the
 * card mark it stands for there, whatever it is called ("Grassy Start" is
 * SL); and a laid mark on a course with no card behind it, by the name it
 * was proposed under ("SL — 6 Sep R2" is SL). It is the overlay's own
 * position check that makes a verdict hold, not the name: a line laid away
 * from where the overlay assumed it, or a mark renamed into something else,
 * leaves its legs straight and unreviewed.
 */
function waypointLegs(waypoints: RaceStartCourseWaypoint[]): CourseLeg[] {
  const overlay = courseRoutingFor(drawingSet(waypoints));
  if (!overlay) return legsFromWaypoints(waypoints.map(toLibraryWaypoint));
  const points = waypoints.map((w): Waypoint => ({
    mark: w.cardMarkId ?? w.label,
    label: w.label,
    position: { lat: w.lat, lng: w.lng },
    ...(w.ends ? { line: 'midpoint' as const } : {}),
  }));
  return routedLegsFromWaypoints(points, overlay.routing, [...overlay.turnAt, ...points]);
}

/** The legs of a snapshot's waypoints — the same arithmetic as resolveCourse,
 *  over positions frozen when the start picked the course. */
export function legsOfWaypoints(waypoints: RaceStartCourseWaypoint[]): CourseLeg[] {
  return waypointLegs(waypoints);
}

const round = (n: number, dp: number): number => Math.round(n * 10 ** dp) / 10 ** dp;

/**
 * A leg's distance as ORC records it: to 0.01 NM (rule 401.3, "when the
 * length of the course is needed for calculation of corrected time, it shall
 * be recorded to a precision of 0.01 NM"), which is also what ORC Scorer
 * holds and what the app has always displayed. Every leg reaching storage
 * goes through here, so the figure a results page prints is the figure the
 * performance curve was read at.
 */
export function legDistance(nm: number): number {
  return round(nm, 2);
}

/** Fill a start's leg table: each leg's distance to 0.01 NM and bearing to
 *  0.1°, with the one wind the scorer gave for the whole course — its
 *  direction always, and its speed where the option scores at the wind the
 *  race committee recorded. Per-leg overrides and sub-legs are then edits to
 *  the table itself. */
export function legsForStart(
  legs: readonly SeriesCourseLeg[],
  windDirectionDeg: number,
  windSpeedKts?: number,
): OrcCourseLeg[] {
  return legs.map((leg) => ({
    distanceNm: legDistance(leg.distanceNm),
    bearingDeg: round(leg.bearingDeg, 1),
    windDirectionDeg,
    ...(windSpeedKts != null ? { windSpeedKts } : {}),
  }));
}

/** Do a start's legs still match what its course gives, to the precision
 *  legsForStart writes? Sub-legs, a nudged distance, or a per-leg wind all
 *  say no: the scorer edited the table, and a recompute would discard it.
 *  Distances compare at the precision they are recorded to, so a table
 *  filled when the app wrote thousandths is still the course's own. */
export function legsMatch(legs: OrcCourseLeg[], fromCourse: OrcCourseLeg[]): boolean {
  if (legs.length !== fromCourse.length) return false;
  return legs.every((leg, i) => {
    const c = fromCourse[i];
    return (
      legDistance(leg.distanceNm) === legDistance(c.distanceNm) &&
      Math.abs(((leg.bearingDeg - c.bearingDeg + 540) % 360) - 180) < 0.15 &&
      leg.windDirectionDeg === c.windDirectionDeg &&
      leg.windSpeedKts === c.windSpeedKts &&
      leg.currentSpeedKts == null &&
      leg.currentDirectionDeg == null
    );
  });
}

/**
 * How a start's legs read on the wind speed they were scored at: one figure
 * where every leg shares it, a range where they don't, and the fact that one
 * is missing where the course is short of what a recorded-wind option needs.
 * Null when no leg carries a speed at all — the ordinary case, and the one
 * performance-curve scoring is in.
 */
export function recordedWindSummary(legs: OrcCourseLeg[] | undefined): string | null {
  if (!legs || legs.length === 0) return null;
  const speeds = legs.map((leg) => leg.windSpeedKts).filter((kt): kt is number => kt != null && kt > 0);
  if (speeds.length === 0) return null;
  if (speeds.length < legs.length) return 'wind speed missing';
  const lo = Math.min(...speeds);
  const hi = Math.max(...speeds);
  return lo === hi ? `${lo} kt` : `${lo}–${hi} kt`;
}

// ─── Drawing ─────────────────────────────────────────────────────────────────

/**
 * A leg table drawn: its legs walked from an arbitrary origin, so the shape
 * and the orientation are the committee's own and the position on the water
 * is not claimed at all. Nothing here is stored — a course defined by legs
 * has no positions, and inventing some to keep would be a fiction the
 * published page would go on repeating.
 *
 * Given an `anchor` — where the first leg starts, the one position an
 * imported course may carry — the walk starts there instead, and the
 * drawing is on the water. The points after it are still only where the
 * legs lead, and are not stored either.
 *
 * `closureNm` is how far the last leg ends from where the first began. A
 * table rounded to a tenth of a mile does not close exactly, so this is a
 * figure to read rather than an error to flag — but a course with a leg
 * missing or a digit dropped will not close by anything like a rounding.
 */
export function drawnLegTable(legs: readonly SeriesCourseLeg[], anchor?: Position): {
  marks: DrawnMark[];
  course: DrawnCourseMark[];
  closureNm: number;
} {
  // Mid-latitude so the projection behaves; which point is immaterial, and
  // the drawing shows no coordinates.
  let at: Position = anchor ? { lat: anchor.lat, lng: anchor.lng } : { lat: 53.5, lng: -6.1 };
  const marks: DrawnMark[] = [{ id: 'p0', label: 'Start', position: at }];
  for (const [i, leg] of legs.entries()) {
    at = destination(at, leg.bearingDeg, leg.distanceNm * METRES_PER_NM);
    marks.push({
      id: `p${i + 1}`,
      label: i === legs.length - 1 ? 'Finish' : String(i + 1),
      position: at,
    });
  }
  return {
    marks,
    course: marks.map((m) => ({ mark: m.id })),
    closureNm: legs.length > 0 ? positionsApartNm(marks[0].position, at) : 0,
  };
}

/** An entry of a course to draw, with the card mark it stands for where a
 *  laid mark stands for one — the name a routing overlay knows it by. */
export type RoutableCourseMark = DrawnCourseMark & { cardMarkId?: string };

/** The positions a start's course is known by: its waypoints, or on a
 *  course defined by legs, the anchor its first leg starts from. What its
 *  magnetic variation is read at; empty where there are none. */
export function startCoursePositions(course: RaceStartCourse | undefined): Position[] {
  if (!course) return [];
  if (course.waypoints.length > 0) return course.waypoints.map((w) => ({ lat: w.lat, lng: w.lng }));
  return course.anchor ? [course.anchor] : [];
}

/** What a start's drawing is, and where it sits. */
export interface DrawnStartCourse {
  marks: DrawnMark[];
  course: RoutableCourseMark[];
  /** Drawn by walking legs rather than from recorded positions. */
  fromLegs: boolean;
  /** Walked from a recorded anchor, so on the water: every point after
   *  the first is still only where the legs lead. */
  anchored?: boolean;
  /** The data set whose chart the course sits on. */
  set?: string;
}

/** Legs drawn as a table, from the anchor where there is one, on the chart
 *  that covers where they lead. */
function drawnLegs(legs: readonly SeriesCourseLeg[], anchor: Position | undefined, preferredSet?: string): DrawnStartCourse {
  const { marks, course } = drawnLegTable(legs, anchor);
  if (!anchor) return { marks, course, fromLegs: true };
  const set = chartSetCovering(marks.map((m) => m.position), preferredSet);
  return { marks, course, fromLegs: true, anchored: true, ...(set ? { set } : {}) };
}

/**
 * A start's snapshot drawn, whichever kind of course it came from: the
 * waypoints where it has any, and otherwise the leg table walked from its
 * anchor or an arbitrary origin. `fromLegs` says which, because a drawing
 * built from legs has to be captioned as one — it is not the same artefact
 * as a course drawn from surveyed marks, and on a published page the two
 * would be indistinguishable. `set` is the data set whose chart the course
 * sits on: where its marks came from one, or where an anchored course's
 * legs lead, preferring `preferredSet` where both cover it.
 */
export function drawnStartCourse(snapshot: RaceStartCourse, preferredSet?: string): DrawnStartCourse {
  if (snapshot.waypoints.length === 0 && (snapshot.legs?.length ?? 0) > 0) {
    return drawnLegs(snapshot.legs!, snapshot.anchor, preferredSet);
  }
  const set = drawingSet(snapshot.waypoints);
  return { ...drawnSnapshot(snapshot), fromLegs: false, ...(set ? { set } : {}) };
}

/**
 * What a start scored, drawn. The course snapshot is where the legs came
 * from, but `courseLegs` is what was scored — and once the scorer has edited
 * them (pasted the committee's table over a picked course, split a leg) or
 * typed them with no course at all, the marks no longer describe the race.
 * Those legs then draw as a leg table, captioned as one, so the drawing never
 * contradicts the legs and total printed beside it. Null when there is
 * nothing to draw.
 */
export function drawnRaceStartCourse(
  snapshot: RaceStartCourse | undefined,
  courseLegs: readonly SeriesCourseLeg[] | undefined,
  preferredSet?: string,
): DrawnStartCourse | null {
  if (courseLegs && courseLegs.length > 0 && (!snapshot || snapshot.legsEdited)) {
    // An anchor is where the first leg starts whatever was done to the legs
    // after, so edited legs are still walked from it.
    return drawnLegs(courseLegs, snapshot?.anchor, preferredSet);
  }
  return snapshot ? drawnStartCourse(snapshot, preferredSet) : null;
}

/**
 * The chart a series' anchored courses are drawn on where more than one
 * covers a course: the one that holds the most of them whole, passed as the
 * preferred set wherever one of them is drawn. Without it a course that
 * happens to fit a closer-in chart would leave the page's other races for
 * it, and the page would carry both. Undefined where no chart holds any.
 */
export function seriesChartSet(starts: readonly Pick<RaceStart, 'course' | 'courseLegs'>[]): string | undefined {
  const courses = starts.flatMap((s) => {
    const anchor = s.course?.anchor;
    const legs = s.courseLegs?.length ? s.courseLegs : s.course?.legs;
    return anchor && legs?.length ? [drawnLegTable(legs, anchor).marks.map((m) => m.position)] : [];
  });
  return chartSetHoldingMost(courses);
}

/**
 * A drawing made ready for the set's routing overlay, where it has one, so
 * the renderer draws a leg the overlay routes through the passage's
 * waypoints, as the legs the course is scored on. The overlay names marks by
 * the card's ids, so each mark is drawn under the card mark it stands for on
 * the course, or else its label, where that is unambiguous (a library mark's
 * id is a UUID; `highlight` follows it); and a
 * mark a passage turns at that the drawing doesn't hold — W2, on the way
 * from Ringabella to Cage — is added, as the club's charted mark it is.
 *
 * `legCount` is how many legs the drawing has once routed, so a caller
 * holding legs already scored can tell whether the drawing would agree with
 * them: a start scored before the overlay reached the app has the straight
 * legs, and a drawing that routed them would contradict its own leg table.
 */
export function routedDrawing(
  marks: DrawnMark[],
  course: RoutableCourseMark[],
  set: string | undefined,
  highlight?: string,
): { marks: DrawnMark[]; course: DrawnCourseMark[]; highlight?: string; routing?: RoutingFile; legCount: number } {
  const overlay = courseRoutingFor(set);
  const pairs = (byId: Map<string, DrawnMark>, sequence: DrawnCourseMark[]) =>
    sequence.slice(1).flatMap((entry, i) => {
      const a = byId.get(sequence[i].mark);
      const b = byId.get(entry.mark);
      return a && b ? [[a, b] as const] : [];
    });
  if (!overlay) {
    return {
      marks,
      course,
      ...(highlight ? { highlight } : {}),
      legCount: pairs(new Map(marks.map((m) => [m.id, m])), course).length,
    };
  }
  const standsFor = new Map<string, string>();
  for (const entry of course) if (entry.cardMarkId) standsFor.set(entry.mark, entry.cardMarkId);
  const nameOf = (m: DrawnMark) => standsFor.get(m.id) ?? m.label;
  const nameCount = new Map<string, number>();
  for (const m of marks) nameCount.set(nameOf(m), (nameCount.get(nameOf(m)) ?? 0) + 1);
  const ids = new Set(marks.map((m) => m.id));
  const idOf = new Map(marks.map((m) => {
    const name = nameOf(m);
    return [m.id, nameCount.get(name) === 1 && (name === m.id || !ids.has(name)) ? name : m.id];
  }));
  const drawn = marks.map((m) => ({ ...m, id: idOf.get(m.id)! }));
  const sequence = course.map(({ cardMarkId: _, ...entry }) => ({ ...entry, mark: idOf.get(entry.mark) ?? entry.mark }));
  const present = new Set(drawn.map((m) => m.id));
  const point = (m: DrawnMark): Waypoint => ({ mark: m.id, label: m.label, position: m.position });
  const turnAt = [...overlay.turnAt.filter((w) => !present.has(w.mark)), ...drawn.map(point)];
  let legCount = 0;
  const used = new Set<string>();
  for (const [a, b] of pairs(new Map(drawn.map((m) => [m.id, m])), sequence)) {
    const legs = routedLegsFromWaypoints([point(a), point(b)], overlay.routing, turnAt);
    legCount += legs.length;
    for (const leg of legs) {
      for (const w of [leg.from, leg.to]) if (!w.routing && !present.has(w.mark)) used.add(w.mark);
    }
  }
  const added = overlay.turnAt
    .filter((w) => used.has(w.mark))
    .map((w): DrawnMark => ({ id: w.mark, label: w.label, position: w.position, fixed: true }));
  const shown = highlight ? idOf.get(highlight) ?? highlight : undefined;
  return {
    marks: [...drawn, ...added],
    course: sequence,
    ...(shown ? { highlight: shown } : {}),
    routing: overlay.routing,
    legCount,
  };
}

/**
 * Which data set's chart a drawing belongs on: the set most of its charted
 * marks came from. Usually there is only one — a series adopts one club's
 * card — and a course over two clubs' marks is drawn on whichever it uses
 * more of, because one chart is the most that can be under it.
 */
export function drawingSet(waypoints: Pick<RaceStartCourseWaypoint, 'set'>[]): string | undefined {
  const counts = new Map<string, number>();
  for (const w of waypoints) if (w.set) counts.set(w.set, (counts.get(w.set) ?? 0) + 1);
  let best: string | undefined;
  for (const [set, n] of counts) if (best === undefined || n > counts.get(best)!) best = set;
  return best;
}

/** One end of a line as the renderer draws it: a club's charted mark is a
 *  buoy; of the ends the race committee laid, the starboard one is drawn as
 *  the committee boat it usually is, and the port one as the pin. */
function drawnLineEnd(e: RaceStartCourseLineEnd): DrawnLineEnd {
  return {
    position: { lat: e.lat, lng: e.lng },
    label: e.label,
    kind: !e.fixed && e.end === 'starboard' ? 'vessel' : 'buoy',
  };
}

/** A start's snapshot as the renderer takes it: the waypoints stand on
 *  their own, so a repeated mark is one drawn mark visited twice. Positions
 *  only — a course defined by legs has none, and draws through
 *  `drawnStartCourse`. */
export function drawnSnapshot(snapshot: RaceStartCourse): { marks: DrawnMark[]; course: RoutableCourseMark[] } {
  const marks = new Map<string, DrawnMark>();
  const course: RoutableCourseMark[] = [];
  snapshot.waypoints.forEach((w, i) => {
    // A line is drawn once per pair of ends: the start line and a finish
    // line off the same committee boat are two lines.
    const id = w.ends
      ? `line\0${w.ends.map((e) => e.markId ?? `${e.lat},${e.lng}`).join('\0')}`
      : w.markId ?? `${w.label}\0${w.lat}\0${w.lng}\0${i}`;
    if (!marks.has(id)) {
      marks.set(id, {
        id,
        label: w.label,
        position: { lat: w.lat, lng: w.lng },
        ...(w.fixed ? { fixed: true } : {}),
        ...(w.ends ? { ends: [drawnLineEnd(w.ends[0]), drawnLineEnd(w.ends[1])] as [DrawnLineEnd, DrawnLineEnd] } : {}),
      });
    }
    course.push({
      mark: id,
      ...(w.side ? { side: w.side } : {}),
      ...(w.passing ? { passing: true } : {}),
      ...(w.cardMarkId ? { cardMarkId: w.cardMarkId } : {}),
    });
  });
  return { marks: [...marks.values()], course };
}
