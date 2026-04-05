import type { Competitor, Fleet, Race, Finish, RaceScore, Standing, ResultCode, PenaltyCode, DiscardThreshold } from './types';
import { getCodeDefinition } from './scoring-codes';

/**
 * Calculate race scores for all competitors in a series.
 *
 * Rules (Low Point, RRS Appendix A):
 *  - finisher:  points = finishing position within fleet
 *  - Coded result: points determined by the code's ScoringCodeDefinition.
 *    penaltyBase 'entries' → series entries + 1 (always; e.g. DNC, BFD)
 *    penaltyBase 'starters' → depends on dnfScoring:
 *      'seriesEntries' (A5.2, default): series entries + 1
 *      'startingArea'  (A5.3): starting-area entries + 1
 *  - Missing finish record → implicit DNC (entries + 1)
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

  // Under A5.3, compute a per-race penalty for 'starters'-base codes.
  // 'entries'-base codes (DNC, BFD) always use seriesEntryPenalty regardless.
  let startingAreaPenalty = seriesEntryPenalty;
  if (dnfScoring === 'startingArea') {
    const hasCheckinData = finishes.some((f) => f.startPresent === true);
    const startingAreaCount = hasCheckinData
      ? finishes.filter((f) => f.startPresent === true).length
      : finishes.filter((f) => f.resultCode !== 'DNC').length;
    startingAreaPenalty = startingAreaCount + 1;
  }

  const finishMap = new Map(
    finishes
      .filter((f): f is Finish & { competitorId: string } => f.competitorId !== null)
      .map((f) => [f.competitorId, f]),
  );

  const result = new Map<string, RaceScore>();

  for (const competitor of competitors) {
    const finish = finishMap.get(competitor.id);

    if (!finish) {
      // Missing finish record = implicit DNC — always series entries + 1
      result.set(competitor.id, {
        competitorId: competitor.id,
        points: seriesEntryPenalty,
        place: null,
        rank: null,
        resultCode: 'DNC',
      });
    } else if (finish.resultCode !== null) {
      const def = getCodeDefinition(finish.resultCode);
      const points = penaltyPoints(def?.pointsMethod ?? { type: 'fixed_penalty', penaltyBase: 'entries' }, seriesEntryPenalty, startingAreaPenalty);
      result.set(competitor.id, {
        competitorId: competitor.id,
        points,
        place: null,
        rank: null,
        resultCode: finish.resultCode,
      });
    } else if (finish.finishPosition !== null) {
      result.set(competitor.id, {
        competitorId: competitor.id,
        points: 0,       // assigned below after within-fleet rank is computed
        place: finish.finishPosition,
        rank: null,      // assigned below
        resultCode: null,
      });
    } else {
      // Check-in-only record (startPresent=true, no position, no code) — treat as DNF
      result.set(competitor.id, {
        competitorId: competitor.id,
        points: startingAreaPenalty,
        place: null,
        rank: null,
        resultCode: 'DNF',
      });
    }
  }

  // Assign within-fleet sequential ranks and average points for tied boats (RRS A8.1).
  // Sort finishers by cross-fleet place; assign fleet ranks 1, 2, 3 … in that order.
  // Boats tied on the water (equal finishPosition) share averaged consecutive ranks.
  const finishers = [...result.entries()]
    .filter(([, score]) => score.place !== null)
    .sort((a, b) => a[1].place! - b[1].place! || a[0].localeCompare(b[0]));

  let fleetRank = 1;
  let fi = 0;
  while (fi < finishers.length) {
    const pos = finishers[fi][1].place!;
    // Find all boats tied at this cross-fleet position
    let fj = fi;
    while (fj < finishers.length && finishers[fj][1].place === pos) fj++;
    const tiedCount = fj - fi;
    // They occupy fleet ranks fleetRank … fleetRank+tiedCount-1; average those ranks.
    const baseRank = fleetRank;
    const avgPoints = fleetRank + (tiedCount - 1) / 2;
    for (let k = fi; k < fj; k++) {
      const [cId, score] = finishers[k];
      result.set(cId, { ...score, rank: baseRank, points: avgPoints });
    }
    fleetRank += tiedCount;
    fi = fj;
  }

  // Apply additive penalty codes (ZFP, SCP, DPI) to finishers.
  // Per A6.2 other boats are NOT re-ranked; duplicate scores are allowed.
  // Cap: penalised score cannot exceed the DNF score (startingAreaPenalty).
  for (const competitor of competitors) {
    const finish = finishMap.get(competitor.id);
    if (!finish?.penaltyCode) continue;
    const score = result.get(competitor.id);
    if (!score || score.place === null) continue; // only apply to finishers

    const def = getCodeDefinition(finish.penaltyCode);
    if (!def) continue;

    const method = def.pointsMethod;
    const cap = startingAreaPenalty; // DNF score (starters base) is the ceiling
    let penalized = score.points;

    if (method.type === 'additive_percentage') {
      const pct = finish.penaltyOverride ?? method.defaultPct;
      penalized = Math.min(score.points + Math.round(pct / 100 * cap), cap);
    } else if (method.type === 'additive_stated') {
      const pts = finish.penaltyOverride ?? 0;
      penalized = Math.min(score.points + pts, cap);
    }

    result.set(competitor.id, { ...score, points: penalized });
  }

  return result;
}

/**
 * Resolve penalty points for fixed-penalty result codes (DNC, DNS, OCS, etc.).
 * Additive penalty codes (ZFP, SCP, DPI) are handled separately in calculateRaceScores.
 */
