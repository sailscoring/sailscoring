/**
 * A finish row's elapsed time, and the time of day that goes with it.
 *
 * A finish can be recorded either way round. A committee boat working off the
 * ship's clock writes down times of day and the elapsed time is the
 * difference from the gun; a boat working off a stopwatch, or an electronic
 * race-management export, produces the elapsed time directly and the time of
 * day is a rendering of it. Both reach the engine as the same number, and
 * these two helpers are the only place that decides which way round a given
 * row was recorded.
 *
 * A stored elapsed time wins. It is the measurement; a time of day sitting
 * beside it was derived from it, and where the two disagree — a device
 * writing a timestamp in the wrong hour, say — the elapsed time is the one
 * that survived the trip.
 */

import { formatSecondsAsHms, parseHmsToSeconds } from './time-parse';
import type { Finish } from './types';

/** The finish fields these read. Narrower than `Finish` so callers holding a
 *  projection (a diff row, an export row) can use them too. */
export interface TimedFinish {
  finishTime?: string | null;
  elapsedSecs?: number | null;
}

/**
 * The boat's elapsed time in whole seconds, or `null` when the row records
 * neither an elapsed time nor a finish time the start can be subtracted from.
 *
 * Whole seconds because that is what every elapsed time in the engine has
 * always been, and what ORC rule 401.2 asks for; a recorded fraction is
 * rounded half-up here rather than propagating into corrected times.
 * `startSeconds` may be null — a membership-only start has no gun — in which
 * case only a stored elapsed time yields an answer.
 */
export function elapsedSecondsOf(
  finish: TimedFinish,
  startSeconds: number | null,
): number | null {
  if (finish.elapsedSecs != null) return Math.round(finish.elapsedSecs);
  const finishSeconds = parseHmsToSeconds(finish.finishTime);
  if (finishSeconds === null || startSeconds === null) return null;
  return finishSeconds - startSeconds;
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
