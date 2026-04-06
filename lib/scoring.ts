import type { Competitor, Fleet, Race, Finish, RaceScore, HandicapRaceScore, RaceStart, Standing, ResultCode, PenaltyCode, DiscardThreshold } from './types';
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
 * Derive the Time Correction Factor for a competitor in a handicap fleet.
 * IRC: TCF = TCC (stored directly on the competitor).
 * PY:  TCF = 1000 / pyNumber.
 * Returns null if the competitor has no rating for the fleet's scoring system.
 */
function getTCF(competitor: Competitor, fleet: Fleet): number | null {
  if (fleet.scoringSystem === 'irc') {
    return competitor.ircTcc ?? null;
  }
  if (fleet.scoringSystem === 'py') {
    return competitor.pyNumber != null ? 1000 / competitor.pyNumber : null;
  }
  return null;
}

/**
 * Parse an "HH:MM:SS" time string into seconds-since-midnight.
 * Returns null if the string is missing or malformed.
 */
function parseTimeToSeconds(t: string | undefined): number | null {
  if (!t) return null;
  const parts = t.split(':').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  const [h, m, s] = parts;
  return h * 3600 + m * 60 + s;
}

/**
 * Calculate handicap race scores for a single fleet using time-on-time correction (IRC/PY).
 *
 * CT = ET × TCF,  where ET = finishTime − startTime (both in seconds-since-midnight).
 * Competitors rank by lowest CT; points assign 1, 2, 3… as in scratch.
 * Coded finishes (DNS, DNF, etc.) receive fleet-size-based penalty points — no time needed.
 * A competitor with no rating gets penalty points but place/CT are null.
 *
 * @param finishes  All Finish records for this race (may span multiple fleets)
 * @param competitors  Competitors in this fleet only
 * @param raceStart  The RaceStart that covers this fleet (provides gun time)
 * @param fleet  The fleet being scored (determines scoringSystem / TCF derivation)
 */
