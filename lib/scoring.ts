import type { Competitor, Fleet, Race, Finish, RaceScore, HandicapRaceScore, RaceStart, RaceRatingOverride, Standing, ResultCode, PenaltyCode, DiscardThreshold, DnfScoring, ScoringRejection, NhcRaceCalc, NhcRaceAggregates, EchoRaceCalc, EchoRaceAggregates, TcfRecord, NhcProfile, ProgressiveHandicapConfig, ProgressiveRaceCalc, ProgressiveRaceAggregates } from './types';
import { getCodeDefinition } from './scoring-codes';

export const ECHO_DEFAULT_ALPHA = 0.25;  // Irish Sailing 2022 ECHO Guide: 75/25 club racing
export const ECHO_REGATTA_ALPHA = 0.50;  // Irish Sailing 2022 ECHO Guide: 50/50 regattas/major events

// Stock SWNHC2015 spreadsheet constants (Jon Eskdale, version 2014-01-05-0).
// Reverse-engineered to match Sailwave NHC1 output to 3 dp across all
// finishers of all five HYC test fleets. See:
//   - docs/notes/sailwave/nhc1-reverse-engineering.md §10
//   - reference/data/2026-hyc-club-racing/sailwave-nhc1-reverse.py
//
// Used as the fallback when a fleet has no `nhcProfile` override. Scorers
// who want to experiment with non-stock parameters (e.g. the HYC aggressive-
// blend study, #143) set `Fleet.nhcProfile` per fleet; named per-series and
// per-workspace profile registries are a future milestone (see
// docs/design/horizon.md).
export const DEFAULT_NHC_PROFILE: NhcProfile = {
  name: 'NHC1 (Sailwave)',
  alphaP: 0.300,
  alphaN: 0.150,
  alphaPX: 0.150,
  alphaNX: 0.075,
  sdOver: 1.5,
  sdUnder: 1.0,
  minFin: 3,
};

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
 *    penaltyBase 'entries' → series entries + 1 (e.g. DNC under A5.2/A5.3)
 *    penaltyBase 'starters' → depends on dnfScoring:
 *      'seriesEntries' (A5.2, default): series entries + 1
 *      'startingArea'  (A5.3): starting-area count + 1
 *  - DNC base depends on dnfScoring: entries + 1 under 'seriesEntries' and
 *    standard 'startingArea'; came-to-start + 1 under 'startingAreaInclDnc'
 *    (DBSC SI A13.2 changes A5.3 so a boat that did not come to the start is
 *    scored from the number that came).
 *  - Missing finish record → implicit DNC.
 *
 * @param finishes  All Finish records for this race
 * @param competitors  All competitors in the series
 * @param dnfScoring  'seriesEntries' (A5.2), 'startingArea' (A5.3), or
 *   'startingAreaInclDnc' (A5.3 with DNC also scored from the starting area)
 * @returns  Map of competitorId → RaceScore
 */
/** The A6.2 penalty ceiling for a race: the score a boat gets for DNF, per the
 *  dnfScoring rule (mirrors `startingAreaPenalty` in calculateRaceScores). A
 *  penalised finisher is never scored worse than this. `fleetFinishes` must be
 *  pre-filtered to the fleet. */
function dnfScoreForRace(fleetFinishes: Finish[], entrantCount: number, dnfScoring: DnfScoring): number {
  if (dnfScoring === 'seriesEntries') return entrantCount + 1;
  const hasCheckin = fleetFinishes.some((f) => f.startPresent === true);
  const startingAreaCount = hasCheckin
    ? fleetFinishes.filter((f) => f.startPresent === true).length
    : fleetFinishes.filter((f) => f.resultCode !== 'DNC').length;
  return startingAreaCount + 1;
}

/** Apply an additive scoring penalty (ZFP/SCP/DPI) to a finisher's points. Per
 *  RRS A6.2 the percentage penalty is rounded to the nearest whole number, and
 *  a boat is never scored worse than DNF (`cap`). No-op when the finish carries
 *  no penalty. Caller restricts this to finishers. */
function applyAdditivePenalty(basePoints: number, finish: Finish | undefined, cap: number): number {
  if (!finish?.penaltyCode) return basePoints;
  const method = getCodeDefinition(finish.penaltyCode)?.pointsMethod;
  if (method?.type === 'additive_percentage') {
    const pct = finish.penaltyOverride ?? method.defaultPct;
    return Math.min(basePoints + Math.round((pct / 100) * cap), cap);
  }
  if (method?.type === 'additive_stated') {
    return Math.min(basePoints + (finish.penaltyOverride ?? 0), cap);
  }
  return basePoints;
}

