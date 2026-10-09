/**
 * The ORC constructed course format (docs/design/orc/constructed-course-format.md):
 * reading a document an app that builds courses hands over, and turning it
 * into what a race start stores.
 *
 * A document is one course as ORC rule 402.5 defines it — each leg's
 * distance and course, the wind direction, and optionally the recorded wind
 * speed and the current — in degrees magnetic, with at most one position:
 * where the first leg starts. A reader refuses what it cannot read as the
 * producer meant it (an unknown version, a north other than magnetic) and
 * ignores fields it does not know. The refusals are worded for the scorer
 * holding the document, because they are shown as they stand.
 *
 * The start stores true, so the conversion takes the variation where the
 * course is on the race's day. Pure and client-safe.
 */

import { toTrue, type Variation } from './bearings';
import { legDistance } from './course-geometry';
import type { OrcCourseLeg, RaceStartCourse } from './types';

export const CONSTRUCTED_COURSE_FORMAT = 'orc-constructed-course';
export const CONSTRUCTED_COURSE_VERSION = 1;

/** The most legs a start takes; a course with more is refused rather than
 *  cut short. */
export const MAX_IMPORTED_LEGS = 60;
/** The longest name a start keeps for a course or a leg. */
const MAX_NAME = 80;

/** One leg as the document gives it: degrees magnetic, nautical miles, knots. */
export interface ConstructedCourseLeg {
  name?: string;
  distance: number;
  course: number;
  windDirection?: number;
  windSpeed?: number;
  currentDirection?: number;
  currentSpeed?: number;
}

/** A document that has been read: everything Sail Scoring uses of it. */
export interface ConstructedCourse {
  name?: string;
  anchor?: { lat: number; lng: number };
  legs: ConstructedCourseLeg[];
}

export type ReadConstructedCourse =
  | { ok: true; course: ConstructedCourse }
  | { ok: false; error: string };

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isDirection = (v: unknown): v is number => isNumber(v) && v >= 0 && v <= 360;

/** A name as a start keeps it: trimmed, and shortened where it is longer
 *  than a start's name can be. */
function keptName(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (!s) return undefined;
  return s.length > MAX_NAME ? `${s.slice(0, MAX_NAME - 1)}…` : s;
}

/** Read the text a scorer pasted or the file they picked. */
export function parseConstructedCourse(text: string): ReadConstructedCourse {
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return { ok: false, error: 'This isn’t a course document: it doesn’t read as JSON.' };
  }
  return readConstructedCourse(value);
}

/** Read a document already parsed from JSON. */
export function readConstructedCourse(value: unknown): ReadConstructedCourse {
  const fail = (error: string): ReadConstructedCourse => ({ ok: false, error });
  if (!isObject(value) || value.format !== CONSTRUCTED_COURSE_FORMAT) {
    return fail(`This isn’t an ORC constructed course: it doesn’t say "format": "${CONSTRUCTED_COURSE_FORMAT}".`);
  }
  if (value.version !== CONSTRUCTED_COURSE_VERSION) {
    return fail(
      isNumber(value.version) && value.version > CONSTRUCTED_COURSE_VERSION
        ? `This course is in version ${value.version} of the format, which is newer than this version of Sail Scoring reads.`
        : 'This course doesn’t say which version of the format it is in.',
    );
  }
  if (value.north !== 'magnetic') {
    return fail(
      typeof value.north === 'string'
        ? `This course measures its directions from "${value.north}" north. The format’s directions are magnetic.`
        : 'This course doesn’t say its directions are magnetic ("north": "magnetic").',
    );
  }

  let anchor: ConstructedCourse['anchor'];
  if (value.anchor !== undefined) {
    const a = value.anchor;
    if (!isObject(a) || !isNumber(a.lat) || !isNumber(a.lng) || Math.abs(a.lat) > 90 || Math.abs(a.lng) > 180) {
      return fail('The anchor isn’t a position: it needs "lat" and "lng" in decimal degrees.');
    }
    anchor = { lat: a.lat, lng: a.lng };
  }

  if (!Array.isArray(value.legs) || value.legs.length === 0) return fail('This course has no legs.');
  if (value.legs.length > MAX_IMPORTED_LEGS) {
    return fail(`This course has ${value.legs.length} legs, and a start takes at most ${MAX_IMPORTED_LEGS}.`);
  }

  const legs: ConstructedCourseLeg[] = [];
  for (const [i, raw] of value.legs.entries()) {
    const at = `Leg ${i + 1}`;
    if (!isObject(raw)) return fail(`${at} isn’t a leg.`);
    if (!isNumber(raw.distance) || raw.distance <= 0 || raw.distance > 999) {
      return fail(`${at} needs a distance in nautical miles, above zero.`);
    }
    if (!isDirection(raw.course)) return fail(`${at} needs a course in degrees, from 0 to 360.`);
    if (raw.windDirection !== undefined && !isDirection(raw.windDirection)) {
      return fail(`${at}’s wind direction isn’t a number of degrees from 0 to 360.`);
    }
    if (raw.windSpeed !== undefined) {
      if (!isNumber(raw.windSpeed) || raw.windSpeed <= 0 || raw.windSpeed >= 100) {
        return fail(`${at}’s wind speed isn’t a number of knots above zero.`);
      }
      if (raw.windDirection === undefined) return fail(`${at} has a wind speed but no wind direction.`);
    }
    if ((raw.currentDirection === undefined) !== (raw.currentSpeed === undefined)) {
      return fail(`${at} gives half a current: the direction and the speed go together.`);
    }
    if (raw.currentDirection !== undefined) {
      if (!isDirection(raw.currentDirection)) {
        return fail(`${at}’s current direction isn’t a number of degrees from 0 to 360.`);
      }
      if (!isNumber(raw.currentSpeed) || raw.currentSpeed < 0 || raw.currentSpeed > 20) {
        return fail(`${at}’s current speed isn’t a number of knots.`);
      }
    }
    const name = keptName(raw.name);
    legs.push({
      ...(name ? { name } : {}),
      distance: raw.distance,
      course: raw.course,
      ...(raw.windDirection !== undefined ? { windDirection: raw.windDirection as number } : {}),
      ...(raw.windSpeed !== undefined ? { windSpeed: raw.windSpeed } : {}),
      ...(raw.currentDirection !== undefined
        ? { currentDirection: raw.currentDirection as number, currentSpeed: raw.currentSpeed as number }
        : {}),
    });
  }

  const withWind = legs.filter((l) => l.windDirection !== undefined).length;
  if (withWind > 0 && withWind < legs.length) {
    return fail('Some legs have a wind direction and some don’t. It goes on every leg or on none.');
  }
  const withSpeed = legs.filter((l) => l.windSpeed !== undefined).length;
  if (withSpeed > 0 && withSpeed < legs.length) {
    return fail('Some legs have a wind speed and some don’t. It goes on every leg or on none.');
  }

  const name = keptName(value.name);
  return { ok: true, course: { ...(name ? { name } : {}), ...(anchor ? { anchor } : {}), legs } };
}

