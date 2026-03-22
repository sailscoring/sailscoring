import type { Competitor, Race, Finish, RaceScore, Standing, ResultCode } from './types';

/**
 * Calculate race scores for all competitors in a series.
 *
 * Rules (Low Point, RRS Appendix A):
 *  - finisher:  points = finishing position within fleet
 *  - DNC/DNF/OCS (or missing finish): points = N + 1 where N = number of competitors
 *
 * @param finishes  All Finish records for this race
 * @param competitors  All competitors in the series
 * @returns  Map of competitorId → RaceScore
 */
export function calculateRaceScores(
  finishes: Finish[],
  competitors: Competitor[],
): Map<string, RaceScore> {
  const n = competitors.length;
  const penaltyPoints = n + 1;
  const finishMap = new Map(finishes.map((f) => [f.competitorId, f]));

  const result = new Map<string, RaceScore>();

  for (const competitor of competitors) {
    const finish = finishMap.get(competitor.id);

    if (!finish) {
      // Missing finish record = implicit DNC
      result.set(competitor.id, {
        competitorId: competitor.id,
        points: penaltyPoints,
        place: null,
        resultCode: 'DNC',
      });
    } else if (finish.resultCode !== null) {
      result.set(competitor.id, {
        competitorId: competitor.id,
        points: penaltyPoints,
        place: null,
        resultCode: finish.resultCode,
      });
    } else if (finish.finishPosition !== null) {
      result.set(competitor.id, {
        competitorId: competitor.id,
        points: finish.finishPosition,
        place: finish.finishPosition,
        resultCode: null,
      });
    }
  }

  return result;
}

/**
 * Calculate series standings.
 *
 * Races and finishes must cover the same series. Standings are sorted
 * by total_points ascending (lowest wins). Ties broken per RRS A8.2:
 * most first places, then most second places, etc. If still tied after
 * all places, the competitor with the better (lower) score in the most
 * recent race ranks higher.
 *
 * @param competitors  All competitors in the series
 * @param races  All races in the series, sorted by raceNumber ascending
 * @param allFinishes  All finishes in the series
 * @returns  Standings array sorted by rank
 */
export function calculateStandings(
  competitors: Competitor[],
  races: Race[],
  allFinishes: Finish[],
): Standing[] {
  if (competitors.length === 0 || races.length === 0) {
    return competitors.map((c, i) => ({
      rank: i + 1,
      competitor: c,
      racePoints: [],
      raceCodes: [],
      totalPoints: 0,
    }));
  }

  // Group finishes by raceId for quick lookup
  const finishesByRace = new Map<string, Finish[]>();
  for (const finish of allFinishes) {
    const list = finishesByRace.get(finish.raceId) ?? [];
    list.push(finish);
    finishesByRace.set(finish.raceId, list);
  }

  // Calculate per-race scores for each competitor
  const competitorRacePoints = new Map<string, number[]>();
  const competitorRaceCodes = new Map<string, (ResultCode | null)[]>();
  for (const competitor of competitors) {
    competitorRacePoints.set(competitor.id, []);
    competitorRaceCodes.set(competitor.id, []);
  }

  for (const race of races) {
    const finishes = finishesByRace.get(race.id) ?? [];
    const scores = calculateRaceScores(finishes, competitors);
    for (const competitor of competitors) {
      const score = scores.get(competitor.id);
      const points = score?.points ?? competitors.length + 1;
      const code = score ? score.resultCode : 'DNC';
      competitorRacePoints.get(competitor.id)!.push(points);
      competitorRaceCodes.get(competitor.id)!.push(code);
    }
  }

  // Build initial standings
  const standings: Standing[] = competitors.map((competitor) => {
    const racePoints = competitorRacePoints.get(competitor.id)!;
    const raceCodes = competitorRaceCodes.get(competitor.id)!;
    const totalPoints = racePoints.reduce((sum, p) => sum + p, 0);
    return { rank: 0, competitor, racePoints, raceCodes, totalPoints };
  });

  // Sort: lowest total wins, tie-break per RRS A8.2
  standings.sort((a, b) => {
    if (a.totalPoints !== b.totalPoints) {
      return a.totalPoints - b.totalPoints;
    }
    return tieBreak(a, b, races.length);
  });

  // Assign ranks (tied competitors share the same rank)
  let rank = 1;
  for (let i = 0; i < standings.length; i++) {
    if (i > 0 && isTied(standings[i - 1], standings[i], races.length)) {
      standings[i].rank = standings[i - 1].rank;
    } else {
      standings[i].rank = rank;
    }
    rank++;
  }

  return standings;
}

/**
 * Tie-break two competitors per RRS A8.2:
 * 1. Most first places (then most second places, etc.)
 * 2. If still tied: better score in the last race
 *
 * Returns negative if a beats b, positive if b beats a.
 */
function tieBreak(a: Standing, b: Standing, raceCount: number): number {
  // Count places for each rank position
  const maxPlace = raceCount + 1;
  for (let place = 1; place <= maxPlace; place++) {
    const aCount = a.racePoints.filter((p) => p === place).length;
    const bCount = b.racePoints.filter((p) => p === place).length;
    if (aCount !== bCount) {
      return bCount - aCount; // more wins = better
    }
  }

  // Last resort: better score in most recent race (last in array)
  for (let i = a.racePoints.length - 1; i >= 0; i--) {
    const diff = a.racePoints[i] - b.racePoints[i];
    if (diff !== 0) return diff;
  }

  return 0;
}

function isTied(a: Standing, b: Standing, raceCount: number): boolean {
  return tieBreak(a, b, raceCount) === 0;
}
