import type { Competitor, Fleet, Race, Finish, RaceScore, HandicapRaceScore, RaceStart, RaceRatingOverride, Standing, ResultCode, PenaltyCode, DiscardThreshold, DnfScoring, ScoringRejection, NhcRaceCalc, NhcRaceAggregates, EchoRaceCalc, EchoRaceAggregates, TcfRecord, NhcProfile, ProgressiveHandicapConfig, ProgressiveRaceCalc, ProgressiveRaceAggregates, SubSeries } from './types';
import { getCodeDefinition } from './scoring-codes';
import { parseHmsToSeconds } from './time-parse';

export const ECHO_DEFAULT_ALPHA = 0.25;  // Irish Sailing 2022 ECHO Guide: 75/25 club racing
export const ECHO_REGATTA_ALPHA = 0.50;  // Irish Sailing 2022 ECHO Guide: 50/50 regattas/major events

// Stock SWNHC2015 spreadsheet constants (Jon Eskdale, version 2014-01-05-0).
// Reverse-engineered to match Sailwave NHC1 output to 3 dp across all
// finishers of all five HYC test fleets. See
// docs/notes/sailwave/nhc1-reverse-engineering.md §10 for the algorithm and
// the reference Python implementation it transcribes.
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
/** The penalty ceiling for a race (RRS 44.3(c): never worse than DNF): the
 *  score a boat gets for DNF, per the dnfScoring rule (mirrors
 *  `startingAreaPenalty` in calculateRaceScores). `fleetFinishes` must be
 *  pre-filtered to the fleet. */
function dnfScoreForRace(fleetFinishes: Finish[], entrantCount: number, dnfScoring: DnfScoring): number {
  if (dnfScoring === 'seriesEntries') return entrantCount + 1;
  const hasCheckin = fleetFinishes.some((f) => f.startPresent === true);
  const startingAreaCount = hasCheckin
    ? fleetFinishes.filter((f) => f.startPresent === true).length
    : fleetFinishes.filter((f) => f.resultCode !== 'DNC').length;
  return startingAreaCount + 1;
}

/**
 * Resolve a per-fleet scalar (per-fleet RDG points / DPI points) for the fleet
 * currently being scored. The per-fleet map wins when present and populated:
 * a fleet present in the map uses that value; a fleet *absent* from a populated
 * map is a `gap` (the caller decides the fallback). With no per-fleet map — or
 * no fleet context — the uniform `scalar` applies (and never reads as a gap).
 */
function resolvePerFleetScalar(
  byFleet: Record<string, number> | undefined,
  scalar: number | null,
  fleetId: string | undefined,
): { value: number | null; gap: boolean } {
  if (byFleet && fleetId !== undefined && Object.keys(byFleet).length > 0) {
    if (Object.prototype.hasOwnProperty.call(byFleet, fleetId)) {
      return { value: byFleet[fleetId], gap: false };
    }
    return { value: null, gap: true };
  }
  return { value: scalar, gap: false };
}

/** Apply an additive scoring penalty (ZFP/SCP/DPI) to a finisher's points. Per
 *  RRS 44.3(c) a percentage penalty is the stated % (default 20%) of the DNF
 *  score, **rounded to the nearest tenth of a point (0.05 up)** — not the
 *  nearest whole number — and a boat is never scored worse than DNF (`cap`).
 *  No-op when the finish carries no penalty. Caller restricts this to
 *  finishers. `fleetId` selects the per-fleet DPI points for multi-fleet boats;
 *  a boat in per-fleet mode with no value for this fleet adds nothing (a
 *  penalty is never fabricated — the gap is surfaced separately). */
function applyAdditivePenalty(
  basePoints: number,
  finish: Finish | undefined,
  cap: number,
  fleetId?: string,
): number {
  if (!finish?.penaltyCode) return basePoints;
  const method = getCodeDefinition(finish.penaltyCode)?.pointsMethod;
  if (method?.type === 'additive_percentage') {
    // SCP/ZFP are a percentage of the DNF score, which is already per-fleet —
    // so a single stored rate yields the correct per-fleet points; no per-fleet
    // override is needed or read here.
    const pct = finish.penaltyOverride ?? method.defaultPct;
    // pct% of the DNF score, to the nearest 0.1 (0.05 rounded up). pct and cap
    // are whole numbers, so pct*cap/10 is exact before the half-up rounding.
    const penalty = Math.round((pct * cap) / 10) / 10;
    // roundToTenth on the sum: base is a tenth and so is the penalty, but their
    // float sum (e.g. 2 + 0.6) carries IEEE noise that would surface in the UI.
    return Math.min(roundToTenth(basePoints + penalty), cap);
  }
  if (method?.type === 'additive_stated') {
    const { value } = resolvePerFleetScalar(finish.penaltyOverrideByFleet, finish.penaltyOverride, fleetId);
    return Math.min(roundToTenth(basePoints + (value ?? 0)), cap);
  }
  return basePoints;
}

export function calculateRaceScores(
  finishes: Finish[],
  competitors: Competitor[],
  dnfScoring: DnfScoring = 'seriesEntries',
  fleetId?: string,
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
    const penalized = applyAdditivePenalty(score.points, finishMap.get(competitor.id), startingAreaPenalty, fleetId);
    if (penalized !== score.points) result.set(competitor.id, { ...score, points: penalized });
  }

  return result;
}

