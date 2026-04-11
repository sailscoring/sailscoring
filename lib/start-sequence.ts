import type { StartGroup } from './types';

/**
 * Parse a time string "HH:MM:SS" into total seconds since midnight.
 */
function parseTime(time: string): number {
  const [h, m, s] = time.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

/**
 * Format total seconds since midnight into "HH:MM:SS".
 */
function formatTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Generate race starts from a default start sequence and a first start time.
 *
 * Each start group in the sequence has an offset in minutes from the first start.
 * The first group's offset is always 0 (ignored if non-zero).
 *
 * @param groups - The default start sequence groups (sorted by offset)
 * @param firstStartTime - The time of the first start, e.g. "14:05:00"
 * @returns Array of { fleetIds, startTime } for each start group
 */
export function generateStarts(
  groups: StartGroup[],
  firstStartTime: string,
): { fleetIds: string[]; startTime: string }[] {
  if (groups.length === 0) return [];

  const baseSeconds = parseTime(firstStartTime);

  return groups.map((group, i) => ({
    fleetIds: group.fleetIds,
    startTime: formatTime(baseSeconds + (i === 0 ? 0 : group.offsetMinutes * 60)),
  }));
}
