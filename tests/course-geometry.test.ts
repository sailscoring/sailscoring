import { destination } from '@sailscoring/course-cards';
import { describe, expect, it } from 'vitest';

import {
  drawnLegTable,
  drawnRaceStartCourse,
  drawnStartCourse,
  legsForStart,
  legsMatch,
  recordedWindSummary,
  seriesChartSet,
  startCoursePositions,
} from '@/lib/course-geometry';
import { chartSetCovering } from '@/lib/course-cards';

/** A windward/leeward a kilometre long on 190°, as a mark sequence's
 *  geometry gives it: unrounded. */
const WL = [
  { distanceNm: 1000 / 1852, bearingDeg: 190.0417 },
  { distanceNm: 1000 / 1852, bearingDeg: 10.0417 },
];

describe('a start’s legs', () => {
  it('fills the leg table to a hundredth of a mile and a tenth of a degree, with the wind on every leg', () => {
    expect(legsForStart(WL, 190)).toEqual([
      { distanceNm: 0.54, bearingDeg: 190, windDirectionDeg: 190 },
      { distanceNm: 0.54, bearingDeg: 10, windDirectionDeg: 190 },
    ]);
  });

  it('records a leg to 0.01 NM, the precision ORC scores a course at', () => {
    // 958 m is 0.5173 NM: the case that separates the two roundings.
    expect(legsForStart([{ distanceNm: 958 / 1852, bearingDeg: 190 }], 190).map((l) => l.distanceNm)).toEqual([0.52]);
  });

  it('spreads a recorded wind speed over every leg', () => {
    expect(legsForStart(WL, 190, 9)).toEqual([
      { distanceNm: 0.54, bearingDeg: 190, windDirectionDeg: 190, windSpeedKts: 9 },
      { distanceNm: 0.54, bearingDeg: 10, windDirectionDeg: 190, windSpeedKts: 9 },
    ]);
  });

  it('reads what the legs say the wind was, or that a leg is missing it', () => {
    const at = (speeds: Array<number | undefined>) =>
      recordedWindSummary(speeds.map((windSpeedKts) => ({
        distanceNm: 1, bearingDeg: 0, windDirectionDeg: 190,
        ...(windSpeedKts != null ? { windSpeedKts } : {}),
      })));
    expect(at([9, 9])).toBe('9 kt');
    expect(at([8, 14])).toBe('8–14 kt');
    expect(at([9, undefined])).toBe('wind speed missing');
    // No leg carries one: the ordinary case, and the one performance curves
    // are in — nothing to say rather than something missing.
    expect(at([undefined, undefined])).toBeNull();
    expect(recordedWindSummary(undefined)).toBeNull();
    expect(recordedWindSummary([])).toBeNull();
  });

  it('knows when the legs were edited: split, nudged, per-leg wind, or current', () => {
    const fromCourse = legsForStart(WL, 190);
    expect(legsMatch(fromCourse, fromCourse)).toBe(true);
    expect(legsMatch([...fromCourse, { distanceNm: 0.1, bearingDeg: 10, windDirectionDeg: 190 }], fromCourse)).toBe(false);
    expect(legsMatch([{ ...fromCourse[0], distanceNm: 0.55 }, fromCourse[1]], fromCourse)).toBe(false);
    expect(legsMatch([{ ...fromCourse[0], windDirectionDeg: 195 }, fromCourse[1]], fromCourse)).toBe(false);
    expect(legsMatch([{ ...fromCourse[0], currentSpeedKts: 1 }, fromCourse[1]], fromCourse)).toBe(false);
    expect(legsMatch([{ ...fromCourse[0], windSpeedKts: 9 }, fromCourse[1]], fromCourse)).toBe(false);
    // 359.9 and 0.0 are the same bearing
    expect(legsMatch([{ distanceNm: 1, bearingDeg: 359.95, windDirectionDeg: 0 }], [{ distanceNm: 1, bearingDeg: 0, windDirectionDeg: 0 }])).toBe(true);
    // A table filled when the app wrote thousandths is the same course as the
    // hundredths it writes now — not a scorer's edit.
    expect(legsMatch(
      [{ distanceNm: 0.517, bearingDeg: 89.1, windDirectionDeg: 0 }],
      [{ distanceNm: 0.52, bearingDeg: 89.1, windDirectionDeg: 0 }],
    )).toBe(true);
    // A hundredth apart is a nudge the scorer made, and survives a recompute.
    expect(legsMatch(
      [{ distanceNm: 0.53, bearingDeg: 89.1, windDirectionDeg: 0 }],
      [{ distanceNm: 0.52, bearingDeg: 89.1, windDirectionDeg: 0 }],
    )).toBe(false);
  });

});