/**
 * Derive the Time Correction Factor for a competitor in a handicap fleet.
 * IRC:  TCF = TCC (stored directly on the competitor).
 * VPRS: TCF = TCC (same static time-on-time shape as IRC).
 * PY:   TCF = 1000 / pyNumber.
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
  if (fleet.scoringSystem === 'vprs') {
    // VPRS is time-on-time: CT = ET × TCC, the same static-TCF shape as IRC
    // (vprs.org: "multiply the elapsed time by the yacht's TCC").
    return competitor.vprsTcc ?? null;
  }
  if (fleet.scoringSystem === 'py') {
    return competitor.pyNumber != null ? 1000 / competitor.pyNumber : null;
  }
  return null;
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
  const startSeconds = parseHmsToSeconds(raceStart.startTime);

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
    const finishSeconds = parseHmsToSeconds(finish.finishTime);
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
 * See docs/notes/sailwave/nhc1-reverse-engineering.md §10 for the algorithm
 * and the reference Python `nr_swnhc2015_full` this transcribes.
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
    // Round the carried handicap to 3 dp, matching the published ECHO rating
    // (Irish Sailing publishes 3 dp; HalSail carries the rounded value into the
    // next race). The NHC path rounds the same way. Carrying full precision
    // makes a multi-race progression drift from the published numbers and can
    // flip a tight corrected-time finish.
    const newTcf = Math.round((s.tcfApplied! + adjustment) * 1000) / 1000;
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
  fleetId?: string,
): number {
  if (finish.redressMethod === 'stated') {
    const { value, gap } = resolvePerFleetScalar(finish.redressPointsByFleet, finish.redressPoints, fleetId);
    // Per-fleet gap (boat in per-fleet mode with no value for this fleet): redress
    // is a benefit the boat is entitled to, so fall through to the A9(a) average
    // below rather than fabricating or DNF-ing. Uniform mode is unchanged.
    if (!gap) return value ?? fallbackPoints;
  }

  let poolIndices: number[];
  if (finish.redressIncludeRaceIds && finish.redressIncludeRaceIds.length > 0) {
    const includeSet = new Set(finish.redressIncludeRaceIds);
    poolIndices = races
      .map((r, i) => ({ r, i }))
      .filter(({ r, i }) => includeSet.has(r.id) && i !== raceIdx)
      .map(({ i }) => i);
    if (finish.redressIncludeAllLater) {
      // "all later" is positional: every race sailed after the latest included
      // one, measured by race number (the order column), not by id.
      const includedNumbers = races.filter((r) => includeSet.has(r.id)).map((r) => r.raceNumber);
      const maxIncluded = includedNumbers.length > 0 ? Math.max(...includedNumbers) : -Infinity;
      const laterIndices = races
        .map((r, i) => ({ r, i }))
        .filter(({ r, i }) => r.raceNumber > maxIncluded && i !== raceIdx)
        .map(({ i }) => i);
      poolIndices = [...new Set([...poolIndices, ...laterIndices])].sort((a, b) => a - b);
    }
  } else if (finish.redressExcludeRaceIds && finish.redressExcludeRaceIds.length > 0) {
    const excludeSet = new Set(finish.redressExcludeRaceIds);
    poolIndices = races
      .map((_, i) => i)
      .filter((i) =>
        (finish.redressMethod === 'races_before' ? i < raceIdx : i !== raceIdx) &&
        !excludeSet.has(races[i].id),
      );
  } else if (finish.redressMethod === 'races_before') {
    poolIndices = races.map((_, i) => i).filter((i) => i < raceIdx);
  } else {
    poolIndices = races.map((_, i) => i).filter((i) => i !== raceIdx);
  }

  poolIndices = poolIndices.filter((i) => !raceExcluded[i]);

  // A redress score is itself an average of other races; never fold one redress
  // result into another's pool. Otherwise a boat with RDG in two races gets
  // order-dependent values (each averaging the other's placeholder) instead of
  // both equalling the mean of its actually-sailed races. Exclude the boat's
  // other RDG races from every pool.
  poolIndices = poolIndices.filter((i) => allCodes[i] !== 'RDG');

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

// ─── Shared standings-assembly phases ────────────────────────────────────────
//
// `calculateStandings` (scratch) and `calculateHandicapStandings` orchestrate
// the same series-assembly pipeline around their different per-race scoring.
// Each shared phase lives here exactly once: this is the scoring engine, and
// silent drift between the two paths means wrong published results.

/** The per-competitor, per-race series accumulators the race loops fill in.
 *  One entry per competitor; each array is indexed by race. */
interface PerCompetitorSeries {
  racePoints: Map<string, number[]>;
  raceRanks: Map<string, (number | null)[]>;
  raceCodes: Map<string, (ResultCode | null)[]>;
  racePenaltyCodes: Map<string, (PenaltyCode | null)[]>;
  racePenaltyOverrides: Map<string, (number | null)[]>;
  raceRedressFlags: Map<string, boolean[]>;
}

function initPerCompetitorSeries(competitors: Competitor[]): PerCompetitorSeries {
  const per: PerCompetitorSeries = {
    racePoints: new Map(),
    raceRanks: new Map(),
    raceCodes: new Map(),
    racePenaltyCodes: new Map(),
    racePenaltyOverrides: new Map(),
    raceRedressFlags: new Map(),
  };
  for (const c of competitors) {
    per.racePoints.set(c.id, []);
    per.raceRanks.set(c.id, []);
    per.raceCodes.set(c.id, []);
    per.racePenaltyCodes.set(c.id, []);
    per.racePenaltyOverrides.set(c.id, []);
    per.raceRedressFlags.set(c.id, []);
  }
  return per;
}

