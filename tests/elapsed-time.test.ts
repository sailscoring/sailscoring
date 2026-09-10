import { describe, it, expect } from 'vitest';

import {
  crossingTimeOf,
  elapsedSecondsOf,
  roundToPrecision,
  timingPrecisionOf,
} from '@/lib/elapsed-time';

describe('elapsedSecondsOf', () => {
  it('subtracts the gun from a recorded time of day', () => {
    expect(elapsedSecondsOf({ finishTime: '15:05:00' }, 50700)).toBe(3600);
  });

  it('reads a recorded elapsed time with no gun at all', () => {
    expect(elapsedSecondsOf({ elapsedSecs: 3600 }, null)).toBe(3600);
  });

  it('keeps a recorded fraction rather than rounding it away', () => {
    expect(elapsedSecondsOf({ elapsedSecs: 2751.785 }, null)).toBe(2751.785);
    expect(elapsedSecondsOf({ elapsedSecs: 3599.5 }, null)).toBe(3599.5);
  });

  it('prefers the recorded elapsed time over a time of day that disagrees', () => {
    // The RaceSense case: the device wrote a timestamp an hour early while
    // its elapsed figure stayed right. The measurement wins.
    expect(
      elapsedSecondsOf({ finishTime: '14:09:45', elapsedSecs: 3885.608 }, 50700),
    ).toBe(3885.608);
  });

  it('says nothing when the row records neither', () => {
    expect(elapsedSecondsOf({}, 50700)).toBeNull();
    expect(elapsedSecondsOf({ finishTime: null, elapsedSecs: null }, 50700)).toBeNull();
  });

  it('says nothing for a time of day with no gun to measure from', () => {
    expect(elapsedSecondsOf({ finishTime: '15:05:00' }, null)).toBeNull();
  });
});

describe('timingPrecisionOf', () => {
  it('reads a sheet of whole seconds as timed to the second', () => {
    expect(timingPrecisionOf([{ elapsedSecs: 3600 }, { finishTime: '15:05:00' }]))
      .toBe('second');
  });

  it('reads one fraction anywhere in the race as timed to the millisecond', () => {
    expect(timingPrecisionOf([{ elapsedSecs: 3600 }, { elapsedSecs: 3600.45 }]))
      .toBe('millisecond');
  });

  it('reads a race with no times at all as timed to the second', () => {
    expect(timingPrecisionOf([])).toBe('second');
    expect(timingPrecisionOf([{ elapsedSecs: null, finishTime: null }])).toBe('second');
  });
});

describe('roundToPrecision', () => {
  it('rounds half-up at either unit', () => {
    expect(roundToPrecision(3599.5, 'second')).toBe(3600);
    expect(roundToPrecision(3599.4, 'second')).toBe(3599);
    expect(roundToPrecision(3599.4444, 'millisecond')).toBe(3599.444);
    expect(roundToPrecision(3599.4445, 'millisecond')).toBe(3599.445);
  });

  it('puts two arithmetically equal corrected times back on one number', () => {
    // 645 × 1.4 and 903 × 1 are the same corrected time, and doubles disagree
    // about it. Rounding to the millisecond ties them again.
    expect(645 * 1.4).not.toBe(903 * 1);
    expect(roundToPrecision(645 * 1.4, 'millisecond'))
      .toBe(roundToPrecision(903 * 1, 'millisecond'));
  });
});

describe('crossingTimeOf', () => {
  it('returns a recorded time of day as it stands', () => {
    expect(crossingTimeOf({ finishTime: '15:05:00' }, 50700)).toBe('15:05:00');
  });

  it('derives a crossing time from the gun and the elapsed time', () => {
    expect(crossingTimeOf({ elapsedSecs: 3600 }, 50700)).toBe('15:05:00');
  });

  it('truncates the fraction, the way a stopwatch reading is read off', () => {
    // 12:28:00 gun, 2751.785 s elapsed — the boat crossed at 13:13:51.
    expect(crossingTimeOf({ elapsedSecs: 2751.785 }, 44880)).toBe('13:13:51');
  });

  it('says nothing without a gun to measure the elapsed time from', () => {
    expect(crossingTimeOf({ elapsedSecs: 3600 }, null)).toBeNull();
  });

  it('says nothing when the row records neither', () => {
    expect(crossingTimeOf({}, 50700)).toBeNull();
  });
});
