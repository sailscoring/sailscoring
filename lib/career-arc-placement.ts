/**
 * Pure placement extraction for the career-arc page (#212): given a series'
 * computed fleet standings, find where one competitor finished. Kept separate
 * from the data assembly (`career-arc.ts`, which loads + scores) so the lookup
 * rule is unit-testable without a database.
 */

import type { FleetStandingsResult } from './scoring';

/** A competitor's finishing position in one series. Nulls when not rankable —
 *  an orphaned row, or a series with no races yet. */
export interface ArcPlacement {
  /** Finishing rank within the fleet (1 = first), or null if not placed. */
  rank: number | null;
  /** Number of boats in that fleet's standings (the "of N"). */
  fleetSize: number | null;
  /** Fleet name, only when the series has more than one fleet (otherwise the
   *  series name already says which fleet it is). */
  fleetName: string | null;
}

const UNPLACED: ArcPlacement = { rank: null, fleetSize: null, fleetName: null };

/**
 * Locate `competitorId` in the fleet standings and report its rank, the fleet
 * size, and (for multi-fleet series) the fleet name. A series with no races
 * isn't rankable — every boat would tie on zero — so `hasRaces` short-circuits
 * to unplaced.
 */
export function placementInStandings(
  result: FleetStandingsResult,
  competitorId: string,
  opts: { hasRaces: boolean; multiFleet: boolean },
): ArcPlacement {
  if (!opts.hasRaces) return UNPLACED;
  for (const fs of result.fleetStandings) {
    const standing = fs.standings.find((s) => s.competitor.id === competitorId);
    if (standing) {
      return {
        rank: standing.rank,
        fleetSize: fs.standings.length,
        fleetName: opts.multiFleet ? fs.fleet.name : null,
      };
    }
  }
  return UNPLACED;
}