function groupFinishesByRace(allFinishes: Finish[]): Map<string, Finish[]> {
  const byRace = new Map<string, Finish[]>();
  for (const finish of allFinishes) {
    const list = byRace.get(finish.raceId) ?? [];
    list.push(finish);
    byRace.set(finish.raceId, list);
  }
  return byRace;
}

/** Standings for the degenerate no-competitors / no-races case. */
function emptyStandings(competitors: Competitor[]): Standing[] {
  return competitors.map((c, i) => ({
    rank: i + 1,
    competitor: c,
    racePoints: [],
    raceRanks: [],
    raceCodes: [],
    racePenaltyCodes: [],
    racePenaltyOverrides: [],
    raceRedressFlags: [],
    totalPoints: 0,
    netPoints: 0,
    raceDiscards: [],
    raceNonDiscardable: [],
    raceExcluded: [],
  }));
}

/**
 * A race is excluded for a fleet (scores 0, does not count toward the
 * discard threshold, not in the RDG pool — issue #129) unless it was validly
 * held *and* the fleet sailed it. "Validly held" = at least one boat
 * anywhere on the sheet finished (so an abandoned/all-DNC race is excluded
 * for everyone). "The fleet sailed it" = at least one of the fleet's boats
 * came to the start (a non-DNC record); a fleet absent from a race (all
 * implicit DNC) is excluded, but a fleet that came and all retired/DNF'd
 * still scores the race (came-to-start + 1), matching how a multi-fleet sheet
 * is published.
 */
function computeRaceExclusion(
  allRaceFinishes: Finish[],
  fleetFinishes: Finish[],
): boolean {
  const raceHeld = allRaceFinishes.some(
    (f) => f.resultCode === null && (f.finishTime != null || f.sortOrder !== null),
  );
  const fleetCameToStart = fleetFinishes.some((f) => f.resultCode !== 'DNC');
  return !(raceHeld && fleetCameToStart);
}

/**
 * The discard allowances derived from the races that actually happened (per
 * issue #129, excluded races earn no discard-threshold credit):
 * - `discardCount` — how many races each competitor discards, capped at the
 *   sailed-race count.
 * - `redressDiscardAllowance` — the uncapped threshold value, which feeds
 *   RDG type 2 (`all_races_excl_dnc` drops worst DNCs up to this many).
 */
function computeDiscardCounts(
  raceExcluded: boolean[],
  discardThresholds: DiscardThreshold[],
): { discardCount: number; redressDiscardAllowance: number } {
  const sailedRaceCount = raceExcluded.filter((x) => !x).length;
  const redressDiscardAllowance = getDiscardCount(sailedRaceCount, discardThresholds);
  return {
    discardCount: Math.min(redressDiscardAllowance, sailedRaceCount),
    redressDiscardAllowance,
  };
}

/**
 * Second pass over the sheet: collect RDG finishes and resolve each one via
 * `resolveRedressScore` against the per-race points the race loop produced.
 * Mutates `per.racePoints` / `per.raceRedressFlags` in place.
 *
 * 2+ RDG in the same race is a circular dependency (each boat's average
 * would fold in the other's placeholder), so those races keep their
 * placeholder scores; the returned race numbers let the UI flag them.
 */
function collectAndResolveRdg(args: {
  races: Race[];
  finishesByRace: Map<string, Finish[]>;
  /** Whether a competitor participates in this fleet's standings — fleet
   *  membership, and for handicap fleets, not rejected for a missing rating. */
  eligible: (competitorId: string) => boolean;
  per: PerCompetitorSeries;
  raceExcluded: boolean[];
  fallbackPoints: number;
  discardAllowance: number;
  /** The fleet being scored — selects per-fleet stated redress points. */
  fleetId?: string;
}): number[] {
  const { races, finishesByRace, eligible, per, raceExcluded } = args;

  const rdgAssignments: Array<{ competitorId: string; raceIdx: number; finish: Finish }> = [];
  const rdgCountByRaceId = new Map<string, number>();
  for (let raceIdx = 0; raceIdx < races.length; raceIdx++) {
    for (const f of finishesByRace.get(races[raceIdx].id) ?? []) {
      if (f.resultCode === 'RDG' && f.competitorId !== null && eligible(f.competitorId)) {
        rdgAssignments.push({ competitorId: f.competitorId, raceIdx, finish: f });
        rdgCountByRaceId.set(
          races[raceIdx].id,
          (rdgCountByRaceId.get(races[raceIdx].id) ?? 0) + 1,
        );
      }
    }
  }

  const circularRaceIds = new Set<string>();
  const circularRedressRaces: number[] = [];
  for (const [raceId, count] of rdgCountByRaceId) {
    if (count >= 2) {
      circularRaceIds.add(raceId);
      const r = races.find((rr) => rr.id === raceId);
      if (r) circularRedressRaces.push(r.raceNumber);
    }
  }

  for (const { competitorId, raceIdx, finish } of rdgAssignments) {
    if (circularRaceIds.has(races[raceIdx].id)) continue; // leave placeholder in place
    per.racePoints.get(competitorId)![raceIdx] = resolveRedressScore(
      finish,
      raceIdx,
      per.racePoints.get(competitorId)!,
      per.raceCodes.get(competitorId)!,
      races,
      raceExcluded,
      args.fallbackPoints,
      args.discardAllowance,
      args.fleetId,
    );
    per.raceRedressFlags.get(competitorId)![raceIdx] = true;
    // resultCode 'RDG' is already in per.raceCodes from the race loop
  }

  return circularRedressRaces;
}

