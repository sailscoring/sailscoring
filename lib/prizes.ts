/**
 * Prize allocation (#240): the deterministic core. A prize names an award, an
 * eligibility predicate (AND of typed clauses over fleet / subdivision-axis
 * value / series rank) and a recipient count; allocation filters the series
 * standings by the predicate, keeps standings order, and takes the top N.
 * Pure — callers pass the already-computed per-fleet standings.
 */

import type {
  Fleet,
  Prize,
  PrizeClause,
  Standing,
  SubdivisionAxis,
} from './types';

export const PRIZE_NAME_MAX_LENGTH = 80;
/** Award positions per prize are small by nature (a podium, not a leaderboard). */
export const PRIZE_RECIPIENT_COUNT_MAX = 20;
export const PRIZE_CLAUSES_MAX = 6;

/** The slice of the scoring engine's FleetStandingsResult that allocation
 *  reads: each fleet's ranked standings, in fleet display order. */
export interface PrizeStandingsInput {
  fleet: Fleet;
  standings: Standing[];
}

export interface PrizeRecipient {
  /** 1-based award position within the prize (1st, 2nd, …). */
  position: number;
  standing: Standing;
  /** The fleet whose standings ranked this recipient. */
  fleet: Fleet;
}

/** A non-fatal condition the Prizes UI should surface next to the prize.
 *  Allocation still returns its best deterministic answer alongside these. */
export type PrizeAllocationWarning =
  /** A clause references a subdivision axis the series doesn't have. */
  | { kind: 'unknown-axis'; axisId: string }
  /** A clause references an axis for which no scored competitor carries any
   *  value at all — the predicate can never match ("field has no data"). */
  | { kind: 'axis-no-data'; axisId: string; axisLabel: string }
  /** A clause references an intrinsic competitor field (gender / nationality /
   *  club) no scored competitor has a value for — the same "field has no
   *  data" condition as an empty axis. */
  | { kind: 'field-no-data'; field: 'gender' | 'nationality' | 'club' }
  /** A clause references a fleet that no longer exists. */
  | { kind: 'unknown-fleet'; fleetId: string }
  /** Fewer eligible competitors than the prize wants recipients. */
  | { kind: 'short'; eligible: number; requested: number }
  /** No fleet clause and the eligible set spans more than one fleet, so
   *  within-fleet ranks are being compared across fleets. */
  | { kind: 'spans-fleets'; fleetNames: string[] }
  /** The last awarded place is an unbroken tie with the first non-awarded
   *  competitor — the cut between them is arbitrary. */
  | { kind: 'tie-at-cut'; rank: number };

export interface PrizeAllocation {
  prize: Prize;
  recipients: PrizeRecipient[];
  /** Competitors matching the predicate, before the top-N cut. */
  eligibleCount: number;
  warnings: PrizeAllocationWarning[];
}

function clauseMatches(
  clause: PrizeClause,
  standing: Standing,
  fleet: Fleet,
): boolean {
  const competitor = standing.competitor;
  switch (clause.kind) {
    case 'fleet':
      return fleet.id === clause.fleetId;
    case 'axis': {
      const value = competitor.subdivisions?.[clause.axisId];
      return value != null && value.trim() === clause.value.trim();
    }
    case 'rank':
      return standing.rank <= clause.max;
    case 'gender':
      return competitor.gender === clause.value;
    case 'nationality':
      // National-letters codes are uppercase by convention; compare
      // case-insensitively so a hand-typed "irl" still matches.
      return (competitor.nationality ?? '').trim().toUpperCase() === clause.value.trim().toUpperCase();
    case 'club':
      return competitor.club.trim() === clause.value.trim();
  }
}

/** The competitor field an intrinsic clause reads, for the no-data check. */
function intrinsicValue(
  field: 'gender' | 'nationality' | 'club',
  standing: Standing,
): string {
  const c = standing.competitor;
  return (field === 'gender' ? c.gender : field === 'nationality' ? c.nationality ?? '' : c.club).trim();
}

/** Allocate one prize against the standings. Eligible rows keep standings
 *  order — by fleet display order, then rank order within the fleet — and the
 *  top `recipientCount` become the recipients. A competitor scored in several
 *  fleets is counted once, at their best (lowest-rank) eligible row. */
