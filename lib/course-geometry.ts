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
  type DrawnCourseMark,
  type DrawnMark,
  type Position,
} from '@sailscoring/course-cards';

import { chartSetCovering, chartSetHoldingMost } from './course-cards';
import type { OrcCourseLeg, RaceStart, RaceStartCourse, RaceStartCourseLeg } from './types';

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
  legs: readonly RaceStartCourseLeg[],
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
 * A course's legs drawn: walked from an arbitrary origin, so the shape and
 * the orientation are the committee's own and the position on the water is
 * not claimed at all. Nothing here is stored — the legs have no positions,
 * and inventing some to keep would be a fiction the published page would go
 * on repeating.
 *
 * Given an `anchor` — where the first leg starts, the one position a course
 * may carry — the walk starts there instead, and the drawing is on the
 * water. The points after it are still only where the legs lead, and are
 * not stored either.
 *
 * `closureNm` is how far the last leg ends from where the first began. A
 * table rounded to a tenth of a mile does not close exactly, so this is a
 * figure to read rather than an error to flag — but a course with a leg
 * missing or a digit dropped will not close by anything like a rounding.
 */
export function drawnLegTable(legs: readonly RaceStartCourseLeg[], anchor?: Position): {
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

/** The positions a start's course is known by: the anchor its first leg
 *  starts from, where it has one. What its magnetic variation is read at;
 *  empty where there is none. */
export function startCoursePositions(course: RaceStartCourse | undefined): Position[] {
  return course?.anchor ? [course.anchor] : [];
}

/** What a start's drawing is, and where it sits. */
export interface DrawnStartCourse {
  marks: DrawnMark[];
  course: DrawnCourseMark[];
  /** Walked from a recorded anchor, so on the water: every point after
   *  the first is still only where the legs lead. */
  anchored?: boolean;
  /** The data set whose chart the course sits on. */
  set?: string;
}

/**
 * What a start scored, drawn: its legs, walked from where the first of them
 * starts where the course says, on the chart that covers where they lead —
 * preferring `preferredSet` where more than one does. The legs are the ones
 * scored, edited or not, so the drawing never contradicts the legs and total
 * printed beside it; a course with none scored yet draws the legs it gave.
 * Null when there is nothing to draw.
 */
export function drawnRaceStartCourse(
  course: RaceStartCourse | undefined,
  courseLegs: readonly RaceStartCourseLeg[] | undefined,
  preferredSet?: string,
): DrawnStartCourse | null {
  const legs = courseLegs?.length ? courseLegs : course?.legs;
  if (!legs?.length) return null;
  const { marks, course: sequence } = drawnLegTable(legs, course?.anchor);
  if (!course?.anchor) return { marks, course: sequence };
  const set = chartSetCovering(marks.map((m) => m.position), preferredSet);
  return { marks, course: sequence, anchored: true, ...(set ? { set } : {}) };
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