/**
 * Per-competitor standings assembly: series totals, non-discardable flags
 * from the code definitions, worst-N discard selection, net points.
 * `competitors` is the list that appears in the standings — for handicap
 * fleets that's the rated competitors only.
 */
function assembleStandings(
  competitors: Competitor[],
  per: PerCompetitorSeries,
  raceExcluded: boolean[],
  discardCount: number,
): Standing[] {
  return competitors.map((competitor) => {
    const racePoints = per.racePoints.get(competitor.id)!;
    const raceRanks = per.raceRanks.get(competitor.id)!;
    const raceCodes = per.raceCodes.get(competitor.id)!;
    const racePenaltyCodes = per.racePenaltyCodes.get(competitor.id)!;
    const racePenaltyOverrides = per.racePenaltyOverrides.get(competitor.id)!;
    const raceRedressFlags = per.raceRedressFlags.get(competitor.id)!;
    // roundToTenth on the series totals: every per-race score is a multiple of
    // 0.1, so summing them is exact in principle but accumulates IEEE noise
    // (e.g. 6.6 - 2.6 = 3.9999999999999996) that would show in the UI.
    const totalPoints = roundToTenth(racePoints.reduce((sum, p) => sum + p, 0));

    // Determine non-discardable flags from code definitions
    const raceNonDiscardable = raceCodes.map((code) => {
      if (!code) return false;
      const def = getCodeDefinition(code);
      return def ? !def.discardable : false;
    });

    // Select worst N discardable scores to discard. Excluded races (no
    // finishers) and codes that protect against discard are skipped; among
    // equal scores the earliest race is discarded first.
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

    const netPoints = roundToTenth(racePoints.reduce(
      (sum, p, i) => sum + (raceDiscards[i] ? 0 : p),
      0,
    ));

    return { rank: 0, competitor, racePoints, raceRanks, raceCodes, racePenaltyCodes, racePenaltyOverrides, raceRedressFlags, totalPoints, netPoints, raceDiscards, raceNonDiscardable, raceExcluded: [...raceExcluded] };
  });
}

/**
 * Final sort — lowest net points wins, ties broken per RRS A8 (A8.1 then
 * A8.2, see `tieBreak`) — and rank assignment, with tied competitors
 * sharing the same rank. Sorts and ranks in place.
 */
