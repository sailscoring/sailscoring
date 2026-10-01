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

/**
 * The races that are a fleet's own, in the order given: every race except
 * those it is not in ({@link racesFleetIsNotIn}) and those struck for it.
 *
 * This is what a fleet's published page shows. Both kinds of race already
 * count for nothing in the fleet's standings, but to a competitor they are not
 * races at all — the class didn't sail the one, and the other was abandoned
 * for it — so a column of dashes for them reads as racing that happened. A
 * race the fleet sailed and nobody finished is still its own: that is a
 * result.
 */
export function fleetOwnRaces<R extends { id: string }>(
  fleetId: string,
  races: readonly R[],
  starts: readonly RaceStart[],
  struck?: ReadonlySet<string>,
): R[] {
  const notIn = racesFleetIsNotIn(fleetId, starts);
  return races.filter((r) => !notIn.has(r.id) && !struck?.has(r.id));
}

/**
 * The sail number a competitor carries in a race whose starts name
 * `raceFleetIds`: the boat drawn for the fleet of hers that is racing, where
 * boats are assigned per fleet (`Competitor.fleetSailNumbers`), and her own
 * number otherwise — including in a race with no starts, where no one fleet
 * is racing.
 */
export function sailNumberInRace(
  competitor: Pick<Competitor, 'sailNumber' | 'fleetIds' | 'fleetSailNumbers'>,
  raceFleetIds: ReadonlySet<string>,
): string {
  const boats = competitor.fleetSailNumbers;
  if (boats) {
    for (const fleetId of competitor.fleetIds) {
      const boat = boats[fleetId]?.trim();
      if (boat && raceFleetIds.has(fleetId)) return boat;
    }
  }
  return competitor.sailNumber;
}

/**
 * The competitors as a race sees them: each carrying the sail number of the
 * boat she sails in it ({@link sailNumberInRace}). Every matcher downstream —
 * keyboard finish entry, the finish-sheet CSV, the RaceSense import — reads
 * `sailNumber`, so handing them this list is what makes a boat drawn for a
 * fleet findable by the number the race committee hails. Competitors without
 * a drawn boat come back as the same object.
 *
 * The result is for matching and display within the race only: it must never
 * be written back as a competitor, or the drawn boat would replace her own
 * number.
 */
export function withRaceSailNumbers(
  competitors: Competitor[],
  starts: readonly RaceStart[],
): Competitor[] {
  const fleetIds = raceFleetIds(starts as RaceStart[]);
  if (fleetIds.size === 0) return competitors;
  return competitors.map((c) => {
    const sail = sailNumberInRace(c, fleetIds);
    return sail === c.sailNumber ? c : { ...c, sailNumber: sail };
  });
}
