/**
 * The charts a course is drawn on: each course-cards data set's capture of
 * its club's water, published at courses.sailscoring.ie and vendored into
 * the app at build time by scripts/sync-course-cards.ts. Where each chart
 * sits is a committed module, so which chart covers a course is known with
 * no network call; a chart's image is fetched on demand from the app's own
 * origin.
 */

import type { CourseBackground, Position } from '@sailscoring/course-cards';

import { COURSE_CARDS_RELEASE, COURSE_CHARTS } from './generated/charts';
import type { CourseChart } from './types';

export { COURSE_CARDS_RELEASE, COURSE_CHARTS };
export type { CourseBackground, CourseChart };

/** The app-hosted URL of a vendored file, relative to the app origin. */
export function courseCardFileUrl(file: string): string {
  return `/course-cards/${file}`;
}

/** A data set's chart, where its release captured one. */
export function findCourseChart(set: string): CourseChart | undefined {
  return COURSE_CHARTS.find((c) => c.set === set);
}

/** A chart as the renderer takes it: the image with the ground it covers. */
export function courseBackgroundOf(chart: CourseChart, png: Uint8Array): CourseBackground {
  return {
    png,
    bounds: chart.placement.bounds,
    width: chart.placement.width,
    height: chart.placement.height,
    attribution: chart.placement.attribution,
  };
}

type Bounds = CourseChart['placement']['bounds'];

const inside = (b: Bounds, p: Position) => p.lat >= b.south && p.lat <= b.north && p.lng >= b.west && p.lng <= b.east;

/**
 * The data set whose chart a course belongs on: one whose captured ground
 * contains the first point (where the course is placed from), and of those
 * the one that holds the most of the rest. A tie goes to `preferred` — the
 * chart the series' other courses sit on — then to the closer-in chart,
 * then to the later set (a newer season of the same water). Undefined where
 * no set captured the water at all.
 */
export function chartSetCovering(points: readonly Position[], preferred?: string): string | undefined {
  if (points.length === 0) return undefined;
  const candidates = COURSE_CHARTS.flatMap((chart, index) => {
    if (!inside(chart.placement.bounds, points[0])) return [];
    const b = chart.placement.bounds;
    return [{
      path: chart.set,
      covered: points.filter((p) => inside(b, p)).length,
      area: (b.north - b.south) * (b.east - b.west),
      index,
    }];
  });
  candidates.sort((a, b) =>
    b.covered - a.covered ||
    Number(b.path === preferred) - Number(a.path === preferred) ||
    a.area - b.area ||
    b.index - a.index,
  );
  return candidates[0]?.path;
}

/**
 * The data set whose chart holds the most of a series' courses, each given
 * by the points it is drawn through: what a course that more than one chart
 * covers is drawn on, so that a page of races sits on one club's water. A
 * tie goes to the closer-in chart, then to the later set, as in
 * {@link chartSetCovering}. Undefined where no chart holds any of them
 * whole.
 */
export function chartSetHoldingMost(courses: readonly (readonly Position[])[]): string | undefined {
  const candidates = COURSE_CHARTS.flatMap((chart, index) => {
    const b = chart.placement.bounds;
    const held = courses.filter((points) => points.length > 0 && points.every((p) => inside(b, p))).length;
    return held > 0 ? [{ path: chart.set, held, area: (b.north - b.south) * (b.east - b.west), index }] : [];
  });
  candidates.sort((a, b) => b.held - a.held || a.area - b.area || b.index - a.index);
  return candidates[0]?.path;
}

const backgroundCache = new Map<string, Promise<CourseBackground | undefined>>();

/**
 * A set's captured chart, fetched from the app's own origin and kept for the
 * session — a few hundred kilobytes that every drawing of that club's water
 * reuses. Undefined for a set that captured none, and for a fetch that
 * fails: a drawing without its chart is the plain one, which is worth more
 * than an error.
 */
export function loadCourseBackground(setPath: string): Promise<CourseBackground | undefined> {
  let p = backgroundCache.get(setPath);
  if (!p) {
    const chart = findCourseChart(setPath);
    p = !chart
      ? Promise.resolve(undefined)
      : fetch(courseCardFileUrl(chart.file))
          .then(async (res) => (res.ok ? courseBackgroundOf(chart, new Uint8Array(await res.arrayBuffer())) : undefined))
          .catch(() => undefined);
    backgroundCache.set(setPath, p);
  }
  return p;
}
