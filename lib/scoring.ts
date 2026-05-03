import type { Competitor, Fleet, Race, Finish, RaceScore, HandicapRaceScore, RaceStart, Standing, ResultCode, PenaltyCode, DiscardThreshold, ScoringRejection, NhcRaceAggregates, EchoRaceAggregates, NhcTcfRecord, ProgressiveHandicapConfig, ProgressiveRaceCalc, ProgressiveRaceAggregates } from './types';
import { getCodeDefinition } from './scoring-codes';

export const NHC_DEFAULT_ALPHA = 0.15;
export const ECHO_DEFAULT_ALPHA = 0.25;  // Irish Sailing 2022 ECHO Guide: 75/25 club racing
export const ECHO_REGATTA_ALPHA = 0.50;  // Irish Sailing 2022 ECHO Guide: 50/50 regattas/major events

// Round-half-up to whole seconds. Matches HalSail/Sailwave display and ranking,
// so ties surface at the second boundary instead of being broken by sub-second
// float jitter (see issue #97).
export function roundCorrectedSecs(elapsedSecs: number, tcf: number): number {
  return Math.floor(elapsedSecs * tcf + 0.5);
}

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
    } else if (finish.sortOrder !== null) {
      result.set(competitor.id, {
        competitorId: competitor.id,
        points: 0,       // assigned below after within-fleet rank is computed
        place: finish.sortOrder,
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
  // Sort finishers by cross-fleet place (always distinct sortOrder per ADR-008
  // Phase 6 #111). Tie groups are detected by walking consecutive finishers
  // and reading their `tiedWithPrevious` flag from the underlying Finish row.
  const finishers = [...result.entries()]
    .filter(([, score]) => score.place !== null)
    .sort((a, b) => a[1].place! - b[1].place! || a[0].localeCompare(b[0]));

  let fleetRank = 1;
  let fi = 0;
  while (fi < finishers.length) {
    // Walk forward while the next finisher is marked tiedWithPrevious. A
    // group is the run [fi, fj). The leader's tiedWithPrevious flag is
    // ignored — a tie chains backwards from row N to row N-1.
    let fj = fi + 1;
    while (
      fj < finishers.length &&
      finishMap.get(finishers[fj][0])?.tiedWithPrevious === true
    ) {
      fj++;
    }
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
/**
 * Whether a competitor has a valid handicap rating for a fleet.
 * Returns true for scratch fleets (no rating needed).
 * For NHC fleets, the rating is the starting TCF; the per-race TCF is derived
 * by the engine and lives outside the competitor record.
 */
export function hasFleetRating(competitor: Competitor, fleet: Fleet): boolean {
  if (fleet.scoringSystem === 'scratch') return true;
  if (fleet.scoringSystem === 'nhc') return competitor.nhcStartingTcf != null;
  if (fleet.scoringSystem === 'echo') return competitor.echoStartingTcf != null;
  return getTCF(competitor, fleet) !== null;
}

/**
 * Read the starting TCF a competitor brings into a progressive-fleet series.
 * Each progressive system has its own per-competitor field; this helper
 * dispatches on `fleet.scoringSystem`.
 */
function getProgressiveStartingTcf(competitor: Competitor, fleet: Fleet): number | null {
  if (fleet.scoringSystem === 'nhc') return competitor.nhcStartingTcf ?? null;
  if (fleet.scoringSystem === 'echo') return competitor.echoStartingTcf ?? null;
  return null;
}

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
 * Phase A — race scoring. Calculates per-race scores for a time-corrected fleet
 * (IRC, PY, or any progressive system) using time-on-time correction:
 *
 *   CT = ET × TCF   where ET = finishTime − startTime (seconds-since-midnight)
 *
 * The applied TCF for each competitor is supplied in `appliedTcfByCompetitorId`.
 * The caller is responsible for resolving where that TCF comes from:
 *   · static fleet (IRC)  → competitor.ircTcc
 *   · static fleet (PY)   → 1000 / competitor.pyNumber
 *   · progressive fleet   → the running TCF carried forward from prior races
 *
 * Competitors lacking a TCF must be filtered out by the caller before invoking
 * this function (and a `ScoringRejection` emitted there). Every competitor
 * passed in must have an entry in the TCF map.
 *
 * Coded finishes are scored through the same per-code penalty rules as scratch
 * (RRS A5.2 default; A5.3 when `dnfScoring === 'startingArea'`). The penalty
 * base N is the rated fleet size — unrated boats can't be scored in this
 * fleet, so they don't enter the count for A5.2 entries or A5.3 starters.
 *
 * This phase has no knowledge of α, no concept of "next race", and no
 * progressive-system branching.
 *
 * @param finishes  All Finish records for this race (may span multiple fleets)
 * @param competitors  Rated competitors in this fleet only (callers filter non-rated)
 * @param raceStart  The RaceStart that covers this fleet (provides gun time)
 * @param appliedTcfByCompetitorId  Per-competitor TCF used this race
 * @param dnfScoring  'seriesEntries' (A5.2, default) or 'startingArea' (A5.3)
 */
export function calculateHandicapRaceScores(
  finishes: Finish[],
  competitors: Competitor[],
  raceStart: RaceStart,
  appliedTcfByCompetitorId: Map<string, number>,
  dnfScoring: 'seriesEntries' | 'startingArea' = 'seriesEntries',
): { scores: Map<string, HandicapRaceScore> } {
  const startSeconds = parseTimeToSeconds(raceStart.startTime);

  const n = competitors.length;
  const seriesEntryPenalty = n + 1;

  const ratedIds = new Set(competitors.map((c) => c.id));

  const finishMap = new Map(
    finishes
      .filter((f): f is Finish & { competitorId: string } => f.competitorId !== null)
      .map((f) => [f.competitorId, f]),
  );

  // A5.3 starting-area penalty: count only rated boats — unrated boats aren't
  // scored in this fleet, so they don't enter the starters count either.
  let startingAreaPenalty = seriesEntryPenalty;
  if (dnfScoring === 'startingArea') {
    const ratedFinishes = Array.from(finishMap.values()).filter((f) => ratedIds.has(f.competitorId));
    const hasCheckinData = ratedFinishes.some((f) => f.startPresent === true);
    const startingAreaCount = hasCheckinData
      ? ratedFinishes.filter((f) => f.startPresent === true).length
      : ratedFinishes.filter((f) => f.resultCode !== 'DNC').length;
    startingAreaPenalty = startingAreaCount + 1;
  }

  // First pass: compute ET, CT, TCF for each competitor
  interface Candidate {
    competitorId: string;
    elapsedTime: number | null;
    correctedTime: number | null;
    tcfApplied: number;
    resultCode: ResultCode | null;
    isFinisher: boolean;
  }

  const candidates: Candidate[] = [];
  for (const competitor of competitors) {
    const finish = finishMap.get(competitor.id);
    const tcf = appliedTcfByCompetitorId.get(competitor.id);
    if (tcf == null) {
      // Caller contract violation — every passed competitor should have a TCF.
      // Skip to keep results well-formed; the orchestrator emits the rejection.
      continue;
    }

    if (!finish) {
      candidates.push({ competitorId: competitor.id, elapsedTime: null, correctedTime: null, tcfApplied: tcf, resultCode: 'DNC', isFinisher: false });
      continue;
    }
    if (finish.resultCode !== null) {
      candidates.push({ competitorId: competitor.id, elapsedTime: null, correctedTime: null, tcfApplied: tcf, resultCode: finish.resultCode, isFinisher: false });
      continue;
    }
    const finishSeconds = parseTimeToSeconds(finish.finishTime);
    if (finishSeconds === null || startSeconds === null) {
      candidates.push({ competitorId: competitor.id, elapsedTime: null, correctedTime: null, tcfApplied: tcf, resultCode: 'DNF', isFinisher: false });
      continue;
    }
    const et = finishSeconds - startSeconds;
    const ct = roundCorrectedSecs(et, tcf);
    candidates.push({ competitorId: competitor.id, elapsedTime: et, correctedTime: ct, tcfApplied: tcf, resultCode: null, isFinisher: true });
  }

  // Sort finishers by corrected time ascending; stable by competitorId
  const finishers = candidates
    .filter((c) => c.isFinisher)
    .sort((a, b) => a.correctedTime! - b.correctedTime! || a.competitorId.localeCompare(b.competitorId));

  const scores = new Map<string, HandicapRaceScore>();

  // Assign ranks and points to finishers (tied CT = averaged ranks)
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
      scores.set(c.competitorId, {
        competitorId: c.competitorId,
        points: avgPoints,
        place: fi + 1,
        rank: fleetRank,
        resultCode: null,
        elapsedTime: c.elapsedTime,
        correctedTime: c.correctedTime,
        tcfApplied: c.tcfApplied,
        newTcf: null,
      });
    }
    fleetRank += tiedCount;
    fi = fj;
  }

  // Penalty points for non-finishers; tcfApplied is the TCF that *would have*
  // been used, preserved for the audit trail (matters for progressive systems).
  for (const c of candidates) {
    if (scores.has(c.competitorId)) continue;
    const def = c.resultCode ? getCodeDefinition(c.resultCode) : undefined;
    const points = penaltyPoints(
      def?.pointsMethod ?? { type: 'fixed_penalty', penaltyBase: 'entries' },
      seriesEntryPenalty,
      startingAreaPenalty,
    );
    scores.set(c.competitorId, {
      competitorId: c.competitorId,
      points,
      place: null,
      rank: null,
      resultCode: c.resultCode,
      elapsedTime: c.elapsedTime,
      correctedTime: null,
      tcfApplied: c.tcfApplied,
      newTcf: null,
    });
  }

  return { scores };
}

/**
 * Phase B — handicap adjustment. Given the per-race scores from
 * `calculateHandicapRaceScores` and a `ProgressiveHandicapConfig`, computes the
 * TCF that each competitor will carry into race N+1, plus the per-finisher
 * intermediates and fleet-level aggregates needed for explainability.
 *
 * Generic across progressive systems. The first-pass implementation supports
 * the NHC1 case only — `alphaUp === alphaDown`, `outlier.strategy === 'none'`,
 * `realignment.target === 'none'`, `minFinishers === 1`. ECHO will land via
 * configuration alone (α = 0.25, `minFinishers = 3`); SWNHC2015 and RYA NHC
 * 2015 require populating the other config branches and are unimplemented
 * here. The schema is in place so type signatures don't shift each time.
 *
 * Algorithm (NHC1 / ECHO):
 *
 *   CT_i      = ET_i × TCF_i           (already done in phase A)
 *   Q_i       = TCF_i × CT_avg / CT_i  (≡ IS Performance Index)
 *   newTcf    = TCF_i + α × (Q_i − TCF_i)
 *   non-finisher → newTcf = TCF_i (unchanged)
 *
 * Note on Q_i form: Sailwave's reference NHC1 uses an algebraically distinct
 * P50 form (Q_i = O_i × P50). The simple `TCF × CT_avg/CT` form used here
 * drifts ≤0.001 from P50 on real club fleets — well under Sailwave's 3-dp
 * precision — and lets the published "Fair TCF" column close arithmetically
 * with the displayed "CT ratio" (the explainability verification contract).
 *
 * If fewer than `config.minFinishers` boats finished, the update is suppressed
 * for the whole fleet: every competitor's `newTcf` equals their `tcfApplied`.
 * Aggregates still report the actual finisher count for the explainability
 * "rating update suppressed" line.
 *
 * @param scores  Phase A scores for the rated competitors of one fleet
 * @param config  Profile that drives the blend / outlier / realignment steps
 */
export function calculateHandicapAdjustment(
  scores: Map<string, HandicapRaceScore>,
  config: ProgressiveHandicapConfig,
): {
  newTcfByCompetitorId: Map<string, number>;
  perFinisherCalc: Map<string, ProgressiveRaceCalc>;
  aggregates: ProgressiveRaceAggregates;
} {
  if (config.outlier.strategy !== 'none') {
    throw new Error(`calculateHandicapAdjustment: outlier strategy '${config.outlier.strategy}' is not yet implemented`);
  }
  if (config.realignment.target !== 'none') {
    throw new Error(`calculateHandicapAdjustment: realignment target '${config.realignment.target}' is not yet implemented`);
  }
  if (config.alphaUp !== config.alphaDown) {
    throw new Error('calculateHandicapAdjustment: asymmetric alpha is not yet implemented');
  }
  const alpha = config.alphaUp;

  const finisherEntries: Array<[string, HandicapRaceScore]> = [];
  for (const entry of scores) {
    const [, s] = entry;
    if (s.tcfApplied != null && s.correctedTime != null && s.elapsedTime != null && s.resultCode == null) {
      finisherEntries.push(entry);
    }
  }
  const finisherCount = finisherEntries.length;
  const ctSum = finisherEntries.reduce((sum, [, s]) => sum + s.correctedTime!, 0);
  const tcfSum = finisherEntries.reduce((sum, [, s]) => sum + s.tcfApplied!, 0);
  const sumReciprocalEt = finisherEntries.reduce((sum, [, s]) => sum + (s.elapsedTime! > 0 ? 1 / s.elapsedTime! : 0), 0);
  const ctAvg = finisherCount > 0 ? ctSum / finisherCount : 0;
  const meanTcf = finisherCount > 0 ? tcfSum / finisherCount : 0;

  const newTcfByCompetitorId = new Map<string, number>();
  const perFinisherCalc = new Map<string, ProgressiveRaceCalc>();

  const updateSuppressed = finisherCount < config.minFinishers;

  // Finishers: blend toward Q_i (or carry forward unchanged if suppressed).
  // Two formula forms produce the same result for tightly-clustered fleets but
  // diverge for diverse ones:
  //   'ct-mean': Q_i = TCF_i × CT_avg / CT_i  — NHC default, simpler.
  //   'is-pi':   Q_i = ΣH / (T_E × Σ(1/T_E)) — Irish Sailing 2022 ECHO Guide
  //              formula. Required for ECHO so the published Σ(1/T_E) and
  //              ΣH_S header values reproduce per-boat PI exactly.
  for (const [cid, s] of finisherEntries) {
    let fairTcf: number;
    if (config.formulaForm === 'is-pi') {
      fairTcf = sumReciprocalEt > 0 && s.elapsedTime! > 0
        ? tcfSum / (s.elapsedTime! * sumReciprocalEt)
        : s.tcfApplied!;
    } else {
      fairTcf = s.tcfApplied! * (s.correctedTime! > 0 ? ctAvg / s.correctedTime! : 1);
    }
    const ctRatio = s.tcfApplied! > 0 ? fairTcf / s.tcfApplied! : 1;
    const adjustment = updateSuppressed ? 0 : alpha * (fairTcf - s.tcfApplied!);
    const newTcf = s.tcfApplied! + adjustment;
    perFinisherCalc.set(cid, { ctRatio, fairTcf, adjustment, alphaApplied: alpha });
    newTcfByCompetitorId.set(cid, newTcf);
  }

  // Non-finishers: TCF carries forward unchanged.
  for (const [cid, s] of scores) {
    if (newTcfByCompetitorId.has(cid)) continue;
    if (s.tcfApplied != null) {
      newTcfByCompetitorId.set(cid, s.tcfApplied);
    }
  }

  return {
    newTcfByCompetitorId,
    perFinisherCalc,
    aggregates: { alpha, finisherCount, ctAvg, meanTcf },
  };
}

/**
 * Build the `ProgressiveHandicapConfig` for a fleet. Returns `null` for static
 * fleets (scratch, IRC, PY) — the orchestrator skips phase B in that case.
 *
 * NHC1 maps to a symmetric blend with no outlier handling and no realignment.
 * Future systems (ECHO, SWNHC2015, RYA NHC 2015) plug in additional cases.
 */
export function deriveProgressiveHandicapConfig(fleet: Fleet): ProgressiveHandicapConfig | null {
  if (fleet.scoringSystem === 'nhc') {
    const alpha = fleet.nhcAlpha ?? NHC_DEFAULT_ALPHA;
    return {
      alphaUp: alpha,
      alphaDown: alpha,
      outlier: { strategy: 'none' },
      realignment: { target: 'none' },
      minFinishers: 1,
      formulaForm: 'ct-mean',
    };
  }
  if (fleet.scoringSystem === 'echo') {
    const alpha = fleet.echoAlpha ?? ECHO_DEFAULT_ALPHA;
    // Irish Sailing 2022 ECHO Guide sample SI 12: "Handicaps shall not be
    // adjusted after a race in which two or less boats finish."
    return {
      alphaUp: alpha,
      alphaDown: alpha,
      outlier: { strategy: 'none' },
      realignment: { target: 'none' },
      minFinishers: 3,
      formulaForm: 'is-pi',
    };
  }
  return null;
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
 * Calculate series standings for a time-corrected fleet (IRC, PY, or NHC).
 *
 * Orchestrates the two-phase pipeline:
 *
 *   1. Build the per-competitor applied-TCF map. For static fleets it's
 *      derived once from competitor.ircTcc / pyNumber. For progressive fleets
 *      it's seeded from competitor.nhcStartingTcf and then advanced after each
 *      race using the adjustment phase's output.
 *   2. For each race: phase A (`calculateHandicapRaceScores`) computes places
 *      and CT; phase B (`calculateHandicapAdjustment`, only for progressive
 *      fleets) computes the TCFs for race N+1 plus per-finisher intermediates
 *      and fleet aggregates for explainability.
 *
 * Races without a start time fall back to scratch scoring so the series stays
 * live. Discards apply identically to scratch standings.
 */
function calculateHandicapStandings(
  competitors: Competitor[],
  races: Race[],
  allFinishes: Finish[],
  raceStarts: RaceStart[],
  fleet: Fleet,
  discardThresholds: DiscardThreshold[] = [],
  dnfScoring: 'seriesEntries' | 'startingArea' = 'seriesEntries',
): {
  standings: Standing[];
  rejections: ScoringRejection[];
  // Progressive-only outputs. NHC fleets populate the nhc* fields; ECHO
  // fleets populate the echo* fields. The TCF history is shared (same
  // record shape, fleetId disambiguates).
  nhcRaceScoresByRaceId?: Map<string, Map<string, HandicapRaceScore>>;
  nhcAggregatesByRaceId?: Map<string, NhcRaceAggregates>;
  echoRaceScoresByRaceId?: Map<string, Map<string, HandicapRaceScore>>;
  echoAggregatesByRaceId?: Map<string, EchoRaceAggregates>;
  nhcTcfHistory?: NhcTcfRecord[];
} {
  const config = deriveProgressiveHandicapConfig(fleet);
  const isProgressive = config !== null;
  const isNhc = fleet.scoringSystem === 'nhc';
  const isEcho = fleet.scoringSystem === 'echo';

  // Build the initial applied-TCF map and emit rejections for missing ratings.
  // For static fleets this map never changes; for progressive fleets it gets
  // advanced after every race using phase B's newTcfByCompetitorId.
  const appliedTcfMap = new Map<string, number>();
  const allRejections: ScoringRejection[] = [];
  const rejectedIds = new Set<string>();
  const noTcfReason: ScoringRejection['reason'] = isProgressive ? 'no_starting_tcf' : 'no_rating';
  for (const c of competitors) {
    const tcf = isProgressive ? getProgressiveStartingTcf(c, fleet) : getTCF(c, fleet);
    if (tcf == null) {
      rejectedIds.add(c.id);
      allRejections.push({ competitorId: c.id, reason: noTcfReason });
    } else {
      appliedTcfMap.set(c.id, tcf);
    }
  }

  if (competitors.length === 0 || races.length === 0) {
    const rated = competitors.filter((c) => !rejectedIds.has(c.id));
    return {
      standings: rated.map((c, i) => ({
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
      rejections: allRejections,
      ...(isNhc ? { nhcRaceScoresByRaceId: new Map(), nhcAggregatesByRaceId: new Map() } : {}),
      ...(isEcho ? { echoRaceScoresByRaceId: new Map(), echoAggregatesByRaceId: new Map() } : {}),
      ...(isProgressive ? { nhcTcfHistory: [] } : {}),
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

  const ratedCompetitors = competitors.filter((c) => !rejectedIds.has(c.id));

  // Progressive-system outputs collected across races. NHC and ECHO each
  // get their own per-system maps (HandicapRaceScore.nhc / .echo); the TCF
  // history is shared across both progressive systems.
  const nhcRaceScoresByRaceId = new Map<string, Map<string, HandicapRaceScore>>();
  const nhcAggregatesByRaceId = new Map<string, NhcRaceAggregates>();
  const echoRaceScoresByRaceId = new Map<string, Map<string, HandicapRaceScore>>();
  const echoAggregatesByRaceId = new Map<string, EchoRaceAggregates>();
  const nhcTcfHistory: NhcTcfRecord[] = [];

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
      // Phase A — race scoring (applies to both static and progressive fleets)
      const phaseA = calculateHandicapRaceScores(raceFinishes, ratedCompetitors, raceStart, appliedTcfMap, dnfScoring);
      let raceScores = phaseA.scores;

      // Phase B — handicap adjustment (progressive fleets only)
      if (config) {
        const phaseB = calculateHandicapAdjustment(raceScores, config);

        // Merge phase-B outputs back into the per-boat scores: newTcf for
        // every competitor; per-finisher intermediates copied into the
        // per-system display field (`nhc` for NHC fleets, `echo` for ECHO).
        const merged = new Map<string, HandicapRaceScore>();
        for (const [cid, s] of raceScores) {
          const newTcf = phaseB.newTcfByCompetitorId.get(cid) ?? s.tcfApplied;
          const calc = phaseB.perFinisherCalc.get(cid);
          merged.set(cid, {
            ...s,
            newTcf,
            ...(calc && isNhc ? { nhc: calc } : {}),
            ...(calc && isEcho ? { echo: calc } : {}),
          });
        }
        raceScores = merged;

        if (isNhc) {
          nhcRaceScoresByRaceId.set(race.id, raceScores);
          nhcAggregatesByRaceId.set(race.id, phaseB.aggregates);
        } else if (isEcho) {
          echoRaceScoresByRaceId.set(race.id, raceScores);
          // ECHO aggregates carry the IS-formula inputs (ΣH_S, Σ(1/T_E))
          // alongside the shared aggregates so the explainability fleet
          // header can reproduce PI = ΣH_S / (T_E × Σ(1/T_E)) directly.
          let sumH = 0;
          let sumReciprocalEt = 0;
          for (const [, s] of raceScores) {
            if (s.tcfApplied != null && s.elapsedTime != null && s.elapsedTime > 0 && s.resultCode == null) {
              sumH += s.tcfApplied;
              sumReciprocalEt += 1 / s.elapsedTime;
            }
          }
          echoAggregatesByRaceId.set(race.id, {
            ...phaseB.aggregates,
            sumH,
            sumReciprocalEt,
            updateSuppressed: phaseB.aggregates.finisherCount < config.minFinishers,
          });
        }

        // Audit trail: one record per (race, competitor) covering both
        // finishers and non-finishers (so an absent Finish row still leaves
        // a TCF history entry).
        for (const [cid, newTcf] of phaseB.newTcfByCompetitorId) {
          const tcfApplied = appliedTcfMap.get(cid)!;
          nhcTcfHistory.push({
            id: `${race.id}-${cid}-${fleet.id}`,
            raceId: race.id,
            competitorId: cid,
            fleetId: fleet.id,
            tcfApplied,
            newTcf,
          });
          appliedTcfMap.set(cid, newTcf);
        }
      }

      scores = raceScores;
    } else {
      // No start recorded yet — fall back to scratch scoring
      const scratchScores = calculateRaceScores(raceFinishes, competitors, dnfScoring);
      scores = new Map([...scratchScores.entries()].map(([id, s]) => [id, { points: s.points, resultCode: s.resultCode }]));
    }

    for (const competitor of competitors) {
      if (rejectedIds.has(competitor.id)) continue; // excluded from scoring
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

  const standings: Standing[] = ratedCompetitors.map((competitor) => {
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

  // Rank by netPoints (tie-break: most first places, then last race).
  // Tied competitors share the same rank, matching calculateStandings.
  standings.sort((a, b) => {
    if (a.netPoints !== b.netPoints) return a.netPoints - b.netPoints;
    return tieBreak(a, b, races.length);
  });
  let hrank = 1;
  for (let i = 0; i < standings.length; i++) {
    if (i > 0 && isTied(standings[i - 1], standings[i], races.length)) {
      standings[i].rank = standings[i - 1].rank;
    } else {
      standings[i].rank = hrank;
    }
    hrank++;
  }

  return {
    standings,
    rejections: allRejections,
    ...(isNhc ? { nhcRaceScoresByRaceId, nhcAggregatesByRaceId } : {}),
    ...(isEcho ? { echoRaceScoresByRaceId, echoAggregatesByRaceId } : {}),
    ...(isProgressive ? { nhcTcfHistory } : {}),
  };
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
): {
  fleetStandings: {
    fleet: Fleet;
    standings: Standing[];
    rejections: ScoringRejection[];
    nhcRaceScoresByRaceId?: Map<string, Map<string, HandicapRaceScore>>;
    nhcAggregatesByRaceId?: Map<string, NhcRaceAggregates>;
    echoRaceScoresByRaceId?: Map<string, Map<string, HandicapRaceScore>>;
    echoAggregatesByRaceId?: Map<string, EchoRaceAggregates>;
    nhcTcfHistory?: NhcTcfRecord[];
  }[];
  circularRedressRaces: number[];
} {
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
  const fleetStandings = sorted.map((fleet) => {
    const fleetCompetitors = competitorsByFleet.get(fleet.id) ?? [];
    if (fleet.scoringSystem !== 'scratch') {
      const { standings, rejections, nhcRaceScoresByRaceId, nhcAggregatesByRaceId, echoRaceScoresByRaceId, echoAggregatesByRaceId, nhcTcfHistory } = calculateHandicapStandings(
        fleetCompetitors,
        races,
        allFinishes,
        raceStarts,
        fleet,
        discardThresholds,
        dnfScoring,
      );
      return { fleet, standings, rejections, nhcRaceScoresByRaceId, nhcAggregatesByRaceId, echoRaceScoresByRaceId, echoAggregatesByRaceId, nhcTcfHistory };
    }
    const { standings, circularRedressRaces } = calculateStandings(
      fleetCompetitors,
      races,
      allFinishes,
      discardThresholds,
      dnfScoring,
    );
    allCircular.push(...circularRedressRaces);
    return { fleet, standings, rejections: [] };
  });

  if (orphans.length > 0) {
    const unknownFleet: Fleet = { id: '__unknown__', seriesId: '', name: 'Unknown', displayOrder: 9999, scoringSystem: 'scratch' };
    const { standings, circularRedressRaces } = calculateStandings(orphans, races, allFinishes, discardThresholds, dnfScoring);
    allCircular.push(...circularRedressRaces);
    fleetStandings.push({ fleet: unknownFleet, standings, rejections: [] });
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
