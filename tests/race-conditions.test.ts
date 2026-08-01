/**
 * Per-race conditions (#338). `averageWindSpeed` gets the closest attention:
 * it is the figure ORC's triple-number scheme selects a rating band from, so
 * it is a future scoring input rather than a display convenience.
 */
import { describe, it, expect } from 'vitest';
import {
  COMPASS_POINTS,
  averageWindSpeed,
  formatConditions,
  formatWind,
  formatWindSpeed,
  hasConditions,
  isCompassPoint,
  windRangeError,
} from '@/lib/race-conditions';

describe('the compass', () => {
  it('is the sixteen points, clockwise from north', () => {
    expect(COMPASS_POINTS).toHaveLength(16);
    expect(COMPASS_POINTS[0]).toBe('N');
    expect(COMPASS_POINTS[4]).toBe('E');
    expect(COMPASS_POINTS[8]).toBe('S');
    expect(COMPASS_POINTS[12]).toBe('W');
  });

  it('recognises its own points and nothing else', () => {
    expect(isCompassPoint('SW')).toBe(true);
    expect(isCompassPoint('sw')).toBe(false);
    expect(isCompassPoint('NNNE')).toBe(false);
    expect(isCompassPoint(225)).toBe(false);
  });
});

describe('hasConditions', () => {
  it('is false for nothing recorded', () => {
    expect(hasConditions(undefined)).toBe(false);
    expect(hasConditions({})).toBe(false);
    expect(hasConditions({ notes: '   ' })).toBe(false);
  });

  it('is true once any one field is recorded', () => {
    expect(hasConditions({ windSpeedMin: 8 })).toBe(true);
    expect(hasConditions({ windSpeedMax: 14 })).toBe(true);
    expect(hasConditions({ windDirection: 'SW' })).toBe(true);
    expect(hasConditions({ notes: 'Course 2' })).toBe(true);
  });

  it('is true for a recorded calm', () => {
    // Zero knots is a fact about the race, not an absent value.
    expect(hasConditions({ windSpeedMin: 0, windSpeedMax: 0 })).toBe(true);
  });
});

describe('averageWindSpeed', () => {
  it('averages the stipulated minimum and maximum', () => {
    expect(averageWindSpeed({ windSpeedMin: 8, windSpeedMax: 14 })).toBe(11);
  });

  it('does not round the midpoint of an odd range', () => {
    expect(averageWindSpeed({ windSpeedMin: 8, windSpeedMax: 13 })).toBe(10.5);
  });

  it('treats a single recorded speed as the average', () => {
    // A single stipulated figure is a range of zero width, not half a range.
    expect(averageWindSpeed({ windSpeedMin: 12 })).toBe(12);
    expect(averageWindSpeed({ windSpeedMax: 12 })).toBe(12);
  });

  it('carries a recorded calm through rather than reading it as absent', () => {
    expect(averageWindSpeed({ windSpeedMin: 0 })).toBe(0);
    expect(averageWindSpeed({ windSpeedMin: 0, windSpeedMax: 4 })).toBe(2);
  });

  it('is undefined when no speed was recorded', () => {
    expect(averageWindSpeed(undefined)).toBeUndefined();
    expect(averageWindSpeed({})).toBeUndefined();
    expect(averageWindSpeed({ windDirection: 'SW' })).toBeUndefined();
  });
});

describe('formatting', () => {
  it('renders a range with an en dash', () => {
    expect(formatWindSpeed({ windSpeedMin: 8, windSpeedMax: 14 })).toBe('8–14 kt');
  });

  it('collapses a zero-width range to one figure', () => {
    expect(formatWindSpeed({ windSpeedMin: 10, windSpeedMax: 10 })).toBe('10 kt');
    expect(formatWindSpeed({ windSpeedMin: 10 })).toBe('10 kt');
  });

  it('renders wind with its direction', () => {
    expect(formatWind({ windSpeedMin: 8, windSpeedMax: 14, windDirection: 'SW' })).toBe(
      'Wind 8–14 kt SW',
    );
  });

  it('renders a direction with no speed, and a speed with no direction', () => {
    expect(formatWind({ windDirection: 'NNW' })).toBe('Wind NNW');
    expect(formatWind({ windSpeedMax: 20 })).toBe('Wind 20 kt');
  });

  it('has no wind clause when no wind was recorded', () => {
    expect(formatWind({ notes: 'Course 2' })).toBe('');
    expect(formatWind(undefined)).toBe('');
  });

  it('appends the note verbatim rather than labelling it', () => {
    // The field takes the course, the tide, or anything else — "Course:" would
    // be wrong as often as it was right.
    expect(
      formatConditions({
        windSpeedMin: 8,
        windSpeedMax: 14,
        windDirection: 'SW',
        notes: 'Windward-leeward, 3 laps; ebb tide',
      }),
    ).toBe('Wind 8–14 kt SW · Windward-leeward, 3 laps; ebb tide');
  });

  it('renders a note on its own, trimmed', () => {
    expect(formatConditions({ notes: '  Course 2  ' })).toBe('Course 2');
  });

  it('is empty when nothing is recorded', () => {
    expect(formatConditions(undefined)).toBe('');
    expect(formatConditions({})).toBe('');
  });
});

describe('windRangeError', () => {
  it('rejects a minimum above the maximum', () => {
    expect(windRangeError({ windSpeedMin: 20, windSpeedMax: 8 })).toBeTruthy();
  });

  it('accepts an equal pair, a half-filled range, and nothing at all', () => {
    expect(windRangeError({ windSpeedMin: 10, windSpeedMax: 10 })).toBeNull();
    expect(windRangeError({ windSpeedMin: 20 })).toBeNull();
    expect(windRangeError({ windSpeedMax: 8 })).toBeNull();
    expect(windRangeError({})).toBeNull();
    expect(windRangeError(undefined)).toBeNull();
  });
});