export function calculateHandicapRaceScores(
  finishes: Finish[],
  competitors: Competitor[],
  raceStart: RaceStart,
  fleet: Fleet,
): Map<string, HandicapRaceScore> {
  const n = competitors.length;
  const penaltyPoints = n + 1;
  const startSeconds = parseTimeToSeconds(raceStart.startTime);

  const finishMap = new Map(
    finishes
      .filter((f): f is Finish & { competitorId: string } => f.competitorId !== null)
      .map((f) => [f.competitorId, f]),
  );

  // First pass: compute ET, CT, TCF for each competitor; collect scored finishes
  interface Candidate {
    competitorId: string;
    elapsedTime: number | null;
    correctedTime: number | null;
    tcfApplied: number | null;
    resultCode: ResultCode | null;
    isFinisher: boolean; // has a finish time and a valid TCF
  }

  const candidates: Candidate[] = [];
  for (const competitor of competitors) {
    const finish = finishMap.get(competitor.id);
    const tcf = getTCF(competitor, fleet);

    if (!finish) {
      // Implicit DNC
      candidates.push({ competitorId: competitor.id, elapsedTime: null, correctedTime: null, tcfApplied: null, resultCode: 'DNC', isFinisher: false });
      continue;
    }

    if (finish.resultCode !== null) {
      // Explicit result code — no time scoring
      candidates.push({ competitorId: competitor.id, elapsedTime: null, correctedTime: null, tcfApplied: null, resultCode: finish.resultCode, isFinisher: false });
      continue;
    }

    const finishSeconds = parseTimeToSeconds(finish.finishTime);

    if (finishSeconds === null || startSeconds === null) {
      // Missing time data — treat as DNF
      candidates.push({ competitorId: competitor.id, elapsedTime: null, correctedTime: null, tcfApplied: null, resultCode: 'DNF', isFinisher: false });
      continue;
    }

    const et = finishSeconds - startSeconds;
    const ct = tcf !== null ? et * tcf : null;
    candidates.push({
      competitorId: competitor.id,
      elapsedTime: et,
      correctedTime: ct,
      tcfApplied: tcf,
      resultCode: null,
      isFinisher: ct !== null,
    });
  }

  // Sort finishers by corrected time ascending; stable sort (by competitorId for ties)
  const finishers = candidates
    .filter((c) => c.isFinisher)
    .sort((a, b) => a.correctedTime! - b.correctedTime! || a.competitorId.localeCompare(b.competitorId));

  // Build result map
  const result = new Map<string, HandicapRaceScore>();

  // Assign ranks and points to finishers (tied CT = averaged ranks, same as scratch)
  let fleetRank = 1;
  let fi = 0;
  while (fi < finishers.length) {
    const ct = finishers[fi].correctedTime!;
    let fj = fi;
    while (fj < finishers.length && finishers[fj].correctedTime === ct) fj++;
    const tiedCount = fj - fi;
    const avgPoints = fleetRank + (tiedCount - 1) / 2;
    for (let k = fi; k < fj; k++) {
      const c = finishers[k];
      result.set(c.competitorId, {
        competitorId: c.competitorId,
        points: avgPoints,
        place: fi + 1,  // crossing-order position within fleet (1-based)
        rank: fleetRank,
        resultCode: null,
        elapsedTime: c.elapsedTime,
        correctedTime: c.correctedTime,
        tcfApplied: c.tcfApplied,
      });
    }
    fleetRank += tiedCount;
    fi = fj;
  }

  // Assign penalty points to non-finishers and no-rating competitors
  for (const c of candidates) {
    if (result.has(c.competitorId)) continue; // already scored as finisher
    if (c.isFinisher) continue; // shouldn't happen

    if (c.resultCode !== null) {
      const def = getCodeDefinition(c.resultCode);
      // For handicap, always use fleet-size-based penalty (no A5.3 distinction)
      const pts = (def?.pointsMethod.type === 'fixed_penalty') ? penaltyPoints : penaltyPoints;
      result.set(c.competitorId, {
        competitorId: c.competitorId,
        points: pts,
        place: null,
        rank: null,
        resultCode: c.resultCode,
        elapsedTime: c.elapsedTime,
        correctedTime: null,
        tcfApplied: c.tcfApplied,
      });
    } else {
      // No rating — scored as DNF-equivalent, place is null
      result.set(c.competitorId, {
        competitorId: c.competitorId,
        points: penaltyPoints,
        place: null,
        rank: null,
        resultCode: null,
        elapsedTime: c.elapsedTime,
        correctedTime: null,
        tcfApplied: null,
      });
    }
  }

  return result;
}

/**
 * Round x to the nearest tenth; 0.05 rounds up, per RRS Appendix A9.
 * Used for redress (RDG) averages.
 */
function roundToTenth(x: number): number {
  return Math.floor(x * 10 + 0.5) / 10;
}