describe('what a start’s course draws', () => {
  const legs = [
    { distanceNm: 2.09, bearingDeg: 162 },
    { distanceNm: 0.06, bearingDeg: 60 },
    { distanceNm: 1.91, bearingDeg: 340 },
  ];
  const course = { name: 'From the RC', waypoints: [], legs, windDirectionDeg: 225 };

  it('draws the legs the course gave, and says it drew legs', () => {
    // A course of legs has no positions, so the placeholder "nothing to
    // draw" would be a lie: the course is complete, it simply has no marks.
    const drawn = drawnStartCourse(course);
    expect(drawn.fromLegs).toBe(true);
    expect(drawn.marks).toHaveLength(legs.length + 1);
    expect(drawn.course.map((c) => c.mark)).toEqual(drawn.marks.map((m) => m.id));
  });

  it('draws what a start scored: the course’s legs until they are edited, then the legs', () => {
    const scored = [
      { distanceNm: 1.2, bearingDeg: 300 },
      { distanceNm: 0.8, bearingDeg: 20 },
    ];
    expect(drawnRaceStartCourse(course, scored)!.marks).toHaveLength(legs.length + 1);
    const edited = drawnRaceStartCourse({ ...course, legsEdited: true }, scored)!;
    expect(edited.fromLegs).toBe(true);
    expect(edited.marks.map((m) => m.label)).toEqual(['Start', '1', 'Finish']);
    // No course at all: the typed legs are all there is.
    expect(drawnRaceStartCourse(undefined, scored)!.fromLegs).toBe(true);
    expect(drawnRaceStartCourse(undefined, undefined)).toBeNull();
  });
});

describe('drawing a leg table', () => {
  it('walks the legs and reports how far the course misses its own start', () => {
    // A windward/leeward closes exactly.
    expect(drawnLegTable([{ distanceNm: 1, bearingDeg: 0 }, { distanceNm: 1, bearingDeg: 180 }]).closureNm)
      .toBeLessThan(1e-6);

    // The Cork course behind #583, as the committee gave it: twelve legs
    // rounded to a tenth of a mile, closing to a tenth.
    const cork = [[0.80, 59], [0.80, 239], [1.10, 130], [0.60, 228], [0.60, 23], [0.90, 311],
      [1.70, 32], [0.20, 218], [1.20, 196], [0.50, 249], [2.00, 26], [2.00, 206]]
      .map(([distanceNm, bearingDeg]) => ({ distanceNm, bearingDeg }));
    const drawn = drawnLegTable(cork);
    expect(drawn.marks).toHaveLength(13);
    expect(drawn.marks[0].label).toBe('Start');
    expect(drawn.marks[12].label).toBe('Finish');
    expect(drawn.course.map((c) => c.mark)).toEqual(drawn.marks.map((m) => m.id));
    expect(drawn.closureNm).toBeCloseTo(0.07, 2);

    // And with the one stray leg that actually got scored: nearly a mile
    // out, which no amount of rounding twelve legs explains.
    const withStray = [...cork.slice(0, 10), { distanceNm: 0.866, bearingDeg: 240.5 }, ...cork.slice(10)];
    expect(drawnLegTable(withStray).closureNm).toBeGreaterThan(0.9);
  });

  it('draws nothing for no legs', () => {
    const drawn = drawnLegTable([]);
    expect(drawn.marks).toHaveLength(1);
    expect(drawn.closureNm).toBe(0);
  });
});