function sortAndRank(standings: Standing[]): void {
  standings.sort((a, b) => {
    if (a.netPoints !== b.netPoints) {
      return a.netPoints - b.netPoints;
    }
    return tieBreak(a, b);
  });
  let rank = 1;
  for (let i = 0; i < standings.length; i++) {
    if (i > 0 && isTied(standings[i - 1], standings[i])) {
      standings[i].rank = standings[i - 1].rank;
    } else {
      standings[i].rank = rank;
    }
    rank++;
  }
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
  fleetId?: string,
  excludedRaceIds?: Set<string>,
): { standings: Standing[]; circularRedressRaces: number[] } {
  const competitorIds = new Set(competitors.map((c) => c.id));

  if (competitors.length === 0 || races.length === 0) {
    return { standings: emptyStandings(competitors), circularRedressRaces: [] };
  }

  const finishesByRace = groupFinishesByRace(allFinishes);
  const per = initPerCompetitorSeries(competitors);
  const raceExcluded = new Array<boolean>(races.length).fill(false);

  // Race loop: per-race scratch scores into the per-competitor accumulators.
  for (let raceIdx = 0; raceIdx < races.length; raceIdx++) {
    const race = races[raceIdx];
    const allRaceFinishes = finishesByRace.get(race.id) ?? [];
    const raceFinishes = allRaceFinishes.filter((f) => f.competitorId !== null && competitorIds.has(f.competitorId));
    const raceFinishMap = new Map(raceFinishes.map((f) => [f.competitorId!, f]));
    const scores = calculateRaceScores(raceFinishes, competitors, dnfScoring, fleetId);
    raceExcluded[raceIdx] =
      computeRaceExclusion(allRaceFinishes, raceFinishes) || (excludedRaceIds?.has(race.id) ?? false);
    for (const competitor of competitors) {
      const score = scores.get(competitor.id);
      const rawPoints = score?.points ?? competitors.length + 1;
      const code = score ? score.resultCode : 'DNC';
      const finish = raceFinishMap.get(competitor.id);
      per.racePoints.get(competitor.id)!.push(raceExcluded[raceIdx] ? 0 : rawPoints);
      per.raceRanks.get(competitor.id)!.push(raceExcluded[raceIdx] ? null : (score?.rank ?? null));
      per.raceCodes.get(competitor.id)!.push(code);
      per.racePenaltyCodes.get(competitor.id)!.push(finish?.penaltyCode ?? null);
      per.racePenaltyOverrides.get(competitor.id)!.push(finish?.penaltyOverride ?? null);
      per.raceRedressFlags.get(competitor.id)!.push(false);
    }
  }

  const { discardCount, redressDiscardAllowance } = computeDiscardCounts(
    raceExcluded,
    discardThresholds,
  );

  const circularRedressRaces = collectAndResolveRdg({
    races,
    finishesByRace,
    eligible: (competitorId) => competitorIds.has(competitorId),
    per,
    raceExcluded,
    fallbackPoints: competitors.length + 1,
    discardAllowance: redressDiscardAllowance,
    fleetId,
  });

  const standings = assembleStandings(competitors, per, raceExcluded, discardCount);
  sortAndRank(standings);

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
  startingTcfOverrides?: Map<string, number>,
  excludedRaceIds?: Set<string>,
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

  // Sub-series seeding: when a block of races is scored mid-chain, the
  // applied TCFs start from the carried end-of-previous-block values rather
  // than the competitors' series-initial ratings. The realignment anchor
  // above deliberately stays series-initial, so a block-by-block computation
  // reproduces the whole-series chain exactly.
  if (isProgressive && startingTcfOverrides) {
    for (const [competitorId, tcf] of startingTcfOverrides) {
      if (appliedTcfMap.has(competitorId)) appliedTcfMap.set(competitorId, tcf);
    }
  }

  // Per-race rating overrides (mid-series rating change). Static fleets only —
  // progressive systems recompute the rating every race and ignore them. The
  // override's field must match the fleet's system; its value is in the field's
  // own units (IRC TCC = TCF; PY number → 1000/number). Indexed raceId →
  // competitorId → TCF.
  const overrideField: RaceRatingOverride['field'] | null =
    fleet.scoringSystem === 'irc' ? 'ircTcc'
      : fleet.scoringSystem === 'vprs' ? 'vprsTcc'
        : fleet.scoringSystem === 'py' ? 'pyNumber'
          : null;
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
      standings: emptyStandings(rated),
      rejections: allRejections,
      ...(isNhc ? { nhcRaceScoresByRaceId: new Map(), nhcAggregatesByRaceId: new Map() } : {}),
      ...(isEcho ? { echoRaceScoresByRaceId: new Map(), echoAggregatesByRaceId: new Map() } : {}),
      ...(isProgressive ? { tcfHistory: [] } : {}),
      circularRedressRaces: [],
    };
  }

  // Build raceStart lookup: for each race, find the timed start that covers
  // this fleet. A membership-only start (no gun time) only scopes which fleets
  // are in the race — it carries no elapsed-time basis, so it's skipped here
  // and the race falls back to scratch scoring (the no-start branch below).
  const startsByRaceId = new Map<string, RaceStart>();
  for (const rs of raceStarts) {
    if (rs.fleetIds.includes(fleet.id) && rs.startTime) {
      startsByRaceId.set(rs.raceId, rs);
    }
  }

  const finishesByRace = groupFinishesByRace(allFinishes);

  const ratedCompetitors = competitors.filter((c) => !rejectedIds.has(c.id));

  // Progressive-system outputs collected across races. NHC and ECHO each
  // get their own per-system maps (HandicapRaceScore.nhc / .echo); the TCF
  // history is shared across both progressive systems.
  const nhcRaceScoresByRaceId = new Map<string, Map<string, HandicapRaceScore>>();
  const nhcAggregatesByRaceId = new Map<string, NhcRaceAggregates>();
  const echoRaceScoresByRaceId = new Map<string, Map<string, HandicapRaceScore>>();
  const echoAggregatesByRaceId = new Map<string, EchoRaceAggregates>();
  const tcfHistory: TcfRecord[] = [];

  const per = initPerCompetitorSeries(competitors);
  const raceExcluded = new Array<boolean>(races.length).fill(false);
  const fleetCompetitorIds = new Set(competitors.map((c) => c.id));

  for (let raceIdx = 0; raceIdx < races.length; raceIdx++) {
    const race = races[raceIdx];
    const raceFinishes = finishesByRace.get(race.id) ?? [];
    const raceStart = startsByRaceId.get(race.id);
    // A race struck for this fleet scores 0 and — crucially — must not advance
    // the progressive chain, so Phase B is skipped below (the handicap holds
    // across the struck race, as if it weren't sailed for this fleet).
    const forcedExcluded = excludedRaceIds?.has(race.id) ?? false;

    let scores: Map<string, { points: number; place: number | null; rank: number | null; resultCode: ResultCode | null }>;
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

      // Phase B — handicap adjustment (progressive fleets only). Skipped for a
      // struck race so its results never update the chain.
      if (config && !forcedExcluded) {
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
      const scratchScores = calculateRaceScores(raceFinishes, competitors, dnfScoring, fleet.id);
      scores = new Map([...scratchScores.entries()].map(([id, s]) => [id, { points: s.points, place: s.place, rank: s.rank, resultCode: s.resultCode }]));
    }

    // `raceFinishes` here is the whole sheet; `fleetRaceFinishes` is this
    // fleet (issue #129 — see computeRaceExclusion).
    const fleetRaceFinishes = raceFinishes.filter((f) => f.competitorId !== null && fleetCompetitorIds.has(f.competitorId));
    raceExcluded[raceIdx] = computeRaceExclusion(raceFinishes, fleetRaceFinishes) || forcedExcluded;

    // Additive scoring penalties (ZFP/SCP/DPI) apply to finishers in handicap
    // fleets too, capped at this race's DNF score.
    const penaltyCap = dnfScoreForRace(fleetRaceFinishes, competitors.length, dnfScoring);
    const finishMap = new Map(fleetRaceFinishes.map((f) => [f.competitorId as string, f]));

    for (const competitor of competitors) {
      if (rejectedIds.has(competitor.id)) continue; // excluded from scoring
      const score = scores.get(competitor.id);
      const rawPoints = score?.points ?? competitors.length + 1;
      const finish = finishMap.get(competitor.id);
      const isFinisher = score?.place != null;
      const points = isFinisher ? applyAdditivePenalty(rawPoints, finish, penaltyCap, fleet.id) : rawPoints;
      per.racePoints.get(competitor.id)!.push(raceExcluded[raceIdx] ? 0 : points);
      per.raceRanks.get(competitor.id)!.push(raceExcluded[raceIdx] ? null : (score?.rank ?? null));
      per.raceCodes.get(competitor.id)!.push(score !== undefined ? score.resultCode : 'DNC');
      per.racePenaltyCodes.get(competitor.id)!.push(isFinisher ? (finish?.penaltyCode ?? null) : null);
      per.racePenaltyOverrides.get(competitor.id)!.push(isFinisher ? (finish?.penaltyOverride ?? null) : null);
      per.raceRedressFlags.get(competitor.id)!.push(false);
    }
  }

  const { discardCount, redressDiscardAllowance } = computeDiscardCounts(
    raceExcluded,
    discardThresholds,
  );

  // Resolve RDG against the per-race points computed above, then they
  // participate in discards/totals normally. Rejected (unrated) competitors
  // are excluded from scoring entirely, RDG included.
  const circularRedressRaces = collectAndResolveRdg({
    races,
    finishesByRace,
    eligible: (competitorId) =>
      fleetCompetitorIds.has(competitorId) && !rejectedIds.has(competitorId),
    per,
    raceExcluded,
    fallbackPoints: competitors.length + 1,
    discardAllowance: redressDiscardAllowance,
    fleetId: fleet.id,
  });

  const standings = assembleStandings(ratedCompetitors, per, raceExcluded, discardCount);
  sortAndRank(standings);

  return {
    standings,
    rejections: allRejections,
    ...(isNhc ? { nhcRaceScoresByRaceId, nhcAggregatesByRaceId } : {}),
    ...(isEcho ? { echoRaceScoresByRaceId, echoAggregatesByRaceId } : {}),
    ...(isProgressive ? { tcfHistory } : {}),
    circularRedressRaces,
  };
}