/**
 * Resolve penalty points for fixed-penalty result codes (DNC, DNS, OCS, etc.).
 * Additive penalty codes (ZFP, SCP, DPI) are handled separately in calculateRaceScores.
 * Redress (RDG) scores are handled separately in calculateStandings second pass.
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
): { standings: Standing[]; circularRedressRaces: number[] } {
  const competitorIds = new Set(competitors.map((c) => c.id));

  if (competitors.length === 0 || races.length === 0) {
    return {
      standings: competitors.map((c, i) => ({
        rank: i + 1,
        competitor: c,
        racePoints: [],
        raceCodes: [],
        racePenaltyCodes: [],
        racePenaltyOverrides: [],
        raceRedressFlags: [],
        totalPoints: 0,
        netPoints: 0,
        raceDiscards: [],
        raceNonDiscardable: [],
      })),
      circularRedressRaces: [],
    };
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
  const competitorRaceRedressFlags = new Map<string, boolean[]>();
  for (const competitor of competitors) {
    competitorRacePoints.set(competitor.id, []);
    competitorRaceCodes.set(competitor.id, []);
    competitorRacePenaltyCodes.set(competitor.id, []);
    competitorRacePenaltyOverrides.set(competitor.id, []);
    competitorRaceRedressFlags.set(competitor.id, []);
  }

  // Collect RDG finishes for the second pass: raceId → [competitorIds with RDG]
  const rdgByRaceId = new Map<string, string[]>();
  // All RDG assignments: { competitorId, raceIdx, finish }
  const rdgAssignments: Array<{ competitorId: string; raceIdx: number; finish: Finish }> = [];

  for (let raceIdx = 0; raceIdx < races.length; raceIdx++) {
    const race = races[raceIdx];
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
      competitorRaceRedressFlags.get(competitor.id)!.push(false);
    }
    // Collect RDG finishes in this race
    const raceRdgIds: string[] = [];
    for (const finish of raceFinishes) {
      if (finish.resultCode === 'RDG' && finish.competitorId !== null) {
        raceRdgIds.push(finish.competitorId);
        rdgAssignments.push({ competitorId: finish.competitorId, raceIdx, finish });
      }
    }
    if (raceRdgIds.length > 0) rdgByRaceId.set(race.id, raceRdgIds);
  }

  // ── Second pass: resolve RDG scores ─────────────────────────────────────────

  // Circular dependency: 2+ competitors with RDG in the same race
  const circularRedressRaces: number[] = [];
  const circularRaceIds = new Set<string>();
  for (const [raceId, compIds] of rdgByRaceId) {
    if (compIds.length >= 2) {
      const race = races.find((r) => r.id === raceId);
      if (race) {
        circularRedressRaces.push(race.raceNumber);
        circularRaceIds.add(raceId);
      }
    }
  }

  for (const { competitorId, raceIdx, finish } of rdgAssignments) {
    const race = races[raceIdx];
    if (circularRaceIds.has(race.id)) continue; // leave placeholder in place

    let redressScore: number;

    if (finish.redressMethod === 'stated') {
      redressScore = finish.redressPoints ?? (competitors.length + 1);
    } else {
      const allPoints = competitorRacePoints.get(competitorId)!;
      let poolIndices: number[];

      if (finish.redressIncludeRaces !== null && finish.redressIncludeRaces.length > 0) {
        // Include mode: explicit list (optionally extended by all-later races)
        const includeSet = new Set(finish.redressIncludeRaces);
        poolIndices = races
          .map((r, i) => ({ r, i }))
          .filter(({ r, i }) => includeSet.has(r.raceNumber) && i !== raceIdx)
          .map(({ i }) => i);
        if (finish.redressIncludeAllLater) {
          const maxIncluded = Math.max(...finish.redressIncludeRaces);
          const laterIndices = races
            .map((r, i) => ({ r, i }))
            .filter(({ r, i }) => r.raceNumber > maxIncluded && i !== raceIdx)
            .map(({ i }) => i);
          const merged = new Set([...poolIndices, ...laterIndices]);
          poolIndices = [...merged].sort((a, b) => a - b);
        }
      } else if (finish.redressExcludeRaces !== null && finish.redressExcludeRaces.length > 0) {
        // Exclude mode: method default minus excluded races
        const excludeSet = new Set(finish.redressExcludeRaces);
        if (finish.redressMethod === 'races_before') {
          poolIndices = races.map((_, i) => i).filter((i) => i < raceIdx && !excludeSet.has(races[i].raceNumber));
        } else {
          poolIndices = races.map((_, i) => i).filter((i) => i !== raceIdx && !excludeSet.has(races[i].raceNumber));
        }
      } else {
        // No restriction: use method default
        if (finish.redressMethod === 'races_before') {
          poolIndices = races.map((_, i) => i).filter((i) => i < raceIdx);
        } else {
          // 'all_races' (default)
          poolIndices = races.map((_, i) => i).filter((i) => i !== raceIdx);
        }
      }

      const poolPoints = poolIndices.map((i) => allPoints[i]);
      if (poolPoints.length === 0) {
        redressScore = competitors.length + 1; // empty pool → DNF score
      } else {
        const avg = poolPoints.reduce((s, p) => s + p, 0) / poolPoints.length;
        redressScore = roundToTenth(avg);
      }
    }

    competitorRacePoints.get(competitorId)![raceIdx] = redressScore;
    competitorRaceRedressFlags.get(competitorId)![raceIdx] = true;
    // resultCode 'RDG' is already in competitorRaceCodes from the first pass
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
    const raceRedressFlags = competitorRaceRedressFlags.get(competitor.id)!;
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

    return { rank: 0, competitor, racePoints, raceCodes, racePenaltyCodes, racePenaltyOverrides, raceRedressFlags, totalPoints, netPoints, raceDiscards, raceNonDiscardable };
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

  return { standings, circularRedressRaces };
}

/**
 * Calculate series standings for a time-corrected (IRC/PY) fleet.
 *
 * For each race that has a matching RaceStart for this fleet, calls
 * calculateHandicapRaceScores to derive CT-based points. Races without a
 * start time fall back to scratch scoring so the series remains live.
 * Discards are applied the same way as scratch standings.
 */