export function calculateRaceScores(
  finishes: Finish[],
  competitors: Competitor[],
  dnfScoring: DnfScoring = 'seriesEntries',
): Map<string, RaceScore> {
  const n = competitors.length;
  const seriesEntryPenalty = n + 1;
  const competitorIds = new Set(competitors.map((c) => c.id));

  // Boats from other fleets are scored separately; counting them as starters
  // here would inflate the A5.3 penalty. Mirrors calculateHandicapRaceScores.
  const fleetFinishes = finishes.filter(
    (f) => f.competitorId !== null && competitorIds.has(f.competitorId),
  );

  // Under A5.3, compute a per-race penalty for 'starters'-base codes from the
  // number of boats that came to the start. DNC normally stays at entries + 1;
  // under 'startingAreaInclDnc' (DBSC A13.2) it uses the starting-area count too.
  let startingAreaPenalty = seriesEntryPenalty;
  if (dnfScoring !== 'seriesEntries') {
    const hasCheckinData = fleetFinishes.some((f) => f.startPresent === true);
    const startingAreaCount = hasCheckinData
      ? fleetFinishes.filter((f) => f.startPresent === true).length
      : fleetFinishes.filter((f) => f.resultCode !== 'DNC').length;
    startingAreaPenalty = startingAreaCount + 1;
  }
  const dncPenalty = dnfScoring === 'startingAreaInclDnc' ? startingAreaPenalty : seriesEntryPenalty;

  const finishMap = new Map(
    fleetFinishes.map((f) => [f.competitorId as string, f]),
  );

  const result = new Map<string, RaceScore>();

  for (const competitor of competitors) {
    const finish = finishMap.get(competitor.id);

    if (!finish) {
      // Missing finish record = implicit DNC.
      result.set(competitor.id, {
        competitorId: competitor.id,
        points: dncPenalty,
        place: null,
        rank: null,
        resultCode: 'DNC',
      });
    } else if (finish.resultCode !== null) {
      const def = getCodeDefinition(finish.resultCode);
      const points = finish.resultCode === 'DNC'
        ? dncPenalty
        : penaltyPoints(def?.pointsMethod ?? { type: 'fixed_penalty', penaltyBase: 'entries' }, seriesEntryPenalty, startingAreaPenalty);
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
    const score = result.get(competitor.id);
    if (!score || score.place === null) continue; // only apply to finishers
    // Cap at the DNF score (starters base) per A6.2.
    const penalized = applyAdditivePenalty(score.points, finishMap.get(competitor.id), startingAreaPenalty);
    if (penalized !== score.points) result.set(competitor.id, { ...score, points: penalized });
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
  dnfScoring: DnfScoring = 'seriesEntries',
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
  if (dnfScoring !== 'seriesEntries') {
    const ratedFinishes = Array.from(finishMap.values()).filter((f) => ratedIds.has(f.competitorId));
    const hasCheckinData = ratedFinishes.some((f) => f.startPresent === true);
    const startingAreaCount = hasCheckinData
      ? ratedFinishes.filter((f) => f.startPresent === true).length
      : ratedFinishes.filter((f) => f.resultCode !== 'DNC').length;
    startingAreaPenalty = startingAreaCount + 1;
  }
  // DBSC A13.2 (startingAreaInclDnc): DNC is scored from the starting-area
  // count too, not series entries.
  const dncPenalty = dnfScoring === 'startingAreaInclDnc' ? startingAreaPenalty : seriesEntryPenalty;

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
    const points = c.resultCode === 'DNC'
      ? dncPenalty
      : penaltyPoints(
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
 * Branches by outlier strategy:
 *   - `reduce-alpha` → SWNHC2015 (Sailwave NHC1). Six-step procedure with
 *     asymmetric blend rates, asymmetric extreme classification on S = Q/L,
 *     a non-extreme-only W51 multiplier, and a final fleet-sum realignment.
 *     Emits NhcRaceCalc / NhcRaceAggregates.
 *   - `none` → ECHO and any other symmetric-blend single-step systems. Uses
 *     the IS-PI fair-handicap formula. Emits EchoRaceCalc / EchoRaceAggregates.
 *
 * Non-finishers (DNC, DNF, RET) keep their TCF unchanged in both branches.
 * When the finisher count is below `config.minFinishers`, the update is
 * suppressed for the whole fleet; aggregates still report the actual finisher
 * count so the explainability layer can render the "rating update suppressed"
 * line.
 *
 * @param scores  Phase A scores for the rated competitors of one fleet
 * @param config  Profile that drives the blend / outlier / realignment steps
 * @param baseTcfByCompetitorId  Each competitor's *series-initial* TCF
 *   (nhcStartingTcf), used as the SWNHC2015 realignment numerator (Step 6).
 *   Optional: when omitted the realignment falls back to the carried ΣL, which
 *   only matters from race 2 on (race 1 has base == carried). See issue #147 §3(b).
 */
export function calculateHandicapAdjustment(
  scores: Map<string, HandicapRaceScore>,
  config: ProgressiveHandicapConfig,
  baseTcfByCompetitorId?: Map<string, number>,
): {
  newTcfByCompetitorId: Map<string, number>;
  perFinisherCalc: Map<string, ProgressiveRaceCalc>;
  aggregates: ProgressiveRaceAggregates;
} {
  const finisherEntries: Array<[string, HandicapRaceScore]> = [];
  for (const entry of scores) {
    const [, s] = entry;
    if (s.tcfApplied != null && s.correctedTime != null && s.elapsedTime != null && s.resultCode == null) {
      finisherEntries.push(entry);
    }
  }

  if (config.outlier.strategy === 'reduce-alpha') {
    return swnhc2015Adjustment(scores, finisherEntries, config, config.outlier, baseTcfByCompetitorId);
  }
  return symmetricBlendAdjustment(scores, finisherEntries, config);
}

/**
 * SWNHC2015 spreadsheet algorithm (Eskdale, version 2014-01-05-0).
 * Reverse-engineered from `2026 Tues Series 1- Pup HPH R1.xls` against
 * Sailwave's published NewRating; matches every published value to 3 dp
 * across the five HYC test fleets (n=34 finishers).
 *
 * See:
 *   - docs/notes/sailwave/nhc1-reverse-engineering.md §10 (algorithm)
 *   - reference/data/2026-hyc-club-racing/sailwave-nhc1-reverse.py
 *     (the Python reference `nr_swnhc2015_full` this transcribes)
 */
function swnhc2015Adjustment(
  scores: Map<string, HandicapRaceScore>,
  finisherEntries: Array<[string, HandicapRaceScore]>,
  config: ProgressiveHandicapConfig,
  outlier: Extract<ProgressiveHandicapConfig['outlier'], { strategy: 'reduce-alpha' }>,
  baseTcfByCompetitorId?: Map<string, number>,
): {
  newTcfByCompetitorId: Map<string, number>;
  perFinisherCalc: Map<string, ProgressiveRaceCalc>;
  aggregates: ProgressiveRaceAggregates;
} {
  const finisherCount = finisherEntries.length;
  const newTcfByCompetitorId = new Map<string, number>();
  const perFinisherCalc = new Map<string, ProgressiveRaceCalc>();

  // Carry-forward for non-finishers. Same in suppressed and normal paths.
  const carryForwardNonFinishers = () => {
    for (const [cid, s] of scores) {
      if (newTcfByCompetitorId.has(cid)) continue;
      if (s.tcfApplied != null) newTcfByCompetitorId.set(cid, s.tcfApplied);
    }
  };

  // Suppression gate. No update — every competitor keeps their tcfApplied.
  if (finisherCount < config.minFinishers) {
    for (const [cid, s] of finisherEntries) {
      if (s.tcfApplied != null) newTcfByCompetitorId.set(cid, s.tcfApplied);
    }
    carryForwardNonFinishers();
    const ctSum = finisherEntries.reduce((sum, [, s]) => sum + s.correctedTime!, 0);
    const tcfSum = finisherEntries.reduce((sum, [, s]) => sum + s.tcfApplied!, 0);
    const aggregates: NhcRaceAggregates = {
      finisherCount,
      ctAvg: finisherCount > 0 ? ctSum / finisherCount : 0,
      meanTcf: finisherCount > 0 ? tcfSum / finisherCount : 0,
      p50: 0,
      w51: null,
      sMean: 0,
      sStdev: 0,
      sHi: 0,
      sLo: 0,
      extremeCount: 0,
      realignmentFactor: 1,
      updateSuppressed: true,
    };
    return { newTcfByCompetitorId, perFinisherCalc, aggregates };
  }

  // Per-boat baselines, indexed parallel to finisherEntries.
  const L = finisherEntries.map(([, s]) => s.tcfApplied!);
  const ET = finisherEntries.map(([, s]) => s.elapsedTime!);
  const CT = finisherEntries.map(([, s]) => s.correctedTime!);

  // Step 1. Performance index O_i = 100 / minutes; fleet P50 = mean(L) / mean(O).
  //         Q_i = O_i × P50 is the Family-B fair handicap (preserves Σ Q = Σ L
  //         by construction).
  const O = ET.map((t) => 100 / (t / 60));
  const meanL = L.reduce((a, b) => a + b, 0) / finisherCount;
  const meanO = O.reduce((a, b) => a + b, 0) / finisherCount;
  const p50 = meanO > 0 ? meanL / meanO : 1;
  const Q = O.map((o) => o * p50);

  // Step 2. Comparative score S_i = Q_i / L_i. Classify extreme on asymmetric
  //         SD thresholds of S (population σ, not sample σ).
  const S = Q.map((q, i) => (L[i] > 0 ? q / L[i] : 1));
  const sMean = S.reduce((a, b) => a + b, 0) / finisherCount;
  const sStdev = Math.sqrt(
    S.reduce((sum, s) => sum + (s - sMean) ** 2, 0) / finisherCount,
  );
  const sHi = sMean + outlier.sdThresholdUp * sStdev;
  const sLo = sMean - outlier.sdThresholdDown * sStdev;
  const extreme = S.map((s) => s > sHi || s < sLo);
  const extremeDirection: Array<'fast' | 'slow' | null> = S.map((s, i) =>
    !extreme[i] ? null : s > sHi ? 'fast' : 'slow',
  );

  // Step 3. Non-extreme branch: optionally recompute W51 from non-extreme
  //         subset only. Fall back to P50 when the subset is empty or the
  //         recompute is disabled.
  const nonExtIdx: number[] = [];
  for (let i = 0; i < finisherCount; i++) if (!extreme[i]) nonExtIdx.push(i);
  let w51: number | null;
  if (outlier.recomputeP50ForNonExtreme && nonExtIdx.length > 0) {
    const meanLn = nonExtIdx.reduce((sum, i) => sum + L[i], 0) / nonExtIdx.length;
    const meanOn = nonExtIdx.reduce((sum, i) => sum + O[i], 0) / nonExtIdx.length;
    w51 = meanOn > 0 ? meanLn / meanOn : p50;
  } else {
    w51 = null;
  }
  const w51Eff = w51 ?? p50;
  const X = O.map((o) => o * w51Eff);

  // Step 4. Per-boat α from the four-way table (extreme × direction).
  //         Extreme boats blend against original Q_i; non-extreme against X_i.
  const alphaApplied = new Array<number>(finisherCount);
  const target = new Array<number>(finisherCount);
  for (let i = 0; i < finisherCount; i++) {
    if (extreme[i]) {
      target[i] = Q[i];
      alphaApplied[i] = Q[i] > L[i] ? outlier.alphaUpReduced : outlier.alphaDownReduced;
    } else {
      target[i] = X[i];
      alphaApplied[i] = X[i] > L[i] ? config.alphaUp : config.alphaDown;
    }
  }

  // Step 5. Blend: Z_i = α_i × target_i + (1 − α_i) × L_i.
  const Z = new Array<number>(finisherCount);
  for (let i = 0; i < finisherCount; i++) {
    Z[i] = alphaApplied[i] * target[i] + (1 - alphaApplied[i]) * L[i];
  }

  // Step 6. Realign by Z51 = Σ(base TCF) / ΣZ over finishers; final value
  //         rounded to 3 dp (matches Sailwave's published NewRating column).
  //         The numerator is each finisher's *series-initial* rating
  //         (nhcStartingTcf), NOT the rating carried into this race: Sailwave
  //         re-anchors the fleet sum to the original base handicaps every race
  //         so cumulative drift doesn't compound. In a first race base ==
  //         carried, so this is a no-op there; it only bites from race 2 on
  //         (issue #147 §3(b)). Falls back to carried ΣL when no base map is
  //         supplied — see calculateHandicapAdjustment.
  const sumBase = finisherEntries.reduce(
    (sum, [cid, s]) => sum + (baseTcfByCompetitorId?.get(cid) ?? s.tcfApplied!),
    0,
  );
  const sumZ = Z.reduce((a, b) => a + b, 0);
  const z51 = sumZ > 0 ? sumBase / sumZ : 1;

  for (let i = 0; i < finisherCount; i++) {
    const [cid, s] = finisherEntries[i];
    const newTcf = Math.round(Z[i] * z51 * 1000) / 1000;
    const calc: NhcRaceCalc = {
      fairTcf: Q[i],
      compScore: S[i],
      isExtreme: extreme[i],
      ...(extremeDirection[i] ? { extremeDirection: extremeDirection[i]! } : {}),
      alphaApplied: alphaApplied[i],
      provisionalTcf: Z[i],
      adjustment: newTcf - s.tcfApplied!,
    };
    perFinisherCalc.set(cid, calc);
    newTcfByCompetitorId.set(cid, newTcf);
  }

  carryForwardNonFinishers();

  const ctSum = CT.reduce((a, b) => a + b, 0);
  const aggregates: NhcRaceAggregates = {
    finisherCount,
    ctAvg: ctSum / finisherCount,
    meanTcf: meanL,
    p50,
    w51,
    sMean,
    sStdev,
    sHi,
    sLo,
    extremeCount: extreme.filter(Boolean).length,
    realignmentFactor: z51,
    updateSuppressed: false,
  };

  return { newTcfByCompetitorId, perFinisherCalc, aggregates };
}

/**
 * Symmetric single-blend path (ECHO and any future single-α progressive
 * systems with no outlier handling and no realignment).
 *
 *   Q_i       = ΣH / (T_E_i · Σ(1/T_E))        (IS-PI / Family-B form)
 *   newTcf    = TCF_i + α × (Q_i − TCF_i)
 *
 * The legacy ct-mean Q form (Q_i = TCF_i × CT_avg / CT_i) is preserved on the
 * `formulaForm === 'ct-mean'` branch for completeness, but no current
 * production config uses it (NHC1 now goes through SWNHC2015).
 */
function symmetricBlendAdjustment(
  scores: Map<string, HandicapRaceScore>,
  finisherEntries: Array<[string, HandicapRaceScore]>,
  config: ProgressiveHandicapConfig,
): {
  newTcfByCompetitorId: Map<string, number>;
  perFinisherCalc: Map<string, ProgressiveRaceCalc>;
  aggregates: ProgressiveRaceAggregates;
} {
  const alpha = config.alphaUp;
  const finisherCount = finisherEntries.length;
  const ctSum = finisherEntries.reduce((sum, [, s]) => sum + s.correctedTime!, 0);
  const tcfSum = finisherEntries.reduce((sum, [, s]) => sum + s.tcfApplied!, 0);
  const sumReciprocalEt = finisherEntries.reduce(
    (sum, [, s]) => sum + (s.elapsedTime! > 0 ? 1 / s.elapsedTime! : 0),
    0,
  );
  const ctAvg = finisherCount > 0 ? ctSum / finisherCount : 0;
  const meanTcf = finisherCount > 0 ? tcfSum / finisherCount : 0;
  const updateSuppressed = finisherCount < config.minFinishers;

  const newTcfByCompetitorId = new Map<string, number>();
  const perFinisherCalc = new Map<string, ProgressiveRaceCalc>();

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
    const calc: EchoRaceCalc = { ctRatio, fairTcf, adjustment, alphaApplied: alpha };
    perFinisherCalc.set(cid, calc);
    newTcfByCompetitorId.set(cid, newTcf);
  }

  for (const [cid, s] of scores) {
    if (newTcfByCompetitorId.has(cid)) continue;
    if (s.tcfApplied != null) newTcfByCompetitorId.set(cid, s.tcfApplied);
  }

  const aggregates: EchoRaceAggregates = {
    alpha,
    finisherCount,
    ctAvg,
    meanTcf,
    sumH: tcfSum,
    sumReciprocalEt,
    updateSuppressed,
  };

  return { newTcfByCompetitorId, perFinisherCalc, aggregates };
}

/**
 * Build the `ProgressiveHandicapConfig` for a fleet. Returns `null` for static
 * fleets (scratch, IRC, PY) — the orchestrator skips phase B in that case.
 *
 * NHC1 reads parameters from `fleet.nhcProfile` when set (inline per-fleet
 * override) and falls back to `DEFAULT_NHC_PROFILE` (the stock SWNHC2015
 * constants) otherwise. Named per-series and per-workspace profile
 * registries are a future milestone (see docs/design/horizon.md).
 */
export function deriveProgressiveHandicapConfig(fleet: Fleet): ProgressiveHandicapConfig | null {
  if (fleet.scoringSystem === 'nhc') {
    const p = fleet.nhcProfile ?? DEFAULT_NHC_PROFILE;
    return {
      alphaUp: p.alphaP,
      alphaDown: p.alphaN,
      outlier: {
        strategy: 'reduce-alpha',
        sdThresholdUp: p.sdOver,
        sdThresholdDown: p.sdUnder,
        alphaUpReduced: p.alphaPX,
        alphaDownReduced: p.alphaNX,
        recomputeP50ForNonExtreme: true,
      },
      realignment: { target: 'prior-mean', minFinishers: p.minFin, includeDNC: false },
      minFinishers: p.minFin,
      formulaForm: 'is-pi',
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
 * Resolve an RDG redress score from a competitor's already-computed per-race
 * points and codes. Shared by the scratch and handicap standings passes.
 *
 * - `stated` → the entered points.
 * - `races_before` → mean of races before this one.
 * - `all_races` (default) → mean of every other race, including the boat's own
 *   non-finishing scores (RRS A9(a); HalSail RDG type 1).
 * - `all_races_excl_dnc` → as `all_races`, but DNC results are dropped from the
 *   pool up to the series discard allowance (HalSail RDG type 2). Excess DNCs
 *   beyond what may be discarded stay in the mean.
 * - `redressIncludeRaces` / `redressExcludeRaces` further scope the pool.
 *
 * Races with no finishers (`raceExcluded`) are never in the pool. An empty pool
 * falls back to the DNF score.
 */
function resolveRedressScore(
  finish: Finish,
  raceIdx: number,
  allPoints: number[],
  allCodes: (ResultCode | null)[],
  races: Race[],
  raceExcluded: boolean[],
  fallbackPoints: number,
  discardAllowance: number,
): number {
  if (finish.redressMethod === 'stated') {
    return finish.redressPoints ?? fallbackPoints;
  }

  let poolIndices: number[];
  if (finish.redressIncludeRaces && finish.redressIncludeRaces.length > 0) {
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
      poolIndices = [...new Set([...poolIndices, ...laterIndices])].sort((a, b) => a - b);
    }
  } else if (finish.redressExcludeRaces && finish.redressExcludeRaces.length > 0) {
    const excludeSet = new Set(finish.redressExcludeRaces);
    poolIndices = races
      .map((_, i) => i)
      .filter((i) =>
        (finish.redressMethod === 'races_before' ? i < raceIdx : i !== raceIdx) &&
        !excludeSet.has(races[i].raceNumber),
      );
  } else if (finish.redressMethod === 'races_before') {
    poolIndices = races.map((_, i) => i).filter((i) => i < raceIdx);
  } else {
    poolIndices = races.map((_, i) => i).filter((i) => i !== raceIdx);
  }

  poolIndices = poolIndices.filter((i) => !raceExcluded[i]);

  if (finish.redressMethod === 'all_races_excl_dnc') {
    // Drop the worst (highest-points) DNC results, up to the discard allowance.
    const dncWorstFirst = poolIndices
      .filter((i) => allCodes[i] === 'DNC')
      .sort((a, b) => allPoints[b] - allPoints[a]);
    const drop = new Set(dncWorstFirst.slice(0, Math.max(0, discardAllowance)));
    poolIndices = poolIndices.filter((i) => !drop.has(i));
  }

  if (poolIndices.length === 0) return fallbackPoints;
  const avg = poolIndices.reduce((s, i) => s + allPoints[i], 0) / poolIndices.length;
  return roundToTenth(avg);
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
 * per RRS A8: A8.1 compares each boat's non-discarded race scores best-to-worst;
 * if still tied, A8.2 counts back from the last race (using all race points,
 * including discards). See `tieBreak`.
 *
 * Non-discardable codes (DNE) are protected from discard selection even
 * when they are the worst score. (A plain BFD is an ordinary, discardable
 * disqualification — see scoring-codes.ts.)
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
  dnfScoring: DnfScoring = 'seriesEntries',
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
        raceExcluded: [],
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

  // Races with no finishers (every entry is a non-finish code, or no entries
  // at all) are excluded from scoring per issue #129: they score 0 for every
  // competitor, do not count toward the discard threshold, and are not
  // available in the RDG pool.
  const raceExcluded = new Array<boolean>(races.length).fill(false);

  for (let raceIdx = 0; raceIdx < races.length; raceIdx++) {
    const race = races[raceIdx];
    const raceFinishes = (finishesByRace.get(race.id) ?? []).filter((f) => f.competitorId !== null && competitorIds.has(f.competitorId));
    const raceFinishMap = new Map(raceFinishes.map((f) => [f.competitorId!, f]));
    const scores = calculateRaceScores(raceFinishes, competitors, dnfScoring);
    const hasFinisher = [...scores.values()].some((s) => s.place !== null);
    raceExcluded[raceIdx] = !hasFinisher;
    for (const competitor of competitors) {
      const score = scores.get(competitor.id);
      const rawPoints = score?.points ?? competitors.length + 1;
      const code = score ? score.resultCode : 'DNC';
      const finish = raceFinishMap.get(competitor.id);
      competitorRacePoints.get(competitor.id)!.push(raceExcluded[raceIdx] ? 0 : rawPoints);
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

  // Discard allowance feeds RDG type 2 (drop DNC up to this many).
  const redressDiscardAllowance = getDiscardCount(
    raceExcluded.filter((x) => !x).length,
    discardThresholds,
  );

  for (const { competitorId, raceIdx, finish } of rdgAssignments) {
    const race = races[raceIdx];
    if (circularRaceIds.has(race.id)) continue; // leave placeholder in place

    competitorRacePoints.get(competitorId)![raceIdx] = resolveRedressScore(
      finish,
      raceIdx,
      competitorRacePoints.get(competitorId)!,
      competitorRaceCodes.get(competitorId)!,
      races,
      raceExcluded,
      competitors.length + 1,
      redressDiscardAllowance,
    );
    competitorRaceRedressFlags.get(competitorId)![raceIdx] = true;
    // resultCode 'RDG' is already in competitorRaceCodes from the first pass
  }

  // Discard threshold counts only races that actually happened (per issue #129).
  const sailedRaceCount = raceExcluded.filter((x) => !x).length;
  const discardCount = Math.min(
    getDiscardCount(sailedRaceCount, discardThresholds),
    sailedRaceCount,
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

    // Select worst N discardable scores to discard. Excluded races (no
    // finishers) and codes that protect against discard are skipped.
    const raceDiscards = new Array<boolean>(racePoints.length).fill(false);
    if (discardCount > 0) {
      const discardable = racePoints
        .map((p, i) => ({ p, i }))
        .filter(({ i }) => !raceNonDiscardable[i] && !raceExcluded[i]);
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

    return { rank: 0, competitor, racePoints, raceCodes, racePenaltyCodes, racePenaltyOverrides, raceRedressFlags, totalPoints, netPoints, raceDiscards, raceNonDiscardable, raceExcluded: [...raceExcluded] };
  });

  // Sort: lowest net points wins, ties broken per RRS A8 (A8.1 then A8.2)
  standings.sort((a, b) => {
    if (a.netPoints !== b.netPoints) {
      return a.netPoints - b.netPoints;
    }
    return tieBreak(a, b);
  });

  // Assign ranks (tied competitors share the same rank)
  let rank = 1;
  for (let i = 0; i < standings.length; i++) {
    if (i > 0 && isTied(standings[i - 1], standings[i])) {
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
  dnfScoring: DnfScoring = 'seriesEntries',
  ratingOverrides: RaceRatingOverride[] = [],
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
  tcfHistory?: TcfRecord[];
  circularRedressRaces: number[];
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

  // Series-initial base ratings, snapshotted before the race loop starts
  // mutating appliedTcfMap. SWNHC2015's Step 6 realignment anchors to these
  // (not the carried ratings) so cumulative drift doesn't compound across a
  // series — see issue #147 §3(b).
  const baseTcfByCompetitorId = new Map(appliedTcfMap);

  // Per-race rating overrides (mid-series rating change). Static fleets only —
  // progressive systems recompute the rating every race and ignore them. The
  // override's field must match the fleet's system; its value is in the field's
  // own units (IRC TCC = TCF; PY number → 1000/number). Indexed raceId →
  // competitorId → TCF.
  const overrideField: RaceRatingOverride['field'] | null =
    fleet.scoringSystem === 'irc' ? 'ircTcc' : fleet.scoringSystem === 'py' ? 'pyNumber' : null;
  const overrideTcfByRace = new Map<string, Map<string, number>>();
  if (overrideField && !isProgressive) {
    for (const o of ratingOverrides) {
      if (o.field !== overrideField) continue;
      const tcf = fleet.scoringSystem === 'py' ? (o.value > 0 ? 1000 / o.value : null) : o.value;
      if (tcf == null) continue;
      if (!overrideTcfByRace.has(o.raceId)) overrideTcfByRace.set(o.raceId, new Map());
      overrideTcfByRace.get(o.raceId)!.set(o.competitorId, tcf);
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
        raceExcluded: [],
      })),
      rejections: allRejections,
      ...(isNhc ? { nhcRaceScoresByRaceId: new Map(), nhcAggregatesByRaceId: new Map() } : {}),
      ...(isEcho ? { echoRaceScoresByRaceId: new Map(), echoAggregatesByRaceId: new Map() } : {}),
      ...(isProgressive ? { tcfHistory: [] } : {}),
      circularRedressRaces: [],
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
  const tcfHistory: TcfRecord[] = [];

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

  // Races with no finishers (every entry is a non-finish code, or no entries
  // at all) are excluded from scoring per issue #129: 0 points for everyone
  // and they do not count toward the discard threshold.
  const raceExcluded = new Array<boolean>(races.length).fill(false);
  const fleetCompetitorIds = new Set(competitors.map((c) => c.id));

  for (let raceIdx = 0; raceIdx < races.length; raceIdx++) {
    const race = races[raceIdx];
    const raceFinishes = finishesByRace.get(race.id) ?? [];
    const raceStart = startsByRaceId.get(race.id);

    let scores: Map<string, { points: number; place: number | null; resultCode: ResultCode | null }>;
    if (raceStart) {
      // Phase A — race scoring (applies to both static and progressive fleets).
      // For static fleets, apply this race's rating overrides over the base map.
      const raceOverrides = overrideTcfByRace.get(race.id);
      const effectiveTcfMap = raceOverrides && raceOverrides.size > 0
        ? new Map(appliedTcfMap)
        : appliedTcfMap;
      if (raceOverrides && effectiveTcfMap !== appliedTcfMap) {
        for (const [cid, tcf] of raceOverrides) {
          if (appliedTcfMap.has(cid)) effectiveTcfMap.set(cid, tcf);
        }
      }
      const phaseA = calculateHandicapRaceScores(raceFinishes, ratedCompetitors, raceStart, effectiveTcfMap, dnfScoring);
      let raceScores = phaseA.scores;

      // Phase B — handicap adjustment (progressive fleets only)
      if (config) {
        const phaseB = calculateHandicapAdjustment(raceScores, config, baseTcfByCompetitorId);

        // Merge phase-B outputs back into the per-boat scores: newTcf for
        // every competitor; per-finisher intermediates copied into the
        // per-system display field (`nhc` for NHC fleets, `echo` for ECHO).
        // The engine produces NhcRaceCalc when outlier.strategy === 'reduce-alpha'
        // and EchoRaceCalc otherwise; isNhc/isEcho is derived from the same
        // config so the cast is safe.
        const merged = new Map<string, HandicapRaceScore>();
        for (const [cid, s] of raceScores) {
          const newTcf = phaseB.newTcfByCompetitorId.get(cid) ?? s.tcfApplied;
          const calc = phaseB.perFinisherCalc.get(cid);
          merged.set(cid, {
            ...s,
            newTcf,
            ...(calc && isNhc ? { nhc: calc as NhcRaceCalc } : {}),
            ...(calc && isEcho ? { echo: calc as EchoRaceCalc } : {}),
          });
        }
        raceScores = merged;

        if (isNhc) {
          nhcRaceScoresByRaceId.set(race.id, raceScores);
          nhcAggregatesByRaceId.set(race.id, phaseB.aggregates as NhcRaceAggregates);
        } else if (isEcho) {
          echoRaceScoresByRaceId.set(race.id, raceScores);
          echoAggregatesByRaceId.set(race.id, phaseB.aggregates as EchoRaceAggregates);
        }

        // Audit trail: one record per (race, competitor) covering both
        // finishers and non-finishers (so an absent Finish row still leaves
        // a TCF history entry).
        for (const [cid, newTcf] of phaseB.newTcfByCompetitorId) {
          const tcfApplied = appliedTcfMap.get(cid)!;
          tcfHistory.push({
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
      scores = new Map([...scratchScores.entries()].map(([id, s]) => [id, { points: s.points, place: s.place, resultCode: s.resultCode }]));
    }

    const hasFinisher = [...scores.values()].some((s) => s.place !== null);
    raceExcluded[raceIdx] = !hasFinisher;

    // Additive scoring penalties (ZFP/SCP/DPI) apply to finishers in handicap
    // fleets too, capped at this race's DNF score.
    const fleetRaceFinishes = raceFinishes.filter((f) => f.competitorId !== null && fleetCompetitorIds.has(f.competitorId));
    const penaltyCap = dnfScoreForRace(fleetRaceFinishes, competitors.length, dnfScoring);
    const finishMap = new Map(fleetRaceFinishes.map((f) => [f.competitorId as string, f]));

    for (const competitor of competitors) {
      if (rejectedIds.has(competitor.id)) continue; // excluded from scoring
      const score = scores.get(competitor.id);
      const rawPoints = score?.points ?? competitors.length + 1;
      const finish = finishMap.get(competitor.id);
      const isFinisher = score?.place != null;
      const points = isFinisher ? applyAdditivePenalty(rawPoints, finish, penaltyCap) : rawPoints;
      competitorRacePoints.get(competitor.id)!.push(raceExcluded[raceIdx] ? 0 : points);
      competitorRaceCodes.get(competitor.id)!.push(score !== undefined ? score.resultCode : 'DNC');
      competitorRacePenaltyCodes.get(competitor.id)!.push(isFinisher ? (finish?.penaltyCode ?? null) : null);
      competitorRacePenaltyOverrides.get(competitor.id)!.push(isFinisher ? (finish?.penaltyOverride ?? null) : null);
      competitorRaceRedressFlags.get(competitor.id)!.push(false);
    }
  }

  // Discard threshold counts only races that actually happened (per issue #129).
  const sailedRaceCount = raceExcluded.filter((x) => !x).length;
  const discardCount = Math.min(
    getDiscardCount(sailedRaceCount, discardThresholds),
    sailedRaceCount,
  );

  // ── Redress (RDG) ─────────────────────────────────────────────────────────
  // Resolve RDG scores against the per-race points computed above, then they
  // participate in discards/totals normally. Mirrors calculateStandings.
  const fleetCompIds = new Set(competitors.map((c) => c.id));
  const rdgAssignments: Array<{ competitorId: string; raceIdx: number; finish: Finish }> = [];
  const rdgByRaceId = new Map<string, number>();
  for (let raceIdx = 0; raceIdx < races.length; raceIdx++) {
    for (const f of finishesByRace.get(races[raceIdx].id) ?? []) {
      if (f.resultCode === 'RDG' && f.competitorId !== null && fleetCompIds.has(f.competitorId) && !rejectedIds.has(f.competitorId)) {
        rdgAssignments.push({ competitorId: f.competitorId, raceIdx, finish: f });
        rdgByRaceId.set(races[raceIdx].id, (rdgByRaceId.get(races[raceIdx].id) ?? 0) + 1);
      }
    }
  }
  // 2+ RDG in the same race is a circular dependency — leave placeholders.
  const circularRaceIds = new Set<string>();
  const circularRedressRaces: number[] = [];
  for (const [raceId, count] of rdgByRaceId) {
    if (count >= 2) {
      circularRaceIds.add(raceId);
      const r = races.find((rr) => rr.id === raceId);
      if (r) circularRedressRaces.push(r.raceNumber);
    }
  }
  for (const { competitorId, raceIdx, finish } of rdgAssignments) {
    if (circularRaceIds.has(races[raceIdx].id)) continue;
    competitorRacePoints.get(competitorId)![raceIdx] = resolveRedressScore(
      finish,
      raceIdx,
      competitorRacePoints.get(competitorId)!,
      competitorRaceCodes.get(competitorId)!,
      races,
      raceExcluded,
      competitors.length + 1,
      getDiscardCount(sailedRaceCount, discardThresholds),
    );
    competitorRaceRedressFlags.get(competitorId)![raceIdx] = true;
  }

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
      // Discard worst non-protected scores; excluded races (no finishers) are
      // ineligible.
      const indexed = racePoints
        .map((p, i) => ({ p, i }))
        .filter(({ i }) => !raceNonDiscardable[i] && !raceExcluded[i])
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
      raceExcluded: [...raceExcluded],
    };
  });

  // Rank by netPoints; ties broken per RRS A8 (A8.1 then A8.2).
  // Tied competitors share the same rank, matching calculateStandings.
  standings.sort((a, b) => {
    if (a.netPoints !== b.netPoints) return a.netPoints - b.netPoints;
    return tieBreak(a, b);
  });
  let hrank = 1;
  for (let i = 0; i < standings.length; i++) {
    if (i > 0 && isTied(standings[i - 1], standings[i])) {
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
    ...(isProgressive ? { tcfHistory } : {}),
    circularRedressRaces,
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
  dnfScoring: DnfScoring = 'seriesEntries',
  raceStarts: RaceStart[] = [],
  ratingOverrides: RaceRatingOverride[] = [],
): {
  fleetStandings: {
    fleet: Fleet;
    standings: Standing[];
    rejections: ScoringRejection[];
    nhcRaceScoresByRaceId?: Map<string, Map<string, HandicapRaceScore>>;
    nhcAggregatesByRaceId?: Map<string, NhcRaceAggregates>;
    echoRaceScoresByRaceId?: Map<string, Map<string, HandicapRaceScore>>;
    echoAggregatesByRaceId?: Map<string, EchoRaceAggregates>;
    tcfHistory?: TcfRecord[];
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
      const { standings, rejections, nhcRaceScoresByRaceId, nhcAggregatesByRaceId, echoRaceScoresByRaceId, echoAggregatesByRaceId, tcfHistory, circularRedressRaces } = calculateHandicapStandings(
        fleetCompetitors,
        races,
        allFinishes,
        raceStarts,
        fleet,
        discardThresholds,
        dnfScoring,
        ratingOverrides,
      );
      allCircular.push(...circularRedressRaces);
      return { fleet, standings, rejections, nhcRaceScoresByRaceId, nhcAggregatesByRaceId, echoRaceScoresByRaceId, echoAggregatesByRaceId, tcfHistory };
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
 * Non-discarded race scores for a standing, sorted best (lowest) to worst
 * (highest) — the list A8.1 compares. Excluded races (nobody finished) score 0
 * for every boat, so they add equal leading entries and never affect the
 * first point of difference.
 */
function nonDiscardedScoresSorted(s: Standing): number[] {
  const scores: number[] = [];
  for (let i = 0; i < s.racePoints.length; i++) {
    if (!s.raceDiscards[i]) scores.push(s.racePoints[i]);
  }
  return scores.sort((x, y) => x - y);
}

/**
 * Tie-break two competitors per RRS A8 (2025-2028 Appendix A), in order:
 *
 *   A8.1  List each boat's race scores best (lowest points) to worst,
 *         EXCLUDING discarded scores, and break the tie in favour of the boat
 *         that is better at the first point of difference.
 *   A8.2  If a tie remains, rank by score in the last race, then the
 *         next-to-last race, and so on. These scores are used even if some of
 *         them are discarded.
 *
 * There is no place-count rung ("most 1sts, then 2nds, …") — that was removed
 * from the RRS before the 2025-2028 edition.
 *
 * Returns negative if a beats b (a ranks ahead), positive if b beats a, 0 if
 * the boats are still perfectly tied.
 */
function tieBreak(a: Standing, b: Standing): number {
  // A8.1 — compare non-discarded scores position-by-position, best to worst.
  const aSorted = nonDiscardedScoresSorted(a);
  const bSorted = nonDiscardedScoresSorted(b);
  const len = Math.min(aSorted.length, bSorted.length);
  for (let i = 0; i < len; i++) {
    const diff = aSorted[i] - bSorted[i];
    if (diff !== 0) return diff;
  }

  // A8.2 — countback from the last race, using all scores incl. discards.
  for (let i = a.racePoints.length - 1; i >= 0; i--) {
    const diff = a.racePoints[i] - b.racePoints[i];
    if (diff !== 0) return diff;
  }

  return 0;
}

function isTied(a: Standing, b: Standing): boolean {
  return tieBreak(a, b) === 0;
}
