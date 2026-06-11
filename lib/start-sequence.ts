import type { StartGroup } from './types';
import { formatSecondsAsHms, parseHmsToSeconds } from './time-parse';

/**
 * Parse a time string "HH:MM:SS" into total seconds since midnight.
 */
/**
 * Generate race starts from a default start sequence and a first start time.
 *
 * Each start group's `intervalMinutes` is the gap to the previous start. The
 * first group's interval is always 0 (ignored if non-zero).
 *
 * @param groups - The default start sequence groups, in start order
 * @param firstStartTime - The time of the first start, e.g. "14:05:00"
 * @returns Array of { fleetIds, startTime } for each start group
 */
export function generateStarts(
  groups: StartGroup[],
  firstStartTime: string,
): { fleetIds: string[]; startTime: string }[] {
  if (groups.length === 0) return [];

  const baseSeconds = parseHmsToSeconds(firstStartTime) ?? NaN;

  let cumulativeMinutes = 0;
  return groups.map((group, i) => {
    if (i > 0) cumulativeMinutes += group.intervalMinutes;
    return {
      fleetIds: group.fleetIds,
      startTime: formatSecondsAsHms(baseSeconds + cumulativeMinutes * 60),
    };
  });
}
