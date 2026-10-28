/**
 * Mixed laps: a fleet in which some boats sail fewer laps of the course than
 * others, and are scored on the full course.
 *
 * A club with a wide spread of handicaps in one start — Portsmouth numbers
 * from 940 to over 1400 — sends its slowest boats round once while the rest
 * go round twice, so that nobody is out on the water for twice as long as
 * anybody else. Each boat's elapsed time is then scaled up to the full course
 * before it is corrected:
 *
 *   corrected = elapsed × (full-course laps ÷ laps sailed) × TCF
 *
 * The full course is the most laps any boat sailed among the boats ranked
 * against each other — the fleet being scored, not the race or the start.
 * That is what Sailwave does ("the maximum number of laps that any one boat
 * did in the race, or fleet when scoring by fleet") and what HalSail does,
 * a HalSail race being one class's race. Within a fleet the choice cannot
 * change a place, since scaling every time by the same factor keeps their
 * order; what it settles is how big the published corrected times are.
 *
 * A finish with no lap count sailed the full course. That only means
 * something when at least one boat says how many laps the full course was,
 * which is why the finish sheet fills the count in on every row once a race
 * carries laps at all.
 *
 * The scaling applies to time-on-time correction, whatever the rating — PY,
 * a fixed TCF, IRC, ECHO, NHC. A fleet ranked on finishing order has no time
 * to scale, and ORC's time-on-distance and performance-curve corrections are
 * worked out over the course distance; in either, differing lap counts are
 * reported rather than applied.
 */

import type { Finish } from './types';

type LapsFinish = Pick<Finish, 'laps'>;

/** The most laps any of these finishes sailed, or `null` when none of them
 *  records a lap count — every boat sailed the same course, and there is
 *  nothing to scale. */
export function courseLapsOf(finishes: Iterable<LapsFinish>): number | null {
  let most: number | null = null;
  for (const f of finishes) {
    if (f.laps != null && (most === null || f.laps > most)) most = f.laps;
  }
  return most;
}

/** Whether these finishes were sailed over different numbers of laps. A
 *  finish with no count sailed the full course, so a sheet on which only the
 *  short boats carry a count differs too. */
export function lapsDiffer(finishes: Iterable<LapsFinish>): boolean {
  const all = [...finishes];
  const course = courseLapsOf(all);
  return course !== null && all.some((f) => (f.laps ?? course) !== course);
}

/** The elapsed time scaled up to the full course: unchanged for a boat that
 *  sailed it, `elapsed × courseLaps ÷ laps` for one that sailed fewer. Not
 *  rounded — the corrected time is rounded once, after the rating is
 *  applied, so the factor and the rating never round separately. */
export function fullCourseElapsed(
  elapsedSecs: number,
  laps: number | undefined,
  courseLaps: number | null,
): number {
  if (laps == null || courseLaps == null || laps === courseLaps) return elapsedSecs;
  return (elapsedSecs * courseLaps) / laps;
}
