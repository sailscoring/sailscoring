/**
 * Prize allocation (#240): the deterministic core. A prize names an award, an
 * eligibility predicate (AND of typed clauses over fleet / subdivision-axis
 * value / series rank) and a recipient count; allocation filters the series
 * standings by the predicate, keeps standings order, and takes the top N.
 * A `not-awarded` clause makes one prize depend on others: those are awarded
 * first, and the boats they placed are skipped here.
 * Pure — callers pass the already-computed per-fleet standings.
 */

import { cleanClubs, isClubMember } from './competitor-fields';
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

/** The places each prize has awarded: prize id → competitor id → 1-based
 *  place. What a `not-awarded` clause reads. */
export type AwardedPlaces = Map<string, Map<string, number>>;

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
  | { kind: 'tie-at-cut'; rank: number }
  /** A `not-awarded` clause names a prize the series no longer has — the
   *  condition can never be checked, so it matches nobody. */
  | { kind: 'unknown-prize' }
  /** This prize waits on another prize that, in turn, waits on it, so
   *  neither can be awarded first. Every prize on the loop awards nobody;
   *  `prizeNames` are the others on it (empty when a prize names itself). */
  | { kind: 'prize-loop'; prizeNames: string[] };

/** A boat that would have taken a place in this prize but already holds
 *  `place` in the prize `prizeId`, which a `not-awarded` clause excludes —
 *  the places below it moved up. Shown so the scorer can check the call. */
export interface PrizeSkip {
  standing: Standing;
  fleet: Fleet;
  prizeId: string;
  place: number;
}

export interface PrizeAllocation {
  prize: Prize;
  recipients: PrizeRecipient[];
  /** Competitors matching the predicate, before the top-N cut. */
  eligibleCount: number;
  /** Boats skipped because they already hold a place in a prize this one
   *  excludes, in standings order. Only those that would otherwise have
   *  been awarded a place here. */
  skipped: PrizeSkip[];
  warnings: PrizeAllocationWarning[];
}

/** What a prize's `not-awarded` clauses read: the places awarded so far, the
 *  prizes listed above this one (in list order), and every prize id the
 *  series has. Allocating a prize on its own passes none of these. */
export interface PrizeAllocationContext {
  awarded: AwardedPlaces;
  above: string[];
  known: Set<string>;
}

const NO_CONTEXT: PrizeAllocationContext = { awarded: new Map(), above: [], known: new Set() };

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
      // Membership, not equality: an entry affiliated to a home club and a
      // visiting one is a member of both, and either can carry the prize.
      return isClubMember(competitor.clubs, clause.value);
    case 'not-awarded':
      // Decided per boat, once the standings rows are merged — see
      // `priorPlace`. Here it only rules everyone out when its prize is gone.
      return true;
  }
}

/** The place a boat already holds that one of the prize's `not-awarded`
 *  clauses excludes it for, or null when none does. A named prize is
 *  checked alone; a clause with no prize checks every prize above, in list
 *  order, and reports the first. */
function priorPlace(
  clauses: PrizeClause[],
  competitorId: string,
  context: PrizeAllocationContext,
): { prizeId: string; place: number } | null {
  for (const clause of clauses) {
    if (clause.kind !== 'not-awarded') continue;
    const prizeIds = clause.prizeId != null ? [clause.prizeId] : context.above;
    for (const prizeId of prizeIds) {
      const place = context.awarded.get(prizeId)?.get(competitorId);
      if (place != null && (clause.places == null || place <= clause.places)) {
        return { prizeId, place };
      }
    }
  }
  return null;
}

/** Whether a competitor states anything at all for an intrinsic field, for
 *  the no-data check. */
function hasIntrinsicValue(
  field: 'gender' | 'nationality' | 'club',
  standing: Standing,
): boolean {
  const c = standing.competitor;
  if (field === 'club') return cleanClubs(c.clubs).length > 0;
  return (field === 'gender' ? c.gender : c.nationality ?? '').trim() !== '';
}

/** Allocate one prize against the standings. Eligible rows keep standings
 *  order — by fleet display order, then rank order within the fleet — and the
 *  top `recipientCount` become the recipients. A competitor scored in several
 *  fleets is counted once, at their best (lowest-rank) eligible row. A boat a
 *  `not-awarded` clause excludes is passed over and the places move down;
 *  `context` carries what those clauses read (see {@link allocatePrizes}). */
