/**
 * Last-finisher times and protest time limits.
 *
 * The protest / request-for-redress time limit is anchored on when the last
 * boat in a race finishes (RRS 60.3(b): two hours after, unless the SIs state
 * a different limit — commonly "N minutes after the last boat finishes the
 * last race of the day"). These helpers resolve a race's effective
 * last-finisher time — from the finish sheet when finishes were timed, from
 * the manually recorded `Race.lastFinisherTime` otherwise — and turn the
 * series' configured `ProtestTimeLimit` into a concrete end time. The
 * finalise checklist and the races-page recency strip both read from here.
 *
 * All functions are pure; times are wall-clock "HH:MM:SS" strings and dates
 * ISO "YYYY-MM-DD" strings, combined in the local timezone (the existing
 * convention: club racing has no cross-timezone story).
 */

import type { Finish, ProtestTimeLimit, Race } from './types';
import { parseHmsToSeconds } from './time-parse';

export interface LastFinisher {
  /** Wall-clock "HH:MM:SS" of the last boat's finish. */
  time: string;
  /** Where the time came from: the finish sheet (authoritative whenever any
   *  finish row carries a time) or the race's manual field. */
  source: 'finishes' | 'manual';
}

/**
 * The race's effective last-finisher time. Any timed finish row makes the
 * sheet authoritative — the latest recorded crossing wins, coded rows
 * included (a boat later scored RET still crossed, and the protest window
 * runs from the last boat home). The manual field is only consulted when the
 * sheet carries no times at all.
 */
export function effectiveLastFinisherTime(
  race: Race,
  finishes: Finish[],
): LastFinisher | null {
  let latest: string | null = null;
  let latestSeconds = -1;
  for (const f of finishes) {
    const seconds = parseHmsToSeconds(f.finishTime);
    if (seconds == null) continue;
    if (seconds > latestSeconds) {
      latestSeconds = seconds;
      latest = f.finishTime!;
    }
  }
  if (latest != null) return { time: latest, source: 'finishes' };
  if (parseHmsToSeconds(race.lastFinisherTime) != null) {
    return { time: race.lastFinisherTime!, source: 'manual' };
  }
  return null;
}

/** The last race of the event: latest date, race number breaking ties.
 *  This is the race RRS 90.3(e) anchors the series-finality window on. */
export function lastRaceOfSeries(races: Race[]): Race | null {
  let last: Race | null = null;
  for (const r of races) {
    if (
      last == null ||
      r.date > last.date ||
      (r.date === last.date && r.raceNumber > last.raceNumber)
    ) {
      last = r;
    }
  }
  return last;
}

export interface LastKnownFinish {
  race: Race;
  lastFinisher: LastFinisher;
}

/**
 * The most recent race that has an effective last-finisher time — latest
 * date first, race number breaking ties. Feeds the races-page recency strip
 * ("Last finisher (Race 6): 15:42 · 1h 05m ago"). Null when no race has a
 * time yet.
 */
export function lastKnownFinish(
  races: Race[],
  finishesByRace: Map<string, Finish[]>,
): LastKnownFinish | null {
  let best: LastKnownFinish | null = null;
  for (const race of races) {
    const lastFinisher = effectiveLastFinisherTime(
      race,
      finishesByRace.get(race.id) ?? [],
    );
    if (!lastFinisher) continue;
    if (
      best == null ||
      race.date > best.race.date ||
      (race.date === best.race.date && race.raceNumber > best.race.raceNumber)
    ) {
      best = { race, lastFinisher };
    }
  }
  return best;
}

/**
 * The concrete end of the protest time limit for `race`, or null when it
 * can't be computed (no limit configured, no last-finisher time, or the race
 * has no date).
 *
 * Basis 'race' runs the clock from this race's own last finisher (the RRS
 * default); basis 'day' from the latest last-finisher across every race
 * sharing this race's date (the common club SI: "after the last boat
 * finishes the last race of the day"). Built as midnight-of-race-date plus
 * seconds, so a limit that crosses midnight lands on the next day rather
 * than wrapping.
 */
export function protestTimeLimitEnd(
  limit: ProtestTimeLimit | undefined,
  race: Race,
  races: Race[],
  finishesByRace: Map<string, Finish[]>,
): Date | null {
  if (!limit || !race.date) return null;

  let anchorSeconds: number | null = null;
  const anchorRaces =
    limit.basis === 'day' ? races.filter((r) => r.date === race.date) : [race];
  for (const r of anchorRaces) {
    const lastFinisher = effectiveLastFinisherTime(
      r,
      finishesByRace.get(r.id) ?? [],
    );
    if (!lastFinisher) continue;
    const seconds = parseHmsToSeconds(lastFinisher.time);
    if (seconds == null) continue;
    if (anchorSeconds == null || seconds > anchorSeconds) anchorSeconds = seconds;
  }
  if (anchorSeconds == null) return null;

  const midnight = new Date(`${race.date}T00:00:00`);
  if (isNaN(midnight.getTime())) return null;
  return new Date(
    midnight.getTime() + (anchorSeconds + limit.minutes * 60) * 1000,
  );
}
