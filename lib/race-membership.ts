import type { Competitor, RaceStart } from './types';

/**
 * The set of fleet ids that have a start — timed or membership-only — in a
 * race. An empty set means no starts are recorded, in which case every fleet
 * is implied to be racing (see {@link competitorsInRace}).
 */
export function raceFleetIds(starts: RaceStart[]): Set<string> {
  return new Set(starts.flatMap((s) => s.fleetIds));
}

/**
 * The competitors taking part in a race, scoped by its starts' fleets. A boat
 * is in the race when one of its fleets has a start (a gun time, or a
 * membership-only start that just names the fleet). With no starts recorded,
 * every fleet is implied, so all competitors are returned — matching how
 * scoring degrades to scratch when a race has no start.
 */
export function competitorsInRace(
  competitors: Competitor[],
  starts: RaceStart[],
): Competitor[] {
  const fleetIds = raceFleetIds(starts);
  if (fleetIds.size === 0) return competitors;
  return competitors.filter((c) => c.fleetIds.some((id) => fleetIds.has(id)));
}