describe('a leg table placed on the water by its anchor', () => {
  // Off Ireland's Eye, inside the chart HYC's Autumn League sets captured.
  const anchor = { lat: 53.40125, lng: -6.08413 };
  const legs = [
    { distanceNm: 0.67, bearingDeg: 280 },
    { distanceNm: 0.78, bearingDeg: 143 },
    { distanceNm: 0.73, bearingDeg: 46 },
  ];
  const imported = { name: 'Autumn League, Race 3', waypoints: [], legs, anchor };

  it('walks the legs from the anchor, and from an arbitrary origin without one', () => {
    const placed = drawnLegTable(legs, anchor);
    expect(placed.marks[0].position).toEqual(anchor);
    const first = destination(anchor, 280, 0.67 * 1852);
    expect(placed.marks[1].position.lat).toBeCloseTo(first.lat, 9);
    expect(placed.marks[1].position.lng).toBeCloseTo(first.lng, 9);
    // The shape is the same either way; only where it sits differs.
    expect(placed.closureNm).toBeCloseTo(drawnLegTable(legs).closureNm, 3);
    expect(drawnLegTable(legs).marks[0].position).not.toEqual(anchor);
  });

  it('draws on the chart that covers it, and says it is anchored', () => {
    const drawn = drawnStartCourse(imported);
    expect(drawn).toMatchObject({ fromLegs: true, anchored: true });
    expect(drawn.set).toMatch(/^hyc\//);
    // The preferred set wins a tie: the chart the series' other courses sit on.
    expect(drawnStartCourse(imported, 'hyc/al-2025').set).toBe('hyc/al-2025');
    // Without an anchor there is nowhere on the water to put it.
    const unplaced = drawnStartCourse({ ...imported, anchor: undefined });
    expect(unplaced.anchored).toBeUndefined();
    expect(unplaced.set).toBeUndefined();
  });

  it('walks edited legs from the anchor too', () => {
    const edited = drawnRaceStartCourse({ ...imported, legsEdited: true }, [...legs, { distanceNm: 0.2, bearingDeg: 300 }])!;
    expect(edited).toMatchObject({ fromLegs: true, anchored: true });
    expect(edited.marks).toHaveLength(5);
    expect(edited.marks[0].position).toEqual(anchor);
  });

  it('is where the variation is read: the anchor, or the waypoints of a mark course', () => {
    expect(startCoursePositions(imported)).toEqual([anchor]);
    expect(startCoursePositions({ ...imported, anchor: undefined })).toEqual([]);
    expect(startCoursePositions(undefined)).toEqual([]);
    expect(startCoursePositions({ name: 'W/L', waypoints: [{ label: 'Start', lat: 53.4, lng: -6.07 }] })).toEqual([
      { lat: 53.4, lng: -6.07 },
    ]);
  });
});

describe('the chart under a course with no charted marks', () => {
  it('is a set whose chart holds the first point', () => {
    // Cork Harbour, Dublin Bay, and the open Irish Sea.
    expect(chartSetCovering([{ lat: 51.81, lng: -8.27 }])).toBe('rcyc/keelboat-2026');
    expect(chartSetCovering([{ lat: 53.31, lng: -6.12 }])).toMatch(/^(dbsc|dlcc)\//);
    expect(chartSetCovering([{ lat: 53.0, lng: -5.0 }])).toBeUndefined();
    expect(chartSetCovering([])).toBeUndefined();
  });

  it('prefers the chart that holds more of the course, then the closer-in one', () => {
    // Inside both Howth charts: the Brass Monkey chart is the closer in.
    const inner = { lat: 53.41, lng: -6.08 };
    expect(chartSetCovering([inner])).toBe('hyc/brass-monkey-2025');
    // A course running out past the Brass Monkey chart's edge belongs on
    // the Autumn League's, which holds all of it.
    const outer = { lat: 53.45, lng: -6.03 };
    expect(chartSetCovering([inner, outer])).toMatch(/^hyc\/al-/);
  });

  it('keeps a series’ courses on the chart that holds the most of them', () => {
    const at = (legs: { distanceNm: number; bearingDeg: number }[]) => ({
      courseLegs: legs.map((l) => ({ ...l, windDirectionDeg: 0 })),
      course: { name: 'Course', waypoints: [], legs, anchor: { lat: 53.41, lng: -6.08 } },
    });
    // A short triangle off Ireland's Eye fits the Brass Monkey chart; the
    // longer course runs out past it. The Autumn League's holds both.
    const inner = at([{ distanceNm: 0.5, bearingDeg: 30 }, { distanceNm: 0.5, bearingDeg: 210 }]);
    const outer = at([{ distanceNm: 3, bearingDeg: 30 }, { distanceNm: 3, bearingDeg: 210 }]);
    expect(seriesChartSet([inner])).toBe('hyc/brass-monkey-2025');
    expect(seriesChartSet([inner, outer])).toBe('hyc/al-2026');
    // A start with no anchor, or no legs, is nowhere on a chart.
    expect(seriesChartSet([{ courseLegs: inner.courseLegs }])).toBeUndefined();
    expect(seriesChartSet([])).toBeUndefined();
  });
});