export function allocatePrize(
  prize: Prize,
  fleetStandings: PrizeStandingsInput[],
  axes: SubdivisionAxis[],
  context: PrizeAllocationContext = NO_CONTEXT,
): PrizeAllocation {
  const warnings: PrizeAllocationWarning[] = [];
  // A condition on a prize the series no longer has can't be checked. Like a
  // condition on a deleted fleet it matches nobody — dropping it would hand
  // the prize to a boat the NoR rules out.
  const unknownPrize = prize.clauses.some(
    (c) => c.kind === 'not-awarded' && c.prizeId != null && !context.known.has(c.prizeId),
  );
  if (unknownPrize) warnings.push({ kind: 'unknown-prize' });
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
        fs.standings.some((s) => hasIntrinsicValue(clause.kind, s)),
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
      if (unknownPrize) return;
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

  const candidates = [...bestByCompetitor.values()].sort(
    (a, b) =>
      a.standing.rank - b.standing.rank ||
      a.fleetIndex - b.fleetIndex ||
      a.row - b.row,
  );

  const count = Math.max(0, prize.recipientCount);

  // Pass over boats already placed in a prize this one excludes. A skip is
  // worth reporting only while places remain: past the cut the boat would
  // not have been awarded anyway.
  const eligible: typeof candidates = [];
  const skipped: PrizeSkip[] = [];
  for (const candidate of candidates) {
    const prior = priorPlace(prize.clauses, candidate.standing.competitor.id, context);
    if (prior == null) {
      eligible.push(candidate);
    } else if (eligible.length < count) {
      skipped.push({ standing: candidate.standing, fleet: candidate.fleet, ...prior });
    }
  }

  const hasFleetClause = prize.clauses.some((c) => c.kind === 'fleet');
  const eligibleFleets = [...new Set(eligible.map((e) => e.fleet.name))];
  if (!hasFleetClause && eligibleFleets.length > 1) {
    warnings.push({ kind: 'spans-fleets', fleetNames: eligibleFleets });
  }

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

  return { prize, recipients, eligibleCount: eligible.length, skipped, warnings };
}

/** The prizes left once `dropped` are gone — and with them every prize
 *  whose `not-awarded` condition names a prize that is gone, or one the list
 *  never had. Keeping such a prize without the condition would widen it to
 *  boats the NoR rules out, so it goes too (the scorer re-adds it). For the
 *  importers, which already drop a prize whose fleet they can't resolve. */
export function withoutPrizes(prizes: Prize[], dropped: Set<string>): Prize[] {
  let kept = prizes.filter((p) => !dropped.has(p.id));
  for (;;) {
    const ids = new Set(kept.map((p) => p.id));
    const next = kept.filter((p) =>
      p.clauses.every((c) => c.kind !== 'not-awarded' || c.prizeId == null || ids.has(c.prizeId)),
    );
    if (next.length === kept.length) return kept;
    kept = next;
  }
}

/** The prizes each prize waits on: the one a `not-awarded` clause names, or
 *  every prize above it for a clause that names none. Ids the list doesn't
 *  have are left out — the allocator warns about those on its own. */
function prizeDependencies(prizes: Prize[]): Map<string, Set<string>> {
  const known = new Set(prizes.map((p) => p.id));
  return new Map(
    prizes.map((prize, index) => {
      const deps = new Set<string>();
      for (const c of prize.clauses) {
        if (c.kind !== 'not-awarded') continue;
        if (c.prizeId == null) {
          for (const above of prizes.slice(0, index)) deps.add(above.id);
        } else if (known.has(c.prizeId)) {
          deps.add(c.prizeId);
        }
      }
      return [prize.id, deps];
    }),
  );
}

/** For each prize on a loop of `not-awarded` dependencies, the other prizes
 *  on that loop (empty when a prize names itself). A prize that merely waits
 *  on a loop is not on it. Exported for the Prizes tab, which refuses an
 *  edit or a move that would create one. */