function calculateHandicapStandings(
  competitors: Competitor[],
  races: Race[],
  allFinishes: Finish[],
  raceStarts: RaceStart[],
  fleet: Fleet,
  discardThresholds: DiscardThreshold[] = [],
): { standings: Standing[] } {
  if (competitors.length === 0 || races.length === 0) {
    return {
      standings: competitors.map((c, i) => ({
        rank: i + 1,
        competitor: c,
        racePoints: [],
        raceCodes: [],
        racePenaltyCodes: [],
        racePenaltyOverrides: [],
        raceRedressFlags: [],
        totalPoints: 0,
        netPoints: 0,
        raceDiscards: [],
        raceNonDiscardable: [],
      })),
    };
  }

  // Build raceStart lookup: for each race, find the start that covers this fleet
  const startsByRaceId = new Map<string, RaceStart>();
  for (const rs of raceStarts) {
    if (rs.fleetIds.includes(fleet.id)) {
      startsByRaceId.set(rs.raceId, rs);
    }
  }

  const finishesByRace = new Map<string, Finish[]>();
  for (const finish of allFinishes) {
    const list = finishesByRace.get(finish.raceId) ?? [];
    list.push(finish);
    finishesByRace.set(finish.raceId, list);
  }

  const competitorRacePoints = new Map<string, number[]>();
  const competitorRaceCodes = new Map<string, (ResultCode | null)[]>();
  const competitorRacePenaltyCodes = new Map<string, (PenaltyCode | null)[]>();
  const competitorRacePenaltyOverrides = new Map<string, (number | null)[]>();
  const competitorRaceRedressFlags = new Map<string, boolean[]>();
  for (const competitor of competitors) {
    competitorRacePoints.set(competitor.id, []);
    competitorRaceCodes.set(competitor.id, []);
    competitorRacePenaltyCodes.set(competitor.id, []);
    competitorRacePenaltyOverrides.set(competitor.id, []);
    competitorRaceRedressFlags.set(competitor.id, []);
  }

  for (const race of races) {
    const raceFinishes = finishesByRace.get(race.id) ?? [];
    const raceStart = startsByRaceId.get(race.id);

    let scores: Map<string, { points: number; resultCode: ResultCode | null }>;
    if (raceStart) {
      scores = calculateHandicapRaceScores(raceFinishes, competitors, raceStart, fleet);
    } else {
      // No start recorded yet — fall back to scratch scoring
      const scratchScores = calculateRaceScores(raceFinishes, competitors, 'seriesEntries');
      scores = new Map([...scratchScores.entries()].map(([id, s]) => [id, { points: s.points, resultCode: s.resultCode }]));
    }

    for (const competitor of competitors) {
      const score = scores.get(competitor.id);
      competitorRacePoints.get(competitor.id)!.push(score?.points ?? competitors.length + 1);
      competitorRaceCodes.get(competitor.id)!.push(score !== undefined ? score.resultCode : 'DNC');
      competitorRacePenaltyCodes.get(competitor.id)!.push(null);
      competitorRacePenaltyOverrides.get(competitor.id)!.push(null);
      competitorRaceRedressFlags.get(competitor.id)!.push(false);
    }
  }

  const discardCount = Math.min(
    getDiscardCount(races.length, discardThresholds),
    races.length,
  );

  const standings: Standing[] = competitors.map((competitor) => {
    const racePoints = competitorRacePoints.get(competitor.id)!;
    const raceCodes = competitorRaceCodes.get(competitor.id)!;
    const racePenaltyCodes = competitorRacePenaltyCodes.get(competitor.id)!;
    const racePenaltyOverrides = competitorRacePenaltyOverrides.get(competitor.id)!;
    const raceRedressFlags = competitorRaceRedressFlags.get(competitor.id)!;
    const totalPoints = racePoints.reduce((sum, p) => sum + p, 0);
    const raceNonDiscardable = raceCodes.map((code) => {
      if (!code) return false;
      const def = getCodeDefinition(code);
      return def ? !def.discardable : false;
    });

    let netPoints = totalPoints;
    const raceDiscards = racePoints.map(() => false);
    if (discardCount > 0) {
      // Discard worst non-protected scores
      const indexed = racePoints
        .map((p, i) => ({ p, i }))
        .filter(({ i }) => !raceNonDiscardable[i])
        .sort((a, b) => b.p - a.p);
      const toDiscard = indexed.slice(0, discardCount);
      for (const { i } of toDiscard) {
        raceDiscards[i] = true;
        netPoints -= racePoints[i];
      }
    }

    return {
      rank: 0,
      competitor,
      racePoints,
      raceCodes,
      racePenaltyCodes,
      racePenaltyOverrides,
      raceRedressFlags,
      totalPoints,
      netPoints,
      raceDiscards,
      raceNonDiscardable,
    };
  });

  // Rank by netPoints (tie-break: most first places, then last race)
  standings.sort((a, b) => {
    if (a.netPoints !== b.netPoints) return a.netPoints - b.netPoints;
    return tieBreak(a, b, races.length);
  });
  standings.forEach((s, i) => { s.rank = i + 1; });

  return { standings };
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
 * @param raceStarts  All race starts in the series (for handicap fleets)
 */
export function calculateFleetStandings(
  fleets: Fleet[],
  competitors: Competitor[],
  races: Race[],
  allFinishes: Finish[],
  discardThresholds: DiscardThreshold[] = [],
  dnfScoring: 'seriesEntries' | 'startingArea' = 'seriesEntries',
  raceStarts: RaceStart[] = [],
): { fleetStandings: { fleet: Fleet; standings: Standing[] }[]; circularRedressRaces: number[] } {
  const sorted = [...fleets].sort((a, b) => a.displayOrder - b.displayOrder);
  const knownFleetIds = new Set(fleets.map((f) => f.id));

  const competitorsByFleet = new Map<string, Competitor[]>();
  const orphans: Competitor[] = [];
  for (const competitor of competitors) {
    let placedInAtLeastOneFleet = false;
    for (const fleetId of competitor.fleetIds) {
      if (knownFleetIds.has(fleetId)) {
        const list = competitorsByFleet.get(fleetId) ?? [];
        list.push(competitor);
        competitorsByFleet.set(fleetId, list);
        placedInAtLeastOneFleet = true;
      }
    }
    if (!placedInAtLeastOneFleet) {
      orphans.push(competitor);
    }
  }

  const allCircular: number[] = [];
  const fleetStandings: { fleet: Fleet; standings: Standing[] }[] = sorted.map((fleet) => {
    const fleetCompetitors = competitorsByFleet.get(fleet.id) ?? [];
    if (fleet.scoringSystem !== 'scratch') {
      const { standings } = calculateHandicapStandings(
        fleetCompetitors,
        races,
        allFinishes,
        raceStarts,
        fleet,
        discardThresholds,
      );
      return { fleet, standings };
    }
    const { standings, circularRedressRaces } = calculateStandings(
      fleetCompetitors,
      races,
      allFinishes,
      discardThresholds,
      dnfScoring,
    );
    allCircular.push(...circularRedressRaces);
    return { fleet, standings };
  });

  if (orphans.length > 0) {
    const unknownFleet: Fleet = { id: '__unknown__', seriesId: '', name: 'Unknown', displayOrder: 9999, scoringSystem: 'scratch' };
    const { standings, circularRedressRaces } = calculateStandings(orphans, races, allFinishes, discardThresholds, dnfScoring);
    allCircular.push(...circularRedressRaces);
    fleetStandings.push({ fleet: unknownFleet, standings });
  }

  return { fleetStandings, circularRedressRaces: [...new Set(allCircular)].sort((a, b) => a - b) };
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