function penaltyPoints(
  method: import('./scoring-codes').PointsMethod,
  seriesEntryPenalty: number,
  startingAreaPenalty: number,
): number {
  if (method.type === 'fixed_penalty') {
    return method.penaltyBase === 'entries' ? seriesEntryPenalty : startingAreaPenalty;
  }
  // Additive methods should not appear as resultCode definitions; fall back to entries+1.
  return seriesEntryPenalty;
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
 * Non-discardable codes (DNE, BFD) are protected from discard selection even
 * when they are the worst score.
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
  const competitorIds = new Set(competitors.map((c) => c.id));

  if (competitors.length === 0 || races.length === 0) {
    return competitors.map((c, i) => ({
      rank: i + 1,
      competitor: c,
      racePoints: [],
      raceCodes: [],
      racePenaltyCodes: [],
      racePenaltyOverrides: [],
      totalPoints: 0,
      netPoints: 0,
      raceDiscards: [],
      raceNonDiscardable: [],
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
  const competitorRacePenaltyCodes = new Map<string, (PenaltyCode | null)[]>();
  const competitorRacePenaltyOverrides = new Map<string, (number | null)[]>();
  for (const competitor of competitors) {
    competitorRacePoints.set(competitor.id, []);
    competitorRaceCodes.set(competitor.id, []);
    competitorRacePenaltyCodes.set(competitor.id, []);
    competitorRacePenaltyOverrides.set(competitor.id, []);
  }

  for (const race of races) {
    const raceFinishes = (finishesByRace.get(race.id) ?? []).filter((f) => f.competitorId !== null && competitorIds.has(f.competitorId));
    const raceFinishMap = new Map(raceFinishes.map((f) => [f.competitorId!, f]));
    const scores = calculateRaceScores(raceFinishes, competitors, dnfScoring);
    for (const competitor of competitors) {
      const score = scores.get(competitor.id);
      const points = score?.points ?? competitors.length + 1;
      const code = score ? score.resultCode : 'DNC';
      const finish = raceFinishMap.get(competitor.id);
      competitorRacePoints.get(competitor.id)!.push(points);
      competitorRaceCodes.get(competitor.id)!.push(code);
      competitorRacePenaltyCodes.get(competitor.id)!.push(finish?.penaltyCode ?? null);
      competitorRacePenaltyOverrides.get(competitor.id)!.push(finish?.penaltyOverride ?? null);
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
    const racePenaltyCodes = competitorRacePenaltyCodes.get(competitor.id)!;
    const racePenaltyOverrides = competitorRacePenaltyOverrides.get(competitor.id)!;
    const totalPoints = racePoints.reduce((sum, p) => sum + p, 0);

    // Determine non-discardable flags from code definitions
    const raceNonDiscardable = raceCodes.map((code) => {
      if (!code) return false;
      const def = getCodeDefinition(code);
      return def ? !def.discardable : false;
    });

    // Select worst N discardable scores to discard; non-discardable races are skipped.
    const raceDiscards = new Array<boolean>(racePoints.length).fill(false);
    if (discardCount > 0) {
      const discardable = racePoints
        .map((p, i) => ({ p, i }))
        .filter(({ i }) => !raceNonDiscardable[i]);
      discardable.sort((a, b) => b.p - a.p || a.i - b.i);
      const effectiveCount = Math.min(discardCount, discardable.length);
      for (let d = 0; d < effectiveCount; d++) {
        raceDiscards[discardable[d].i] = true;
      }
    }

    const netPoints = racePoints.reduce(
      (sum, p, i) => sum + (raceDiscards[i] ? 0 : p),
      0,
    );

    return { rank: 0, competitor, racePoints, raceCodes, racePenaltyCodes, racePenaltyOverrides, totalPoints, netPoints, raceDiscards, raceNonDiscardable };
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
 * Calculate series standings grouped by fleet.
 *
 * Each fleet is scored independently: the penalty point base N is the fleet
 * size, not the total competitor count. Fleets are returned in displayOrder.
 *
 * Competitors whose fleetId does not match any supplied fleet are grouped into
 * a synthetic "Unknown" fleet at the end (should not happen after migration).
 *
 * @param fleets  All fleets in the series, in displayOrder
 * @param competitors  All competitors in the series
 * @param races  All races in the series, sorted by raceNumber ascending
 * @param allFinishes  All finishes in the series
 * @param discardThresholds  Discard rules for this series
 * @param dnfScoring  'seriesEntries' (A5.2, default) or 'startingArea' (A5.3)
 */
export function calculateFleetStandings(
  fleets: Fleet[],
  competitors: Competitor[],
  races: Race[],
  allFinishes: Finish[],
  discardThresholds: DiscardThreshold[] = [],
  dnfScoring: 'seriesEntries' | 'startingArea' = 'seriesEntries',
): { fleet: Fleet; standings: Standing[] }[] {
  const sorted = [...fleets].sort((a, b) => a.displayOrder - b.displayOrder);
  const knownFleetIds = new Set(fleets.map((f) => f.id));

  const competitorsByFleet = new Map<string, Competitor[]>();
  const orphans: Competitor[] = [];
  for (const competitor of competitors) {
    if (knownFleetIds.has(competitor.fleetId)) {
      const list = competitorsByFleet.get(competitor.fleetId) ?? [];
      list.push(competitor);
      competitorsByFleet.set(competitor.fleetId, list);
    } else {
      orphans.push(competitor);
    }
  }

  const result: { fleet: Fleet; standings: Standing[] }[] = sorted.map((fleet) => ({
    fleet,
    standings: calculateStandings(
      competitorsByFleet.get(fleet.id) ?? [],
      races,
      allFinishes,
      discardThresholds,
      dnfScoring,
    ),
  }));

  if (orphans.length > 0) {
    const unknownFleet: Fleet = { id: '__unknown__', seriesId: '', name: 'Unknown', displayOrder: 9999 };
    result.push({
      fleet: unknownFleet,
      standings: calculateStandings(orphans, races, allFinishes, discardThresholds, dnfScoring),
    });
  }

  return result;
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
