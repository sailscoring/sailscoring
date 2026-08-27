import { describe, it, expect } from 'vitest';
import {
  avgSpeedKn,
  dtlAtStartText,
  dtlAtStartWords,
  elapsedText,
  hasTrackData,
  trackDataStrip,
  type TrackDataCell,
} from '@/lib/track-data';

describe('hasTrackData', () => {
  it('is false for a boat the device recorded nothing for', () => {
    expect(hasTrackData(undefined)).toBe(false);
    expect(hasTrackData(null)).toBe(false);
    expect(hasTrackData({})).toBe(false);
  });

  it('is true for any single recorded metric', () => {
    expect(hasTrackData({ dtlAtStartM: -2.86 })).toBe(true);
    expect(hasTrackData({ distanceKm: 12.3 })).toBe(true);
    expect(hasTrackData({ maxSpeedKts: 6.9 })).toBe(true);
  });

  it('counts a zero, which is a recording like any other', () => {
    expect(hasTrackData({ dtlAtStartM: 0 })).toBe(true);
  });
});

describe('dtlAtStart', () => {
  it('publishes the signed figure, so the column sorts', () => {
    expect(dtlAtStartText({ trackData: { dtlAtStartM: -2.86 } })).toBe('-2.86');
    expect(dtlAtStartText({ trackData: { dtlAtStartM: 2.22 } })).toBe('2.22');
  });

  it('spells the sign out for the app, where no header explains it', () => {
    expect(dtlAtStartWords({ trackData: { dtlAtStartM: -2.86 } })).toBe('2.9 m over');
    expect(dtlAtStartWords({ trackData: { dtlAtStartM: 2.22 } })).toBe('2.2 m to line');
  });

  it('reads a boat exactly on the line as being on the right side of it', () => {
    expect(dtlAtStartWords({ trackData: { dtlAtStartM: 0 } })).toBe('0.0 m to line');
  });

  it('is blank when no line was recorded', () => {
    expect(dtlAtStartText({ trackData: { distanceKm: 12.3 } })).toBe('');
    expect(dtlAtStartWords({ trackData: { distanceKm: 12.3 } })).toBe('');
    expect(dtlAtStartWords(undefined)).toBe('');
  });
});

describe('elapsedText', () => {
  it('rounds to the second the published column shows', () => {
    expect(elapsedText({ elapsedSecs: 5071.4 })).toBe('1:24:31');
    expect(elapsedText({ elapsedSecs: 154 })).toBe('2:34');
  });
});

describe('avgSpeedKn', () => {
  it('derives knots from the kilometres and the seconds', () => {
    // 12.3 km in 5071 s: 6.6415 NM over 1.40861 h.
    const kn = avgSpeedKn({ elapsedSecs: 5071, trackData: { distanceKm: 12.3 } });
    expect(kn).toBeCloseTo(4.715, 3);
  });

  it('has no answer without both halves, or from a zero elapsed', () => {
    expect(avgSpeedKn({ trackData: { distanceKm: 12.3 } })).toBeNull();
    expect(avgSpeedKn({ elapsedSecs: 5071 })).toBeNull();
    expect(avgSpeedKn({ elapsedSecs: 0, trackData: { distanceKm: 12.3 } })).toBeNull();
  });
});

describe('trackDataStrip', () => {
  const full: TrackDataCell = {
    finishTime: '13:52:31',
    elapsedSecs: 5071,
    trackData: { dtlAtStartM: 2.22, distanceKm: 12.3, maxSpeedKts: 6.9 },
  };

  it('reads as one line describing the race the boat sailed', () => {
    expect(trackDataStrip(full)).toEqual([
      'Elapsed 1:24:31',
      '12.3 km',
      '4.71 kn avg',
      '6.9 kn max',
      '2.2 m to line',
    ]);
  });

  it('drops what the device did not record rather than blanking it', () => {
    expect(trackDataStrip({ elapsedSecs: 5071, trackData: { maxSpeedKts: 6.9 } })).toEqual([
      'Elapsed 1:24:31',
      '6.9 kn max',
    ]);
  });

  it('is empty for a boat with nothing at all', () => {
    expect(trackDataStrip({ finishTime: '13:52:31' })).toEqual([]);
  });
});
