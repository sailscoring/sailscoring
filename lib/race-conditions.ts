/**
 * Per-race conditions — the shared vocabulary behind `Race.conditions`.
 *
 * Pure, so the race header, the published page and (in time) the scoring
 * engine read the same figure out of the same block. That matters more here
 * than for a display-only field: ORC performance-curve scoring selects a
 * boat's rating from the wind on the course sailed, so `averageWindSpeed` is
 * written once now rather than reimplemented when that work starts.
 */

import type { CompassPoint, RaceConditions } from './types';

/** The 16 points, clockwise from north — picker order and display order. */
export const COMPASS_POINTS: readonly CompassPoint[] = [
  'N', 'NNE', 'NE', 'ENE',
  'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW',
  'W', 'WNW', 'NW', 'NNW',
];

export const RACE_NOTES_MAX_LENGTH = 500;

/** Generous upper bound on a recorded wind speed. Racing stops long before
 *  this; the bound only excludes the nonsensical (a knots/kph mix-up, a
 *  fat-fingered extra digit). */
export const WIND_SPEED_MAX = 150;

export function isCompassPoint(value: unknown): value is CompassPoint {
  return typeof value === 'string' && (COMPASS_POINTS as readonly string[]).includes(value);
}

/** Whether the block holds anything worth showing. */
export function hasConditions(conditions: RaceConditions | undefined): boolean {
  if (!conditions) return false;
  return (
    conditions.windSpeedMin != null ||
    conditions.windSpeedMax != null ||
    conditions.windDirection != null ||
    (conditions.notes ?? '').trim() !== ''
  );
}

/**
 * The wind speed a rating band is selected from — ORC's triple-number scheme
 * averages the race officer's stipulated minimum and maximum.
 *
 * With only one of the two recorded, that figure is the average: a single
 * stipulated speed is a range of zero width, not half a range. Undefined when
 * neither is recorded.
 */
export function averageWindSpeed(conditions: RaceConditions | undefined): number | undefined {
  const min = conditions?.windSpeedMin;
  const max = conditions?.windSpeedMax;
  if (min != null && max != null) return (min + max) / 2;
  return min ?? max ?? undefined;
}

/** "8–14 kt", "8 kt", or empty. An en dash, since it's a range. */
export function formatWindSpeed(conditions: RaceConditions | undefined): string {
  const min = conditions?.windSpeedMin;
  const max = conditions?.windSpeedMax;
  if (min != null && max != null) {
    return min === max ? `${min} kt` : `${min}–${max} kt`;
  }
  const single = min ?? max;
  return single != null ? `${single} kt` : '';
}

/** "Wind 8–14 kt SW", "Wind SW", or empty when no wind was recorded. */
export function formatWind(conditions: RaceConditions | undefined): string {
  const parts = [formatWindSpeed(conditions), conditions?.windDirection ?? ''].filter(Boolean);
  return parts.length > 0 ? `Wind ${parts.join(' ')}` : '';
}

/**
 * The whole block as one line for a race header or a published subheading:
 * "Wind 8–14 kt SW · Windward-leeward, 3 laps; ebb tide".
 *
 * The note is appended verbatim rather than labelled "Course", since the field
 * takes the course, the tide, or whatever else the scorer wants on the record.
 * Empty when nothing is recorded.
 */
export function formatConditions(conditions: RaceConditions | undefined): string {
  const notes = (conditions?.notes ?? '').trim();
  return [formatWind(conditions), notes].filter(Boolean).join(' · ');
}

/**
 * Why a wind range is unusable, or null when it's fine. Only the ordering is
 * cross-field — the bounds are per-value and enforced at the validation
 * boundary too; this is what the dialog says out loud while typing.
 */
export function windRangeError(conditions: RaceConditions | undefined): string | null {
  const min = conditions?.windSpeedMin;
  const max = conditions?.windSpeedMax;
  if (min != null && max != null && min > max) {
    return 'Minimum wind speed is above the maximum.';
  }
  return null;
}
