import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { toMagnetic, variationAt } from '@/lib/bearings';
import {
  constructedCourseLength,
  constructedCourseSummary,
  importedCourseLegs,
  parseConstructedCourse,
  readConstructedCourse,
  snapshotOfImportedCourse,
  type ConstructedCourse,
} from '@/lib/orc-constructed-course';

/**
 * The ORC constructed course format (docs/design/orc/constructed-course-format.md):
 * what a reader accepts, what it refuses and says why, and how a document
 * becomes a start's legs and snapshot.
 */

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures/orc', name), 'utf-8');

const base = { format: 'orc-constructed-course', version: 1, north: 'magnetic' };
const leg = { distance: 1, course: 10 };

function read(doc: unknown): ConstructedCourse {
  const r = readConstructedCourse(doc);
  if (!r.ok) throw new Error(r.error);
  return r.course;
}

function refusal(doc: unknown): string {
  const r = readConstructedCourse(doc);
  if (r.ok) throw new Error('expected a refusal');
  return r.error;
}

describe('reading a document', () => {
  it("reads ORC's own example course, whose legs add up to the 8.11 NM ORC gives", () => {
    const r = parseConstructedCourse(fixture('constructed-course-rmg-2026.json'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.course.name).toBe('ORC Race Management Guide 2026, §3.2');
    expect(r.course.legs).toHaveLength(7);
    expect(r.course.legs[0]).toEqual({ name: 'Start – 1', distance: 2.09, course: 162, windDirection: 160 });
    expect(constructedCourseLength(r.course)).toBe(8.11);
    expect(constructedCourseSummary(r.course)).toBe('7 legs · 8.11 NM · wind direction on every leg · no position');
  });

  it("reads a course page's document for a Royal Cork race, converted at its anchor", () => {
    const r = parseConstructedCourse(fixture('constructed-course-rcyc-2026-10-04.json'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const course = r.course;
    // The page's own `series` field is not part of the format, and is left behind.
    expect(Object.keys(course).sort()).toEqual(['anchor', 'legs', 'name']);
    expect(course.name).toBe('Autumn League, Sun 4 Oct 2026, Race 1, Start 1');
    expect(course.anchor).toEqual({ lat: 51.78576, lng: -8.240614 });
    expect(course.legs).toHaveLength(7);
    expect(constructedCourseLength(course)).toBe(5.09);
    expect(constructedCourseSummary(course)).toBe('7 legs · 5.09 NM · wind direction and speed on every leg · placed on the water');

    const variation = variationAt(course.anchor!, '2026-10-04');
    const legs = importedCourseLegs(course, variation);
    // Cork Harbour: magnetic north a degree or two west of true.
    expect(variation.deg).toBeLessThan(0);
    expect(variation.deg).toBeGreaterThan(-4);
    for (const [i, l] of legs.entries()) {
      expect(toMagnetic(l.bearingDeg, variation)).toBeCloseTo(course.legs[i].course, 9);
      expect(l.name).toBe(course.legs[i].name);
    }
    const snapshot = snapshotOfImportedCourse(course, legs);
    expect(snapshot.windSpeedKts).toBe(12);
    expect(toMagnetic(snapshot.windDirectionDeg!, variation)).toBeCloseTo(241, 9);
  });

  it("reads every example in the format's own documentation", () => {
    const spec = readFileSync(join(__dirname, '../docs/design/orc/constructed-course-format.md'), 'utf-8');
    const examples = [...spec.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(examples.length).toBeGreaterThan(0);
    for (const text of examples) expect(parseConstructedCourse(text)).toMatchObject({ ok: true });
  });

  it('takes a byte-order mark, as a file saved on Windows may carry', () => {
    expect(parseConstructedCourse(`﻿${JSON.stringify({ ...base, legs: [leg] })}`).ok).toBe(true);
  });

  it('ignores fields it does not know, at the top and on a leg', () => {
    const course = read({ ...base, variation: -3, generator: 'x', legs: [{ ...leg, predefinedNote: 'y' }] });
    expect(course).toEqual({ legs: [{ distance: 1, course: 10 }] });
  });

  it('keeps an anchor, current, and the recorded wind', () => {
    const course = read({
      ...base,
      anchor: { lat: 53.40125, lng: -6.08413 },
      legs: [
        { ...leg, windDirection: 280, windSpeed: 11.5, currentDirection: 5, currentSpeed: 2 },
        { distance: 0.5, course: 200, windDirection: 285, windSpeed: 13 },
      ],
    });
    expect(course.anchor).toEqual({ lat: 53.40125, lng: -6.08413 });
    expect(course.legs[0]).toEqual({ distance: 1, course: 10, windDirection: 280, windSpeed: 11.5, currentDirection: 5, currentSpeed: 2 });
    expect(constructedCourseSummary(course)).toBe(
      '2 legs · 1.50 NM · wind direction and speed on every leg · current on 1 leg · placed on the water',
    );
  });

  it('shortens a name longer than a start keeps', () => {
    const course = read({ ...base, name: 'x'.repeat(100), legs: [{ ...leg, name: `  ${'y'.repeat(100)}` }] });
    expect(course.name).toHaveLength(80);
    expect(course.name!.endsWith('…')).toBe(true);
    expect(course.legs[0].name).toHaveLength(80);
  });
});

describe('refusing a document, and saying why', () => {
  it.each([
    ['text that is not JSON', 'Legs: 2.09 162', /doesn’t read as JSON/],
  ])('%s', (_label, text, message) => {
    const r = parseConstructedCourse(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(message);
  });

  it.each<[string, unknown, RegExp]>([
    ['another format', { ...base, format: 'gpx', legs: [leg] }, /isn’t an ORC constructed course/],
    ['a newer version', { ...base, version: 2, legs: [leg] }, /version 2 of the format, which is newer/],
    ['no version', { format: 'orc-constructed-course', north: 'magnetic', legs: [leg] }, /doesn’t say which version/],
    ['true north', { ...base, north: 'true', legs: [leg] }, /from "true" north/],
    ['no north', { format: 'orc-constructed-course', version: 1, legs: [leg] }, /doesn’t say its directions are magnetic/],
    ['no legs', { ...base, legs: [] }, /has no legs/],
    ['more legs than a start takes', { ...base, legs: Array(61).fill(leg) }, /61 legs, and a start takes at most 60/],
    ['a zero distance', { ...base, legs: [{ distance: 0, course: 10 }] }, /Leg 1 needs a distance/],
    ['a course over 360', { ...base, legs: [leg, { distance: 1, course: 400 }] }, /Leg 2 needs a course in degrees/],
    ['a wind direction given as text', { ...base, legs: [{ ...leg, windDirection: '160' }] }, /Leg 1’s wind direction/],
    ['a wind speed with no direction', { ...base, legs: [{ ...leg, windSpeed: 8 }] }, /wind speed but no wind direction/],
    ['half a current', { ...base, legs: [{ ...leg, currentSpeed: 1 }] }, /half a current/],
    ['an anchor missing its longitude', { ...base, anchor: { lat: 53.4 }, legs: [leg] }, /anchor isn’t a position/],
    ['an anchor off the globe', { ...base, anchor: { lat: 95, lng: 0 }, legs: [leg] }, /anchor isn’t a position/],
    [
      'wind on some legs and not others',
      { ...base, legs: [{ ...leg, windDirection: 5 }, leg] },
      /Some legs have a wind direction and some don’t/,
    ],
    [
      'a wind speed on some legs and not others',
      { ...base, legs: [{ ...leg, windDirection: 5, windSpeed: 8 }, { ...leg, windDirection: 5 }] },
      /Some legs have a wind speed and some don’t/,
    ],
  ])('%s', (_label, doc, message) => {
    expect(refusal(doc)).toMatch(message);
  });
});

describe('what a start stores', () => {
  // Howth's variation in autumn 2026, near enough: magnetic north a couple of
  // degrees west of true.
  const variation = { deg: -2.3, date: '2026-10-03' };

  it('converts every direction to true and records each distance to 0.01 NM', () => {
    const course = read({
      ...base,
      legs: [
        { name: 'Start – Windward', distance: 0.674, course: 282, windDirection: 280, windSpeed: 11.5, currentDirection: 5, currentSpeed: 1 },
        { name: 'Windward – Gybe', distance: 0.78, course: 1, windDirection: 280, windSpeed: 11.5 },
      ],
    });
    const legs = importedCourseLegs(course, variation);
    expect(legs[0].distanceNm).toBe(0.67);
    expect(legs[0].bearingDeg).toBeCloseTo(279.7, 9);
    expect(legs[0].windDirectionDeg).toBeCloseTo(277.7, 9);
    expect(legs[0].windSpeedKts).toBe(11.5);
    expect(legs[0].currentDirectionDeg).toBeCloseTo(2.7, 9);
    expect(legs[0].currentSpeedKts).toBe(1);
    expect(legs[0].name).toBe('Start – Windward');
    // Through north: 1°M is 358.7°T.
    expect(legs[1].bearingDeg).toBeCloseTo(358.7, 9);
  });

  it('leaves the wind to the start where the document has none', () => {
    const legs = importedCourseLegs(read({ ...base, legs: [leg] }), variation);
    expect(Object.keys(legs[0]).sort()).toEqual(['bearingDeg', 'distanceNm']);
    expect(legs[0].bearingDeg).toBeCloseTo(7.7, 9);
  });

  it('snapshots the legs, the anchor, and a wind every leg shares', () => {
    const course = read({
      ...base,
      name: 'Autumn League, Race 3, Class 1',
      anchor: { lat: 53.40125, lng: -6.08413 },
      legs: [
        { distance: 0.67, course: 282, windDirection: 280, windSpeed: 11.5 },
        { distance: 0.78, course: 144, windDirection: 280, windSpeed: 11.5 },
      ],
    });
    const snapshot = snapshotOfImportedCourse(course, importedCourseLegs(course, variation));
    expect(snapshot).toMatchObject({
      name: 'Autumn League, Race 3, Class 1',
      waypoints: [],
      anchor: { lat: 53.40125, lng: -6.08413 },
      windSpeedKts: 11.5,
    });
    expect(snapshot.courseId).toBeUndefined();
    expect(snapshot.windDirectionDeg).toBeCloseTo(277.7, 9);
    expect(snapshot.legs).toHaveLength(2);
    expect(snapshot.legs![1].bearingDeg).toBeCloseTo(141.7, 9);
  });

  it('has no course wind where the legs differ, and a name when the document gives none', () => {
    const course = read({
      ...base,
      legs: [
        { ...leg, windDirection: 280 },
        { ...leg, windDirection: 285 },
      ],
    });
    const snapshot = snapshotOfImportedCourse(course, importedCourseLegs(course, variation));
    expect(snapshot.name).toBe('Imported course');
    expect(snapshot.windDirectionDeg).toBeUndefined();
    expect(snapshot.anchor).toBeUndefined();
    expect(snapshot.north).toBeUndefined();
  });

  it('keeps every direction in magnetic where there is no variation to convert by', () => {
    const course = read({
      ...base,
      legs: [
        { name: 'Start – Windward', distance: 0.674, course: 282, windDirection: 280, currentDirection: 5, currentSpeed: 1 },
        { name: 'Windward – Start', distance: 0.67, course: 360, windDirection: 280 },
      ],
    });
    const legs = importedCourseLegs(course, undefined);
    expect(legs[0]).toEqual({
      name: 'Start – Windward',
      distanceNm: 0.67,
      bearingDeg: 282,
      windDirectionDeg: 280,
      currentDirectionDeg: 5,
      currentSpeedKts: 1,
    });
    // 360 reads as 0, as a converted figure would.
    expect(legs[1].bearingDeg).toBe(0);
    const snapshot = snapshotOfImportedCourse(course, legs, 'magnetic');
    expect(snapshot.north).toBe('magnetic');
    expect(snapshot.windDirectionDeg).toBe(280);
    expect(snapshot.legs).toEqual([
      { distanceNm: 0.67, bearingDeg: 282 },
      { distanceNm: 0.67, bearingDeg: 0 },
    ]);
  });
});