/** One fleet's slice of a {@link calculateFleetStandings} result. */
export interface FleetStandingsEntry {
  fleet: Fleet;
  standings: Standing[];
  rejections: ScoringRejection[];
  nhcRaceScoresByRaceId?: Map<string, Map<string, HandicapRaceScore>>;
  nhcAggregatesByRaceId?: Map<string, NhcRaceAggregates>;
  echoRaceScoresByRaceId?: Map<string, Map<string, HandicapRaceScore>>;
  echoAggregatesByRaceId?: Map<string, EchoRaceAggregates>;
  tcfHistory?: TcfRecord[];
}

export interface FleetStandingsResult {
  fleetStandings: FleetStandingsEntry[];
  circularRedressRaces: number[];
}

/**
 * Detect per-fleet point gaps for one fleet: a multi-fleet boat that is in
 * per-fleet mode (has a populated `redressPointsByFleet` / `penaltyOverrideByFleet`
 * map) but has no entry for *this* fleet. Such a boat is still scored — RDG via
 * the A9(a) average, DPI with no penalty — but the scorer must be told a value
 * is missing, so each gap becomes a `ScoringRejection` surfaced on the fleet's
 * standings.
 *
 * DPI gaps are only flagged on finisher rows (a DPI on a non-finisher is never
 * applied). RDG gaps are flagged regardless, since redress applies to
 * finishers and non-finishers alike.
 */
