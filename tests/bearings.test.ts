import { describe, expect, it } from 'vitest';

import {
  bearingFigure,
  centroid,
  courseVariation,
  describeVariation,
  enteredTrue,
  formatBearing,
  formatDeg,
  formatVariation,
  parseBearing,
  toMagnetic,
  toTrue,
  variationAt,
  type Variation,
} from '@/lib/bearings';

// Cork Harbour, westerly variation of a degree or two in 2026.
const CORK = { lat: 51.8, lng: -8.3 };
const W2: Variation = { deg: -2, date: '2026-09-06' };

describe('the variation', () => {
  it('comes from the World Magnetic Model for the place and day', () => {
    const v = variationAt(CORK, '2026-10-05');
    expect(v.date).toBe('2026-10-05');
    // West of Greenwich in Ireland: magnetic north lies west of true.
    expect(v.deg).toBeLessThan(0);
    expect(v.deg).toBeGreaterThan(-4);
    // It drifts east year on year, by a fraction of a degree.
    const later = variationAt(CORK, '2029-10-05');
    expect(later.deg).toBeGreaterThan(v.deg);
    expect(later.deg - v.deg).toBeLessThan(1);
  });

  it('is read at the course, else at the venue, else not at all', () => {
    const venue = { lat: 53.39, lng: -6.07 };
    expect(courseVariation([CORK], venue, '2026-10-05')).toEqual(variationAt(CORK, '2026-10-05'));
    expect(courseVariation([], venue, '2026-10-05')).toEqual(variationAt(venue, '2026-10-05'));
    expect(courseVariation([], undefined, '2026-10-05')).toBeUndefined();
    expect(centroid([{ lat: 50, lng: -8 }, { lat: 52, lng: -6 }])).toEqual({ lat: 51, lng: -7 });
  });

  it('is stated as a chart states it', () => {
    expect(formatVariation({ deg: -1.87, date: '2026-09-06' })).toBe('1.9°W');
    expect(formatVariation({ deg: 3.04, date: '2026-09-06' })).toBe('3°E');
    expect(formatVariation({ deg: 0.02, date: '2026-09-06' })).toBe('0°');
    expect(describeVariation({ deg: -1.87, date: '2026-09-06' }))
      .toBe('variation 1.9°W (World Magnetic Model, 6 Sep 2026)');
  });
});

describe('converting', () => {
  it('adds a westerly variation going true to magnetic, and wraps', () => {
    expect(toMagnetic(103, W2)).toBe(105);
    expect(toMagnetic(359, W2)).toBe(1);
    expect(toTrue(105, 'M', W2)).toBe(103);
    expect(toTrue(1, 'M', W2)).toBe(359);
    expect(toTrue(105, 'T', undefined)).toBe(105);
    expect(() => toTrue(105, 'M', undefined)).toThrow();
  });

  it('works magnetic from the unrounded true figure, then rounds', () => {
    const v = { deg: -1.87, date: '2026-09-06' };
    // 103.13 + 1.87 = 105.00 exactly; rounding true first would give 105.1.
    expect(bearingFigure(103.13, 'M', v)).toBe('105');
    expect(bearingFigure(103.13, 'T', v)).toBe('103.1');
    expect(formatDeg(359.96)).toBe('0');
  });
});

describe('labels', () => {
  it('say which north every figure is from', () => {
    expect(formatBearing(172, W2)).toBe('174°M');
    expect(formatBearing(172, W2, { both: true })).toBe('174°M (172°T)');
    expect(formatBearing(172.34, undefined)).toBe('172.3°T');
    expect(formatBearing(7.4, W2, { whole: true, both: true })).toBe('009°M (007°T)');
  });
});

describe('entering a bearing', () => {
  it('takes a figure in the field reference, or the one written after it', () => {
    expect(parseBearing('105', 'M')).toEqual({ deg: 105, ref: 'M' });
    expect(parseBearing(' 103.1T ', 'M')).toEqual({ deg: 103.1, ref: 'T' });
    expect(parseBearing('105°m', 'T')).toEqual({ deg: 105, ref: 'M' });
    expect(parseBearing('400', 'M')).toBeNull();
    expect(parseBearing('NNE', 'M')).toBeNull();
  });

  it('stores true, and gives back the stored figure while the text is untouched', () => {
    expect(enteredTrue('105', 'M', W2)).toBe(103);
    expect(enteredTrue('103T', 'M', W2)).toBe(103);
    // Magnetic with no variation to apply is refused, not stored as true.
    expect(enteredTrue('105', 'M', undefined)).toBeNull();
    expect(enteredTrue('105T', 'M', undefined)).toBe(105);
    // A stored 103.13 shows as 105.0°M at this variation; saved untouched it
    // stays 103.13 rather than coming back as 103.
    expect(enteredTrue('105', 'M', W2, { text: '105', trueDeg: 103.13 })).toBe(103.13);
    expect(enteredTrue('106', 'M', W2, { text: '105', trueDeg: 103.13 })).toBe(104);
  });
});
