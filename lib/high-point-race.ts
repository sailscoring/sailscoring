/**
 * A high-point race on the scorer's side: the fleet size each fleet's points
 * are scored from, and the boats a "declared to race" code can be given.
 */

import { oneFinishPerCompetitor } from './finish-rows';
import { CHANGEABLE_BUILT_IN_CODES, type ScoringCodeTable } from './scoring-codes';
import type { Competitor, Finish, Fleet, SeriesScoringCode } from './types';

/** Each fleet's n in a race: its boats with a row whose result counts
 *  toward the fleet size. Fleets with no boat in the race are left out. */
export function raceFleetSizes(
  fleets: readonly Fleet[],
  competitors: readonly Competitor[],
  finishes: readonly Finish[],
  codes: ScoringCodeTable,
): { fleet: Fleet; fleetSize: number }[] {
  const counted = new Set(
    oneFinishPerCompetitor([...finishes])
      .filter((f) => f.competitorId !== null && (f.resultCode === null || codes.countsInFleetSize(f.resultCode)))
      .map((f) => f.competitorId as string),
  );
  return [...fleets]
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((fleet) => ({
      fleet,
      fleetSize: competitors.filter((c) => c.fleetIds.includes(fleet.id) && counted.has(c.id)).length,
    }))
    .filter((e) => e.fleetSize > 0);
}

/** The series' own codes a boat that declared and didn't race can be given:
 *  codes that replace the result and count toward the fleet size, ISORA's
 *  DTP. Empty for most series, which then aren't offered the action. */
export function declaredCodes(scoringCodes: readonly SeriesScoringCode[] = []): SeriesScoringCode[] {
  return scoringCodes.filter(
    (c) => c.kind === 'replace' && !CHANGEABLE_BUILT_IN_CODES.includes(c.code) && c.countsInFleetSize !== false,
  );
}

/** The boats in a race with nothing recorded for them: the ones a declared
 *  code can be given to. */
export function boatsWithNoResult(competitors: readonly Competitor[], finishes: readonly Finish[]): Competitor[] {
  const recorded = new Set(finishes.map((f) => f.competitorId).filter((id): id is string => id !== null));
  return competitors.filter((c) => !recorded.has(c.id));
}