function detectPerFleetGaps(
  fleet: Fleet,
  fleetCompetitors: Competitor[],
  allFinishes: Finish[],
): ScoringRejection[] {
  const ids = new Set(fleetCompetitors.map((c) => c.id));
  const out: ScoringRejection[] = [];
  for (const f of allFinishes) {
    if (f.competitorId === null || !ids.has(f.competitorId)) continue;
    const rdgByFleet = f.redressPointsByFleet;
    if (
      f.resultCode === 'RDG' &&
      f.redressMethod === 'stated' &&
      rdgByFleet &&
      Object.keys(rdgByFleet).length > 0 &&
      !Object.prototype.hasOwnProperty.call(rdgByFleet, fleet.id)
    ) {
      out.push({ competitorId: f.competitorId, reason: 'rdg_missing_fleet_points' });
    }
    const dpiByFleet = f.penaltyOverrideByFleet;
    if (
      f.penaltyCode === 'DPI' &&
      f.sortOrder !== null &&
      dpiByFleet &&
      Object.keys(dpiByFleet).length > 0 &&
      !Object.prototype.hasOwnProperty.call(dpiByFleet, fleet.id)
    ) {
      out.push({ competitorId: f.competitorId, reason: 'dpi_missing_fleet_points' });
    }
  }
  return out;
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
 * @param ratingOverrides  Per-race static-rating overrides
 * @param progressiveSeedTcfs  Per-fleet applied-TCF seeds (fleetId →
 *   competitorId → TCF) for scoring a block of races mid-chain; see
 *   calculateSubSeriesFleetStandings
 * @param excludedRaceIdsByFleet  Per-fleet race exclusions (fleetId → set of
 *   raceIds that don't count for that fleet). Used by sub-series scoring to
 *   strike a race for one fleet only; the race vanishes from that fleet's
 *   points, discards, race count, and chain. See calculateSubSeriesFleetStandings.
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
  progressiveSeedTcfs?: Map<string, Map<string, number>>,
  excludedRaceIdsByFleet?: Map<string, Set<string>>,
): FleetStandingsResult {
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
    // A race excluded for this fleet is struck like an abandoned heat: it stays
    // a column in the block (so the per-race arrays line up with the other
    // fleets) but scores 0, earns no discard credit, and — for progressive
    // fleets — does not advance the handicap chain. Other fleets still score it.
    const excluded = excludedRaceIdsByFleet?.get(fleet.id);
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
        progressiveSeedTcfs?.get(fleet.id),
        excluded,
      );
      allCircular.push(...circularRedressRaces);
      return { fleet, standings, rejections: [...rejections, ...detectPerFleetGaps(fleet, fleetCompetitors, allFinishes)], nhcRaceScoresByRaceId, nhcAggregatesByRaceId, echoRaceScoresByRaceId, echoAggregatesByRaceId, tcfHistory };
    }
    const { standings, circularRedressRaces } = calculateStandings(
      fleetCompetitors,
      races,
      allFinishes,
      discardThresholds,
      dnfScoring,
      fleet.id,
      excluded,
    );
    allCircular.push(...circularRedressRaces);
    return { fleet, standings, rejections: detectPerFleetGaps(fleet, fleetCompetitors, allFinishes) };
  });

  if (orphans.length > 0) {
    const unknownFleet: Fleet = { id: '__unknown__', seriesId: '', name: 'Unknown', displayOrder: 9999, scoringSystem: 'scratch' };
    const { standings, circularRedressRaces } = calculateStandings(orphans, races, allFinishes, discardThresholds, dnfScoring);
    allCircular.push(...circularRedressRaces);
    fleetStandings.push({ fleet: unknownFleet, standings, rejections: [] });
  }

  return { fleetStandings, circularRedressRaces: [...new Set(allCircular)].sort((a, b) => a - b) };
}

// ─── Sub-series ──────────────────────────────────────────────────────────────

/**
 * Competitors counted as entrants of a block of races: those with any
 * recorded result other than DNC in at least one of the races. A boat that
 * never came to the start area across an entire sub-series isn't an entrant
 * in it — it is left out of that block's standings and out of the entry
 * count its DNC/DNS penalty scores are based on.
 */
export function subSeriesEntrantIds(blockRaces: Race[], allFinishes: Finish[]): Set<string> {
  const raceIds = new Set(blockRaces.map((r) => r.id));
  const entrants = new Set<string>();
  for (const f of allFinishes) {
    if (f.competitorId === null || !raceIds.has(f.raceId)) continue;
    // Any finish row that isn't an explicit DNC is participation — a
    // position-based finish, a timed finish, or a coded result (DNS, DNF,
    // RDG, …) all mean the boat took part in the block.
    if (f.resultCode !== 'DNC') entrants.add(f.competitorId);
  }
  return entrants;
}

/**
 * Resolve each sub-series' selected races (its `raceIds` membership), sorted by
 * raceNumber. Sub-series are returned in displayOrder. A sub-series may select
 * any subset of the series' races and selections may overlap.
 */
export function groupRacesBySubSeries(
  subSeriesList: SubSeries[],
  races: Race[],
): { subSeries: SubSeries; races: Race[] }[] {
  const byId = new Map(races.map((r) => [r.id, r]));
  return [...subSeriesList]
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((subSeries) => ({
      subSeries,
      races: subSeries.raceIds
        .map((id) => byId.get(id))
        .filter((r): r is Race => r !== undefined)
        .sort((a, b) => a.raceNumber - b.raceNumber),
    }));
}

/**
 * Order sub-series so any `continue`-from source is computed before the
 * sub-series that continues it. Falls back to displayOrder and tolerates
 * cycles (a cyclic edge is simply ignored, the dependent seeding from base).
 */
function orderSubSeriesForComputation(subSeriesList: SubSeries[]): SubSeries[] {
  const byId = new Map(subSeriesList.map((s) => [s.id, s]));
  const done = new Set<string>();
  const out: SubSeries[] = [];
  const visit = (s: SubSeries, stack: Set<string>): void => {
    if (done.has(s.id) || stack.has(s.id)) return;
    stack.add(s.id);
    const depId = s.startingHandicapSource === 'continue' ? s.continueFromSubSeriesId : null;
    const dep = depId ? byId.get(depId) : undefined;
    if (dep) visit(dep, stack);
    stack.delete(s.id);
    done.add(s.id);
    out.push(s);
  };
  for (const s of [...subSeriesList].sort((a, b) => a.displayOrder - b.displayOrder)) {
    visit(s, new Set());
  }
  return out;
}

