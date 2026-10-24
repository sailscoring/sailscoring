/**
 * A series' race schedule (ADR-014, Decision 4): every race it scores, sailed
 * or not, by date, with each start's gun and the fleets on it.
 *
 * The schedule is what the scorer entered to score — the races the Races tab
 * generated for the season, their dates, and the guns of their start
 * sequences — and nothing entered only for a calendar. A race is `sailed`
 * exactly when it has a boat row, the rule that decides whether a results
 * page shows it; anything else is `scheduled`, which a past race also is when
 * it was blown out, abandoned, or not yet entered. The schedule does not say
 * which.
 */

import type { Fleet, Race, RaceStart } from './types';

export interface ScheduleStart {
  /** The gun, local `HH:MM:SS`; null where none was set ("as soon as
   *  possible after" a race before it). */
  time: string | null;
  fleetNames: string[];
}

export interface ScheduleRace {
  raceId: string;
  race: number;
  name: string | null;
  date: string | null;
  starts: ScheduleStart[];
  sailed: boolean;
}

/** Guns in time order, an untimed start after the timed ones. */
function byGun(a: ScheduleStart, b: ScheduleStart): number {
  if (a.time === b.time) return 0;
  if (a.time === null) return 1;
  if (b.time === null) return -1;
  return a.time.localeCompare(b.time);
}

export function buildSchedule(input: {
  races: readonly Race[];
  raceStarts: readonly RaceStart[];
  fleets: readonly Fleet[];
  /** The races with at least one boat row. */
  sailedRaceIds: ReadonlySet<string>;
}): ScheduleRace[] {
  const fleetName = new Map(input.fleets.map((f) => [f.id, f.name]));
  return [...input.races]
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.raceNumber - b.raceNumber)
    .map((race) => ({
      raceId: race.id,
      race: race.raceNumber,
      name: race.name ?? null,
      date: race.date || null,
      starts: input.raceStarts
        .filter((s) => s.raceId === race.id)
        .map((s) => ({
          time: s.startTime || null,
          fleetNames: s.fleetIds.flatMap((id) => {
            const name = fleetName.get(id);
            return name ? [name] : [];
          }),
        }))
        .sort(byGun),
      sailed: input.sailedRaceIds.has(race.id),
    }));
}
