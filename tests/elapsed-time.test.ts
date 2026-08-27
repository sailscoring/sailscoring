import { describe, it, expect } from 'vitest';

import { crossingTimeOf, elapsedSecondsOf } from '@/lib/elapsed-time';

describe('elapsedSecondsOf', () => {
  it('subtracts the gun from a recorded time of day', () => {
    expect(elapsedSecondsOf({ finishTime: '15:05:00' }, 50700)).toBe(3600);
  });

  it('reads a recorded elapsed time with no gun at all', () => {
    expect(elapsedSecondsOf({ elapsedSecs: 3600 }, null)).toBe(3600);
  });

  it('rounds a fractional elapsed time half-up', () => {
    expect(elapsedSecondsOf({ elapsedSecs: 2751.785 }, null)).toBe(2752);
    expect(elapsedSecondsOf({ elapsedSecs: 3599.5 }, null)).toBe(3600);
    expect(elapsedSecondsOf({ elapsedSecs: 3599.4 }, null)).toBe(3599);
  });

  it('prefers the recorded elapsed time over a time of day that disagrees', () => {
    // The RaceSense case: the device wrote a timestamp an hour early while
    // its elapsed figure stayed right. The measurement wins.
    expect(
      elapsedSecondsOf({ finishTime: '14:09:45', elapsedSecs: 3885.608 }, 50700),
    ).toBe(3886);
  });

  it('says nothing when the row records neither', () => {
    expect(elapsedSecondsOf({}, 50700)).toBeNull();
    expect(elapsedSecondsOf({ finishTime: null, elapsedSecs: null }, 50700)).toBeNull();
  });

  it('says nothing for a time of day with no gun to measure from', () => {
    expect(elapsedSecondsOf({ finishTime: '15:05:00' }, null)).toBeNull();
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
