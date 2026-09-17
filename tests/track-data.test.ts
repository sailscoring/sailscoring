import { describe, it, expect } from 'vitest';
import {
  avgSpeedKn,
  dtlAtStartText,
  dtlAtStartWords,
  elapsedText,
  hasTrackData,
  publishedCell,
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
  it('shows the reading as recorded, fraction and all', () => {
    expect(elapsedText({ elapsedSecs: 5071.4 })).toBe('1:24:31.4');
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

describe('publishedCell', () => {
  const GUN = 11 * 3600; // 11:00:00
  const TRACK = { dtlAtStartM: -2.86, distanceKm: 12.3, maxSpeedKts: 6.9 };

  it('publishes a hand-timed boat, track data published or not', () => {
    const hand: TrackDataCell = { finishTime: '11:45:20' };
    for (const publishTrackData of [true, false]) {
      expect(publishedCell(hand, GUN, { publishTrackData })).toEqual({
        finishTime: '11:45:20',
        elapsedSecs: 45 * 60 + 20,
      });
    }
  });

  it('withholds a boat the device measured when the series does not publish track data', () => {
    const imported: TrackDataCell = { finishTime: '11:45:20', elapsedSecs: 2720.5, trackData: TRACK };
    expect(publishedCell(imported, GUN, { publishTrackData: false })).toEqual({});
    expect(publishedCell(imported, GUN, { publishTrackData: true })).toEqual({
      finishTime: '11:45:20',
      elapsedSecs: 2720.5,
      trackData: TRACK,
    });
  });

  it('decides per boat, so a half-imported race keeps the times it may show', () => {
    const imported: TrackDataCell = { finishTime: '11:45:20', trackData: TRACK };
    const hand: TrackDataCell = { finishTime: '11:46:20' };
    const opts = { publishTrackData: false };
    expect(publishedCell(imported, GUN, opts)).toEqual({});
    expect(publishedCell(hand, GUN, opts).finishTime).toBe('11:46:20');
  });

  it('is not fooled into withholding by an elapsed time alone, which a stopwatch also writes', () => {
    const stopwatch: TrackDataCell = { elapsedSecs: 2720 };
    expect(publishedCell(stopwatch, GUN, { publishTrackData: false })).toEqual({
      finishTime: '11:45:20',
      elapsedSecs: 2720,
    });
  });

  it('works the elapsed time out from the gun, and the time of day from the stopwatch', () => {
    expect(publishedCell({ finishTime: '11:45:20' }, GUN, { publishTrackData: false }).elapsedSecs)
      .toBe(2720);
    expect(publishedCell({ elapsedSecs: 2720 }, GUN, { publishTrackData: false }).finishTime)
      .toBe('11:45:20');
  });

  it('leaves the elapsed time out when there is no gun to subtract', () => {
    expect(publishedCell({ finishTime: '11:45:20' }, null, { publishTrackData: false })).toEqual({
      finishTime: '11:45:20',
    });
  });

  it('leaves out a negative difference, which is a mistake in the sheet and not a time', () => {
    expect(publishedCell({ finishTime: '10:45:20' }, GUN, { publishTrackData: false })).toEqual({
      finishTime: '10:45:20',
    });
  });

  it('is empty for a boat with no row at all', () => {
    expect(publishedCell(undefined, GUN, { publishTrackData: true })).toEqual({});
  });
});