/** Standings for one sub-series: the block's races scored independently. */
export interface SubSeriesStandings {
  subSeries: SubSeries;
  /** The block's races, sorted by raceNumber. */
  races: Race[];
  fleetStandings: FleetStandingsEntry[];
  circularRedressRaces: number[];
}

/**
 * Calculate standings for every sub-series of a series, every fleet within
 * every block.
 *
 * Each sub-series is scored independently over its selected races: its own
 * discards (the series-level thresholds applied to the selection's race count),
 * tie-breaks, and RDG pools, over the selection's entrants (see
 * {@link subSeriesEntrantIds}).
 *
 * Progressive (NHC/ECHO) ratings are computed independently per sub-series over
 * its own races — a boat racing a different fleet on a different day genuinely
 * earns a different handicap. Continuity is explicit: a sub-series whose
 * `startingHandicapSource` is 'continue' seeds its chain from the end-of-chain
 * ratings of `continueFromSubSeriesId` (computed first), which is arithmetically
 * identical to one chain spanning both. See the handicap-scoring design doc,
 * "Shared progressive chain across overlapping series".
 *
 * A sub-series may be **fleet-scoped** (`fleetIds`): only those fleets are
 * scored and get a published page (absent means all the series' fleets). It may
 * also carry **per-fleet race exclusions** (`raceFleetExclusions`): a member
 * race that doesn't count for one fleet — struck for that fleet's points,
 * discards, race count, and chain, while still scoring for the others.
 */
export function calculateSubSeriesFleetStandings(
  subSeriesList: SubSeries[],
  fleets: Fleet[],
  competitors: Competitor[],
  races: Race[],
  allFinishes: Finish[],
  discardThresholds: DiscardThreshold[] = [],
  dnfScoring: DnfScoring = 'seriesEntries',
  raceStarts: RaceStart[] = [],
  ratingOverrides: RaceRatingOverride[] = [],
): SubSeriesStandings[] {
  const racesById = new Map(races.map((r) => [r.id, r]));
  const memberRaces = (ss: SubSeries): Race[] =>
    ss.raceIds
      .map((id) => racesById.get(id))
      .filter((r): r is Race => r !== undefined)
      .sort((a, b) => a.raceNumber - b.raceNumber);

  // End-of-chain applied ratings of each computed sub-series, for 'continue'
  // dependents: subSeriesId → fleetId → competitorId → TCF.
  const endTcfBySubSeries = new Map<string, Map<string, Map<string, number>>>();
  const resultBySubSeriesId = new Map<string, SubSeriesStandings>();

  for (const subSeries of orderSubSeriesForComputation(subSeriesList)) {
    const blockRaces = memberRaces(subSeries);
    const blockRaceIds = new Set(blockRaces.map((r) => r.id));
    const blockFinishes = allFinishes.filter((f) => blockRaceIds.has(f.raceId));

    // Fleet-scoping: absent fleetIds means every fleet (the common case). When
    // scoped, only the named fleets are scored, and entrants outside them are
    // dropped so they don't fall through to the "Unknown" fleet bucket.
    const scopedFleetIds = subSeries.fleetIds ? new Set(subSeries.fleetIds) : null;
    const blockFleets = scopedFleetIds ? fleets.filter((f) => scopedFleetIds.has(f.id)) : fleets;

    const entrantIds = subSeriesEntrantIds(blockRaces, blockFinishes);
    const entrants = competitors.filter(
      (c) =>
        entrantIds.has(c.id) &&
        (scopedFleetIds === null || c.fleetIds.some((fid) => scopedFleetIds.has(fid))),
    );

    // Per-fleet race exclusions → fleetId → set of struck raceIds.
    const excludedByFleet = new Map<string, Set<string>>();
    for (const ex of subSeries.raceFleetExclusions ?? []) {
      const set = excludedByFleet.get(ex.fleetId) ?? new Set<string>();
      set.add(ex.raceId);
      excludedByFleet.set(ex.fleetId, set);
    }

    const seedTcfs =
      subSeries.startingHandicapSource === 'continue' && subSeries.continueFromSubSeriesId
        ? endTcfBySubSeries.get(subSeries.continueFromSubSeriesId)
        : undefined;

    const { fleetStandings, circularRedressRaces } = calculateFleetStandings(
      blockFleets,
      entrants,
      blockRaces,
      blockFinishes,
      discardThresholds,
      dnfScoring,
      raceStarts,
      ratingOverrides,
      seedTcfs,
      excludedByFleet.size > 0 ? excludedByFleet : undefined,
    );

    const endByFleet = new Map<string, Map<string, number>>();
    for (const entry of fleetStandings) {
      if (!entry.tcfHistory || entry.tcfHistory.length === 0) continue;
      const ratings = new Map<string, number>();
      // History records are in race order, so the last write per competitor
      // leaves its end-of-chain rating.
      for (const record of entry.tcfHistory) ratings.set(record.competitorId, record.newTcf);
      endByFleet.set(entry.fleet.id, ratings);
    }
    endTcfBySubSeries.set(subSeries.id, endByFleet);

    resultBySubSeriesId.set(subSeries.id, {
      subSeries,
      races: blockRaces,
      fleetStandings,
      circularRedressRaces,
    });
  }

  // Return in display order regardless of the computation order above.
  return groupRacesBySubSeries(subSeriesList, races).map(
    (g) => resultBySubSeriesId.get(g.subSeries.id)!,
  );
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