/** The course's length: its legs at the 0.01 NM ORC records them to. */
export function constructedCourseLength(course: ConstructedCourse): number {
  return Math.round(course.legs.reduce((sum, l) => sum + legDistance(l.distance), 0) * 100) / 100;
}

/** "7 legs · 8.11 NM · wind on every leg · current on 2 legs · anchored":
 *  what a document holds, for the scorer to check before using it. */
export function constructedCourseSummary(course: ConstructedCourse): string {
  const n = course.legs.length;
  const parts = [`${n} leg${n === 1 ? '' : 's'}`, `${constructedCourseLength(course).toFixed(2)} NM`];
  const wind = course.legs[0].windDirection !== undefined;
  const speed = course.legs[0].windSpeed !== undefined;
  parts.push(wind ? (speed ? 'wind direction and speed on every leg' : 'wind direction on every leg') : 'no wind');
  const current = course.legs.filter((l) => l.currentDirection !== undefined).length;
  if (current > 0) parts.push(`current on ${current === n ? 'every leg' : `${current} leg${current === 1 ? '' : 's'}`}`);
  parts.push(course.anchor ? 'placed on the water' : 'no position');
  return parts.join(' · ');
}

/** A leg as a start's table takes it: true, the distance to 0.01 NM. The
 *  wind direction is absent where the document carries none, for the
 *  start's own wind to fill. */
export type ImportedLeg = Omit<OrcCourseLeg, 'windDirectionDeg'> & { windDirectionDeg?: number };

/** The document's legs converted to true at the variation where the course
 *  is, on the race's day. */
export function importedCourseLegs(course: ConstructedCourse, variation: Variation): ImportedLeg[] {
  const trueDeg = (deg: number) => toTrue(deg, 'M', variation);
  return course.legs.map((l) => ({
    distanceNm: legDistance(l.distance),
    bearingDeg: trueDeg(l.course),
    ...(l.windDirection !== undefined ? { windDirectionDeg: trueDeg(l.windDirection) } : {}),
    ...(l.windSpeed !== undefined ? { windSpeedKts: l.windSpeed } : {}),
    ...(l.currentDirection !== undefined
      ? { currentSpeedKts: l.currentSpeed!, currentDirectionDeg: trueDeg(l.currentDirection) }
      : {}),
    ...(l.name ? { name: l.name } : {}),
  }));
}

/** The one value every leg shares, where they share one. */
function shared(values: (number | undefined)[]): number | undefined {
  const first = values[0];
  return first !== undefined && values.every((v) => v === first) ? first : undefined;
}

/**
 * The snapshot a start keeps of an imported course: its name, the legs it
 * gave (which an edit to the start's table is measured against), and the
 * anchor. No waypoints and no library course: the document is the course.
 * Where every leg shares one wind, that is the course's wind, as a library
 * course's would be; where they differ there is no one figure to show.
 */
export function snapshotOfImportedCourse(course: ConstructedCourse, legs: ImportedLeg[]): RaceStartCourse {
  const wind = shared(legs.map((l) => l.windDirectionDeg));
  const speed = shared(legs.map((l) => l.windSpeedKts));
  return {
    name: course.name ?? 'Imported course',
    waypoints: [],
    legs: legs.map((l) => ({ distanceNm: l.distanceNm, bearingDeg: l.bearingDeg })),
    ...(course.anchor ? { anchor: course.anchor } : {}),
    ...(wind !== undefined ? { windDirectionDeg: wind } : {}),
    ...(speed !== undefined ? { windSpeedKts: speed } : {}),
  };
}
