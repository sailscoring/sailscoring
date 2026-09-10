/**
 * A finish row's elapsed time, and the time of day that goes with it.
 *
 * A finish can be recorded either way round. A committee boat working off the
 * ship's clock writes down times of day and the elapsed time is the
 * difference from the gun; a boat working off a stopwatch, or an electronic
 * race-management export, produces the elapsed time directly and the time of
 * day is a rendering of it. Both reach the engine as the same number, and
 * these helpers are the only place that decides which way round a given row
 * was recorded.
 *
 * A stored elapsed time wins. It is the measurement; a time of day sitting
 * beside it was derived from it, and where the two disagree — a device
 * writing a timestamp in the wrong hour, say — the elapsed time is the one
 * that survived the trip.
 *
 * Which way round a row was recorded also settles how finely the race is
 * scored, since only the elapsed form can carry a fraction: see
 * `timingPrecisionOf`.
 */

import { formatSecondsAsHms, parseHmsToSeconds } from './time-parse';
import type { Finish } from './types';

/** The finish fields these read. Narrower than `Finish` so callers holding a
 *  projection (a diff row, an export row) can use them too. */
export interface TimedFinish {
  finishTime?: string | null;
  elapsedSecs?: number | null;
}

/** The unit a race's times are read and scored in — see `timingPrecisionOf`. */
export type TimingPrecision = 'second' | 'millisecond';

/**
 * The boat's elapsed time in seconds, as recorded, or `null` when the row
 * records neither an elapsed time nor a finish time the start can be
 * subtracted from.
 *
 * A stored elapsed time keeps its fraction: a device that measured to the
 * millisecond measured the gap between two boats that crossed inside the same
 * second, and rounding here is what would throw that gap away. What is done
 * with the fraction afterwards is `timingPrecisionOf`'s business. A time of
 * day is whole seconds by construction, so the derived form is unchanged.
 * `startSeconds` may be null — a membership-only start has no gun — in which
 * case only a stored elapsed time yields an answer.
 */
export function elapsedSecondsOf(
  finish: TimedFinish,
  startSeconds: number | null,
): number | null {
  if (finish.elapsedSecs != null) return finish.elapsedSecs;
  const finishSeconds = parseHmsToSeconds(finish.finishTime);
  if (finishSeconds === null || startSeconds === null) return null;
  return finishSeconds - startSeconds;
}

/**
 * The unit a race's corrected times are worked out in.
 *
 * A race is scored at the precision it was timed at. A committee boat working
 * off a clock or a stopwatch records whole seconds, and the second is then the
 * real unit: two boats inside it finished together as far as anyone on the
 * water could tell, and RRS A7 ties them. A device that wrote a fraction
 * measured that gap, and scoring such a race to the second invents a tie the
 * timing did not have.
 *
 * So the fraction decides, and one race is scored one way throughout — read
 * off every finish in it, not per fleet and not per boat, so that boats ranked
 * against each other are always corrected the same way.
 *
 * The millisecond is a unit and not simply full float precision, which is what
 * keeps a real tie a tie: two corrected times that are equal in arithmetic can
 * differ in the last bits of a double, and rounding both to the millisecond
 * puts them back on the same number.
 */
export function timingPrecisionOf(finishes: Iterable<TimedFinish>): TimingPrecision {
  for (const finish of finishes) {
    if (finish.elapsedSecs != null && !Number.isInteger(finish.elapsedSecs)) return 'millisecond';
  }
  return 'second';
}

/** Round seconds half-up to whole seconds or to the millisecond. */
export function roundToPrecision(secs: number, precision: TimingPrecision): number {
  return precision === 'millisecond'
    ? Math.floor(secs * 1000 + 0.5) / 1000
    : Math.floor(secs + 0.5);
}

/**
 * The time of day the boat crossed the line, `"HH:MM:SS"`, or `null` when the
 * row can't say. Stored outright by a sheet recorded off the clock; derived
 * from the gun and the elapsed time by one recorded off a stopwatch.
 *
 * The derived form truncates rather than rounds, the way a stopwatch reading
 * is read off: a boat 2751.785 s after a 12:28:00 gun crossed at 13:13:51,
 * not 13:13:52.
 */
export function crossingTimeOf(
  finish: TimedFinish,
  startSeconds: number | null,
): string | null {
  if (finish.finishTime) return finish.finishTime;
  if (finish.elapsedSecs == null || startSeconds === null) return null;
  return formatSecondsAsHms(startSeconds + Math.floor(finish.elapsedSecs));
}
