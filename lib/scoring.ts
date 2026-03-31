import type { Competitor, Race, Finish, RaceScore, Standing, ResultCode, DiscardThreshold } from './types';

/**
 * Calculate race scores for all competitors in a series.
 *
 * Rules (Low Point, RRS Appendix A):
 *  - finisher:  points = finishing position within fleet
 *  - DNC (or missing finish): points = N + 1 where N = number of competitors (series entries)
 *  - DNF/OCS and other codes:
 *    - A5.2 (dnfScoring = 'seriesEntries', default): points = series entries + 1
 *    - A5.3 (dnfScoring = 'startingArea'): points = starting-area entries + 1.
 *      Starting-area count: if any finish has startPresent=true, count those; otherwise
 *      fall back to counting all non-DNC finishes as a proxy.
 *
 * @param finishes  All Finish records for this race
 * @param competitors  All competitors in the series
 * @param dnfScoring  'seriesEntries' (A5.2, default) or 'startingArea' (A5.3)
 * @returns  Map of competitorId → RaceScore
 */
export function calculateRaceScores(
  finishes: Finish[],
  competitors: Competitor[],
  dnfScoring: 'seriesEntries' | 'startingArea' = 'seriesEntries',
): Map<string, RaceScore> {
  const n = competitors.length;
  const seriesEntryPenalty = n + 1;

  // Under A5.3, compute a per-race penalty for DNF/OCS/etc. (not DNC).
  // DNC always uses seriesEntryPenalty regardless of dnfScoring setting.
  let startingAreaPenalty = seriesEntryPenalty;
  if (dnfScoring === 'startingArea') {
    const hasCheckinData = finishes.some((f) => f.startPresent === true);
    const startingAreaCount = hasCheckinData
      ? finishes.filter((f) => f.startPresent === true).length
      : finishes.filter((f) => f.resultCode !== 'DNC').length;
    startingAreaPenalty = startingAreaCount + 1;
  }

  const finishMap = new Map(finishes.map((f) => [f.competitorId, f]));

  const result = new Map<string, RaceScore>();

  for (const competitor of competitors) {
    const finish = finishMap.get(competitor.id);

    if (!finish) {
      // Missing finish record = implicit DNC — always scores series entries + 1
      result.set(competitor.id, {
        competitorId: competitor.id,
        points: seriesEntryPenalty,
        place: null,
        resultCode: 'DNC',
      });
    } else if (finish.resultCode === 'DNC') {
      // Explicit DNC — always scores series entries + 1 (even under A5.3)
      result.set(competitor.id, {
        competitorId: competitor.id,
        points: seriesEntryPenalty,
        place: null,
        resultCode: 'DNC',
      });
    } else if (finish.resultCode !== null) {
      // DNF, OCS, or other penalty code — uses startingAreaPenalty under A5.3
      result.set(competitor.id, {
        competitorId: competitor.id,
        points: startingAreaPenalty,
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
    } else {
      // Check-in-only record (startPresent=true, no position, no code) — treat as DNF
      result.set(competitor.id, {
        competitorId: competitor.id,
        points: startingAreaPenalty,
        place: null,
        resultCode: 'DNF',
      });
    }
  }

  return result;
}

/**
 * Get the number of discards to apply for a given race count.
 *
 * Thresholds are checked from highest minRaces to lowest; the first matching
 * threshold's discardCount is returned. Returns 0 if no threshold matches.
 *
 * @param raceCount  Number of races sailed
 * @param thresholds  Discard thresholds configured for the series
 */
export function getDiscardCount(
  raceCount: number,
  thresholds: DiscardThreshold[],
): number {
  const sorted = [...thresholds].sort((a, b) => b.minRaces - a.minRaces);
  for (const t of sorted) {
    if (raceCount >= t.minRaces) return t.discardCount;
  }
  return 0;
}

/**
 * Calculate series standings.
 *
 * Races and finishes must cover the same series. Standings are sorted
 * by net_points ascending (lowest wins, after applying discards). Ties broken
 * per RRS A8.2: most first places, then most second places, etc. (using all
 * race points including discards). If still tied, the competitor with the
 * better (lower) score in the most recent race ranks higher.
 *
 * @param competitors  All competitors in the series
 * @param races  All races in the series, sorted by raceNumber ascending
 * @param allFinishes  All finishes in the series
 * @param discardThresholds  Discard rules for this series (default: none)
 * @returns  Standings array sorted by rank
 */
export function calculateStandings(
  competitors: Competitor[],
  races: Race[],
  allFinishes: Finish[],
  discardThresholds: DiscardThreshold[] = [],
  dnfScoring: 'seriesEntries' | 'startingArea' = 'seriesEntries',
): Standing[] {
  if (competitors.length === 0 || races.length === 0) {
    return competitors.map((c, i) => ({
      rank: i + 1,
      competitor: c,
      racePoints: [],
      raceCodes: [],
      totalPoints: 0,
      netPoints: 0,
      raceDiscards: [],
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
    const scores = calculateRaceScores(finishes, competitors, dnfScoring);
    for (const competitor of competitors) {
      const score = scores.get(competitor.id);
      const points = score?.points ?? competitors.length + 1;
      const code = score ? score.resultCode : 'DNC';
      competitorRacePoints.get(competitor.id)!.push(points);
      competitorRaceCodes.get(competitor.id)!.push(code);
    }
  }

  const discardCount = Math.min(
    getDiscardCount(races.length, discardThresholds),
    races.length,
  );

  // Build initial standings with discard info
  const standings: Standing[] = competitors.map((competitor) => {
    const racePoints = competitorRacePoints.get(competitor.id)!;
    const raceCodes = competitorRaceCodes.get(competitor.id)!;
    const totalPoints = racePoints.reduce((sum, p) => sum + p, 0);

    // Determine which races are discarded: pick the N worst (highest points),
    // earliest index first when tied on points.
    const raceDiscards = new Array<boolean>(racePoints.length).fill(false);
    if (discardCount > 0) {
      const indexed = racePoints.map((p, i) => ({ p, i }));
      indexed.sort((a, b) => b.p - a.p || a.i - b.i);
      for (let d = 0; d < discardCount; d++) {
        raceDiscards[indexed[d].i] = true;
      }
    }

    const netPoints = racePoints.reduce(
      (sum, p, i) => sum + (raceDiscards[i] ? 0 : p),
      0,
    );

    return { rank: 0, competitor, racePoints, raceCodes, totalPoints, netPoints, raceDiscards };
  });

  // Sort: lowest net points wins, tie-break per RRS A8.2 (uses all race points)
  standings.sort((a, b) => {
    if (a.netPoints !== b.netPoints) {
      return a.netPoints - b.netPoints;
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