export function allocatePrize(
  prize: Prize,
  fleetStandings: PrizeStandingsInput[],
  axes: SubdivisionAxis[],
): PrizeAllocation {
  const warnings: PrizeAllocationWarning[] = [];
  const axisById = new Map(axes.map((a) => [a.id, a]));
  const fleetIds = new Set(fleetStandings.map((fs) => fs.fleet.id));

  for (const clause of prize.clauses) {
    if (clause.kind === 'axis') {
      const axis = axisById.get(clause.axisId);
      if (!axis) {
        warnings.push({ kind: 'unknown-axis', axisId: clause.axisId });
        continue;
      }
      const anyValue = fleetStandings.some((fs) =>
        fs.standings.some((s) =>
          s.competitor.subdivisions?.[clause.axisId]?.trim(),
        ),
      );
      if (!anyValue) {
        warnings.push({
          kind: 'axis-no-data',
          axisId: clause.axisId,
          axisLabel: axis.label,
        });
      }
    } else if (clause.kind === 'fleet' && !fleetIds.has(clause.fleetId)) {
      warnings.push({ kind: 'unknown-fleet', fleetId: clause.fleetId });
    } else if (
      clause.kind === 'gender' ||
      clause.kind === 'nationality' ||
      clause.kind === 'club'
    ) {
      const anyValue = fleetStandings.some((fs) =>
        fs.standings.some((s) => intrinsicValue(clause.kind, s) !== ''),
      );
      if (!anyValue) warnings.push({ kind: 'field-no-data', field: clause.kind });
    }
  }

  // Collect eligible rows in standings order; dedupe multi-fleet competitors
  // onto their best (lowest-rank) eligible row.
  const bestByCompetitor = new Map<
    string,
    { standing: Standing; fleet: Fleet; fleetIndex: number; row: number }
  >();
  fleetStandings.forEach((fs, fleetIndex) => {
    fs.standings.forEach((standing, row) => {
      if (!prize.clauses.every((c) => clauseMatches(c, standing, fs.fleet))) return;
      const prev = bestByCompetitor.get(standing.competitor.id);
      if (!prev || standing.rank < prev.standing.rank) {
        bestByCompetitor.set(standing.competitor.id, {
          standing,
          fleet: fs.fleet,
          fleetIndex,
          row,
        });
      }
    });
  });

  const eligible = [...bestByCompetitor.values()].sort(
    (a, b) =>
      a.standing.rank - b.standing.rank ||
      a.fleetIndex - b.fleetIndex ||
      a.row - b.row,
  );

  const hasFleetClause = prize.clauses.some((c) => c.kind === 'fleet');
  const eligibleFleets = [...new Set(eligible.map((e) => e.fleet.name))];
  if (!hasFleetClause && eligibleFleets.length > 1) {
    warnings.push({ kind: 'spans-fleets', fleetNames: eligibleFleets });
  }

  const count = Math.max(0, prize.recipientCount);
  const recipients = eligible.slice(0, count).map((e, i) => ({
    position: i + 1,
    standing: e.standing,
    fleet: e.fleet,
  }));

  if (eligible.length < count) {
    warnings.push({ kind: 'short', eligible: eligible.length, requested: count });
  }

  // An unbreakable tie (shared rank, same fleet) straddling the cut means the
  // top-N choice between the tied boats is arbitrary — tell the scorer.
  const last = eligible[count - 1];
  const next = eligible[count];
  if (
    last &&
    next &&
    last.fleet.id === next.fleet.id &&
    last.standing.rank === next.standing.rank
  ) {
    warnings.push({ kind: 'tie-at-cut', rank: last.standing.rank });
  }

  return { prize, recipients, eligibleCount: eligible.length, warnings };
}

/** Allocate every prize, in prize-list order. */
export function allocatePrizes(
  prizes: Prize[],
  fleetStandings: PrizeStandingsInput[],
  axes: SubdivisionAxis[],
): PrizeAllocation[] {
  return prizes.map((p) => allocatePrize(p, fleetStandings, axes));
}

/** 1 → "1st", 2 → "2nd", 3 → "3rd", 4 → "4th", 11 → "11th", 22 → "22nd". */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/** Human-readable eligibility summary, e.g. "Division is Gold · Fleet is
 *  ILCA 6". Shared by the Prizes tab and the published prize sheet. */
export function describePrizeClauses(
  clauses: PrizeClause[],
  fleets: Pick<Fleet, 'id' | 'name'>[],
  axes: SubdivisionAxis[],
): string {
  if (clauses.length === 0) return 'All competitors';
  const fleetName = new Map(fleets.map((f) => [f.id, f.name]));
  const axisLabel = new Map(axes.map((a) => [a.id, a.label]));
  return clauses
    .map((c) => {
      switch (c.kind) {
        case 'fleet':
          return `Fleet is ${fleetName.get(c.fleetId) ?? 'a deleted fleet'}`;
        case 'axis':
          return `${axisLabel.get(c.axisId) ?? 'A removed axis'} is ${c.value}`;
        case 'rank':
          return `Series rank ${c.max === 1 ? 'is 1' : `≤ ${c.max}`}`;
        case 'gender':
          return `Helm is ${c.value === 'F' ? 'female' : 'male'}`;
        case 'nationality':
          return `Nationality is ${c.value.toUpperCase()}`;
        case 'club':
          return `Club is ${c.value}`;
      }
    })
    .join(' · ');
}

/** Human-readable message for a warning (shared by the Prizes tab and the
 *  published prize sheet's authoring preview). */
export function prizeWarningMessage(w: PrizeAllocationWarning): string {
  switch (w.kind) {
    case 'unknown-axis':
      return 'A condition references a subdivision axis that no longer exists on this series.';
    case 'axis-no-data':
      return `No competitor has a ${w.axisLabel} value, so this condition can never match.`;
    case 'field-no-data':
      return `No competitor has a ${w.field} value, so this condition can never match.`;
    case 'unknown-fleet':
      return 'A condition references a fleet that no longer exists on this series.';
    case 'short':
      return `Only ${w.eligible} of ${w.requested} places can be awarded — not enough eligible competitors.`;
    case 'spans-fleets':
      return `Eligible competitors span more than one fleet (${w.fleetNames.join(', ')}), so ranks from different fleets are being compared. Add a fleet condition to rank within one fleet.`;
    case 'tie-at-cut':
      return `The last awarded place is an unbroken tie at rank ${w.rank} — the boats either side of the cut are tied.`;
  }
}