export function prizeLoops(prizes: Prize[]): Map<string, string[]> {
  const deps = prizeDependencies(prizes);
  const reach = new Map<string, Set<string>>();
  for (const prize of prizes) {
    const seen = new Set<string>();
    const stack = [...(deps.get(prize.id) ?? [])];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(deps.get(id) ?? []));
    }
    reach.set(prize.id, seen);
  }
  const loops = new Map<string, string[]>();
  for (const prize of prizes) {
    if (!reach.get(prize.id)!.has(prize.id)) continue;
    loops.set(
      prize.id,
      prizes
        .filter((other) => other.id !== prize.id)
        .filter((other) => reach.get(prize.id)!.has(other.id) && reach.get(other.id)!.has(prize.id))
        .map((other) => other.id),
    );
  }
  return loops;
}

/** Allocate every prize; the result is in prize-list order. A prize is
 *  awarded only after the prizes its `not-awarded` clauses wait on, so the
 *  list can be ordered for the prize-giving without changing who wins what.
 *  Among prizes ready together, list order decides. Prizes on a loop award
 *  nobody, with a warning — any order would hand one of them a boat the
 *  other excludes. */
export function allocatePrizes(
  prizes: Prize[],
  fleetStandings: PrizeStandingsInput[],
  axes: SubdivisionAxis[],
): PrizeAllocation[] {
  const deps = prizeDependencies(prizes);
  const loops = prizeLoops(prizes);
  const known = new Set(prizes.map((p) => p.id));
  const nameById = new Map(prizes.map((p) => [p.id, p.name]));
  const awarded: AwardedPlaces = new Map();
  const done = new Map<string, PrizeAllocation>();

  for (const prize of prizes) {
    const others = loops.get(prize.id);
    if (others == null) continue;
    done.set(prize.id, {
      prize,
      recipients: [],
      eligibleCount: 0,
      skipped: [],
      warnings: [{ kind: 'prize-loop', prizeNames: others.map((id) => nameById.get(id) ?? '') }],
    });
    awarded.set(prize.id, new Map());
  }

  // Every prize left either is ready now or waits on one that will be: the
  // loops are already settled, so each pass awards at least one prize.
  while (done.size < prizes.length) {
    const ready = prizes.filter(
      (p) => !done.has(p.id) && [...deps.get(p.id)!].every((d) => done.has(d)),
    );
    if (ready.length === 0) break;
    for (const prize of ready) {
      const index = prizes.indexOf(prize);
      const allocation = allocatePrize(prize, fleetStandings, axes, {
        awarded,
        above: prizes.slice(0, index).map((p) => p.id),
        known,
      });
      done.set(prize.id, allocation);
      awarded.set(
        prize.id,
        new Map(allocation.recipients.map((r) => [r.standing.competitor.id, r.position])),
      );
    }
  }

  return prizes.map((p) => done.get(p.id)!);
}

/** Human-readable eligibility summary, e.g. "Division is Gold · Fleet is
 *  ILCA 6". Shared by the Prizes tab and the published prize sheet. `prizes`
 *  names the prizes a `not-awarded` clause refers to. */
export function describePrizeClauses(
  clauses: PrizeClause[],
  fleets: Pick<Fleet, 'id' | 'name'>[],
  axes: SubdivisionAxis[],
  prizes: Pick<Prize, 'id' | 'name'>[] = [],
): string {
  if (clauses.length === 0) return 'All competitors';
  const fleetName = new Map(fleets.map((f) => [f.id, f.name]));
  const axisLabel = new Map(axes.map((a) => [a.id, a.label]));
  const prizeName = new Map(prizes.map((p) => [p.id, p.name]));
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
        case 'not-awarded': {
          const of = c.prizeId == null
            ? 'a prize above'
            : prizeName.get(c.prizeId) ?? 'a deleted prize';
          if (c.places == null) return `Not a prize-winner in ${of}`;
          if (c.places === 1) return `Not the winner of ${of}`;
          return `Not in the top ${c.places} of ${of}`;
        }
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
    case 'unknown-prize':
      return 'A condition references a prize that no longer exists on this series, so this prize can’t be awarded.';
    case 'prize-loop':
      return w.prizeNames.length === 0
        ? 'A condition excludes this prize’s own winners, so it can’t be awarded.'
        : `This prize and ${w.prizeNames.join(', ')} each wait for the other’s winners, so neither can be awarded first. Change a condition to break the loop.`;
  }
}
