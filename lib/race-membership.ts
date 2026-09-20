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

/**
 * The races a fleet is *not* in: those that have a start for some fleet, but
 * none for this one.
 *
 * The starts are the statement of who sailed a race, and a race with no starts
 * at all has not been scoped yet — so there every fleet is implied, the same
 * rule {@link competitorsInRace} applies to the finish sheet. Scoring uses
 * this to leave such a race out of a fleet's standings entirely: deleting a
 * start doesn't touch the result rows behind it, and results also arrive by
 * import and by file round-trip, so a row can outlive the membership that
 * made it scoreable. Left in, one stale row counts the whole race for the
 * fleet and hands every other boat in it a DNC.
 */
export function racesFleetIsNotIn(
  fleetId: string,
  starts: readonly RaceStart[],
): Set<string> {
  const anyStart = new Set<string>();
  const fleetStart = new Set<string>();
  for (const s of starts) {
    anyStart.add(s.raceId);
    if (s.fleetIds.includes(fleetId)) fleetStart.add(s.raceId);
  }
  return new Set([...anyStart].filter((raceId) => !fleetStart.has(raceId)));
}
