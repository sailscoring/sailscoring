import type { Competitor, Finish, PenaltyCode, ResultCode } from './types';

/** Build a fresh, fully-defaulted Finish row with the supplied overrides. */
export function makeFinish(
  raceId: string,
  overrides: Partial<Finish> & Pick<Finish, 'id'>,
): Finish {
  return {
    id: overrides.id,
    raceId,
    competitorId: overrides.competitorId ?? null,
    ...(overrides.unknownSailNumber != null ? { unknownSailNumber: overrides.unknownSailNumber } : {}),
    sortOrder: overrides.sortOrder ?? null,
    tiedWithPrevious: overrides.tiedWithPrevious ?? false,
    ...(overrides.finishTime != null ? { finishTime: overrides.finishTime } : {}),
    resultCode: overrides.resultCode ?? null,
    startPresent: overrides.startPresent ?? null,
    penaltyCode: overrides.penaltyCode ?? null,
    penaltyOverride: overrides.penaltyOverride ?? null,
    ...(overrides.penaltyOverrideByFleet != null ? { penaltyOverrideByFleet: overrides.penaltyOverrideByFleet } : {}),
    redressMethod: overrides.redressMethod ?? null,
    redressExcludeRaceIds: overrides.redressExcludeRaceIds ?? null,
    redressIncludeRaceIds: overrides.redressIncludeRaceIds ?? null,
    redressIncludeAllLater: overrides.redressIncludeAllLater ?? false,
    redressPoints: overrides.redressPoints ?? null,
    ...(overrides.redressPointsByFleet != null ? { redressPointsByFleet: overrides.redressPointsByFleet } : {}),
    ...(overrides.version != null ? { version: overrides.version } : {}),
  };
}

/**
 * Computes the displayed finish position for each competitor in the ordering,
 * accounting for ties. Boats in tiedWithPrevious share the position of the
 * competitor immediately before them; subsequent positions skip numbers to fill
 * the tied slots.
 *
 * Example: order=[A, B, C, D], tiedWithPrevious={C} → [1, 2, 2, 4]
 *
 * @param order - Finishing order (array of competitor IDs)
 * @param tiedWithPrevious - IDs of boats tied with the boat immediately before them
 * @returns 1-based finish positions, parallel to order
 */
export function computePositions(order: string[], tiedWithPrevious: Set<string>): number[] {
  const positions: number[] = [];
  let nextPos = 1;
  for (let i = 0; i < order.length; i++) {
    if (i > 0 && tiedWithPrevious.has(order[i])) {
      positions.push(positions[i - 1]);
    } else {
      positions.push(nextPos);
    }
    nextPos++;
  }
  return positions;
}

/**
 * One row in the visible finishing-order list. Mirrors the row model the
 * autosave finish-entry page renders. Unknown rows use the underlying
 * Finish row's `id` as their entry-key — no separate `tempId` is needed
 * once savedFinishes is the source of truth.
 */
export type FinishEntry =
  | { kind: 'known'; competitorId: string; finishId: string; version?: number }
  | { kind: 'unknown'; finishId: string; version?: number; sailNumber: string };

export function entryKey(e: FinishEntry): string {
  return e.kind === 'known' ? e.competitorId : e.finishId;
}

/** Redress configuration carried alongside a competitor's Finish row.
 *  For the `stated` method the points may be a single uniform value
 *  (`statedPoints`) or differ per fleet (`statedPointsByFleet`, keyed by
 *  fleetId) for a boat scored in more than one fleet. */
export interface RedressEntry {
  method: 'all_races' | 'races_before' | 'stated';
  poolMode: 'none' | 'exclude' | 'include';
  excludeRaceIds: string[];
  includeRaceIds: string[];
  includeAllLater: boolean;
  statedPoints: number | null;
  statedPointsByFleet: Record<string, number> | null;
}

/**
 * Pure derivation of every "view model" the finish-entry page renders,
 * from the canonical Finish[] returned by `useFinishesByRace` (ADR-008
 * Phase 6). Replaces the page's prior model of duplicating this data into
 * useState collections + a Save button.
 *
 * Returned maps are keyed by `competitorId` (or by `entryKey` for ties +
 * finishTimes, which need to address unknown rows too). Per-finish row
 * metadata (id, version) is exposed via `finishByEntryKey` so per-row
 * mutations can thread `expectedVersion` cleanly.
 *
 * Display order is sortOrder ASC — sortOrders are guaranteed distinct
 * per race by the autosave write paths, so the order is stable. Ties
 * are read from `Finish.tiedWithPrevious`, not from sortOrder equality.
 */
export function deriveFinishState(savedFinishes: Finish[]): {
  finishingOrder: FinishEntry[];
  nonFinisherCodes: Map<string, ResultCode>;
  finishTimes: Map<string, string>;
  tiedWithPrevious: Set<string>;
  finisherPenalties: Map<string, { code: PenaltyCode; override: number | null; overrideByFleet: Record<string, number> | null }>;
  redressEntries: Map<string, RedressEntry>;
  finishByEntryKey: Map<string, Finish>;
  finishByCompetitorId: Map<string, Finish>;
} {
  const positionedFinishes = savedFinishes
    .filter((f) => f.sortOrder !== null)
    .sort((a, b) => a.sortOrder! - b.sortOrder!);

  const finishingOrder: FinishEntry[] = positionedFinishes.map((f) =>
    f.competitorId !== null
      ? { kind: 'known', competitorId: f.competitorId, finishId: f.id, version: f.version }
      : { kind: 'unknown', finishId: f.id, version: f.version, sailNumber: f.unknownSailNumber ?? '' },
  );

  const finishedIds = new Set(
    finishingOrder.flatMap((e) => (e.kind === 'known' ? [e.competitorId] : [])),
  );

  const nonFinisherCodes = new Map<string, ResultCode>();
  for (const finish of savedFinishes) {
    if (
      finish.sortOrder === null &&
      finish.resultCode &&
      finish.competitorId &&
      !finishedIds.has(finish.competitorId)
    ) {
      nonFinisherCodes.set(finish.competitorId, finish.resultCode);
    }
  }

  const finisherPenalties = new Map<string, { code: PenaltyCode; override: number | null; overrideByFleet: Record<string, number> | null }>();
  for (const finish of savedFinishes) {
    if (finish.penaltyCode && finish.competitorId && finishedIds.has(finish.competitorId)) {
      finisherPenalties.set(finish.competitorId, {
        code: finish.penaltyCode,
        override: finish.penaltyOverride ?? null,
        overrideByFleet: finish.penaltyOverrideByFleet ?? null,
      });
    }
  }

  const redressEntries = new Map<string, RedressEntry>();
  for (const finish of savedFinishes) {
    if (finish.resultCode === 'RDG' && finish.competitorId && finish.redressMethod) {
      const hasExclude = (finish.redressExcludeRaceIds?.length ?? 0) > 0;
      const hasInclude =
        (finish.redressIncludeRaceIds?.length ?? 0) > 0 || finish.redressIncludeAllLater;
      redressEntries.set(finish.competitorId, {
        method: finish.redressMethod as RedressEntry['method'],
        poolMode: hasExclude ? 'exclude' : hasInclude ? 'include' : 'none',
        excludeRaceIds: finish.redressExcludeRaceIds ?? [],
        includeRaceIds: finish.redressIncludeRaceIds ?? [],
        includeAllLater: finish.redressIncludeAllLater ?? false,
        statedPoints: finish.redressPoints ?? null,
        statedPointsByFleet: finish.redressPointsByFleet ?? null,
      });
    }
  }

  const finishTimes = new Map<string, string>();
  for (const finish of savedFinishes) {
    if (finish.finishTime && finish.competitorId) {
      finishTimes.set(finish.competitorId, finish.finishTime);
    }
  }

  const tiedWithPrevious = new Set<string>();
  for (let i = 0; i < positionedFinishes.length; i++) {
    if (positionedFinishes[i].tiedWithPrevious) {
      tiedWithPrevious.add(entryKey(finishingOrder[i]));
    }
  }

  const finishByEntryKey = new Map<string, Finish>();
  for (let i = 0; i < positionedFinishes.length; i++) {
    finishByEntryKey.set(entryKey(finishingOrder[i]), positionedFinishes[i]);
  }
  const finishByCompetitorId = new Map<string, Finish>();
  for (const f of savedFinishes) {
    if (f.competitorId) finishByCompetitorId.set(f.competitorId, f);
  }

  return {
    finishingOrder,
    nonFinisherCodes,
    finishTimes,
    tiedWithPrevious,
    finisherPenalties,
    redressEntries,
    finishByEntryKey,
    finishByCompetitorId,
  };
}

/**
 * Moves a competitor to a new position in the finishing order.
 *
 * @param order - Current finishing order (array of competitor IDs, 0-indexed)
 * @param competitorId - The competitor to move
 * @param newPosition - Target position (1-based); must be in range [1, order.length]
 * @returns New finishing order array (original is not mutated)
 */
export function reorderFinisher(
  order: string[],
  competitorId: string,
  newPosition: number,
): string[] {
  const next = [...order];
  const currentIndex = next.indexOf(competitorId);
  if (currentIndex === -1) return next;

  next.splice(currentIndex, 1);
  next.splice(newPosition - 1, 0, competitorId);
  return next;
}

/**
 * Move a row from one index to another within the finishing order and recompute
 * simultaneous-finish ties (drag-and-drop reorder). `keys` are entry keys in
 * current order; `ties` holds the keys of rows tied with the row immediately
 * above them.
 *
 * Tie recomputation: the row that followed the moved row loses its tie unless
 * the moved row was itself part of that group (so the group continues above
 * it), and the moved row's own tie is cleared since its new predecessor differs.
 *
 * Returns the original `keys`/`ties` references unchanged when the move is a
 * no-op (equal or out-of-range indices), so callers can skip a commit cheaply.
 */
export function reorderWithTies(
  keys: string[],
  ties: Set<string>,
  fromIndex: number,
  toIndex: number,
): { keys: string[]; ties: Set<string> } {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    fromIndex >= keys.length ||
    toIndex < 0 ||
    toIndex >= keys.length
  ) {
    return { keys, ties };
  }
  const movedKey = keys[fromIndex];
  const nextTies = new Set(ties);

  const belowIndex = fromIndex + 1;
  if (belowIndex < keys.length) {
    const belowKey = keys[belowIndex];
    if (nextTies.has(belowKey) && !nextTies.has(movedKey)) {
      nextTies.delete(belowKey);
    }
  }
  nextTies.delete(movedKey);

  const next = [...keys];
  next.splice(fromIndex, 1);
  next.splice(toIndex, 0, movedKey);
  return { keys: next, ties: nextTies };
}

// ─── Non-finisher view-model ─────────────────────────────────────────────────

/** A non-finisher's displayed code: an explicit result code, or the implicit
 *  DNC of a competitor with no row at all. */
export type NonFinisherCode = ResultCode | 'implicit-dnc';

export interface NonFinisherView {
  competitor: Competitor;
  code: NonFinisherCode;
}

/** Display labels for the non-finisher code dropdown, in menu order. */
export const NON_FINISHER_CODE_LABELS: Record<NonFinisherCode, string> = {
  'implicit-dnc': 'DNC (absent)',
  // Common operational codes — shown first
  DNS: 'DNS',
  DNF: 'DNF',
  OCS: 'OCS',
  NSC: 'NSC',
  RET: 'RET',
  // Protest committee codes
  DSQ: 'DSQ',
  DNE: 'DNE',
  UFD: 'UFD',
  BFD: 'BFD',
  // Explicit absence
  DNC: 'DNC',
  // Redress
  RDG: 'RDG (redress)',
};

/** The competitor ids currently in the finishing order. */
export function finishedCompetitorIds(finishingOrder: FinishEntry[]): Set<string> {
  return new Set(
    finishingOrder.flatMap((e) => (e.kind === 'known' ? [e.competitorId] : [])),
  );
}

/** Every competitor not in the finishing order, with the code to display:
 *  the explicit result code if one is recorded, DNF for a boat that was
 *  checked in at the start, implicit DNC otherwise. */
export function deriveNonFinishers(
  competitors: Competitor[],
  finishedIds: Set<string>,
  nonFinisherCodes: Map<string, ResultCode>,
  savedFinishes: Finish[] | undefined,
): NonFinisherView[] {
  return competitors
    .filter((c) => !finishedIds.has(c.id))
    .map((c) => {
      const explicitCode = nonFinisherCodes.get(c.id);
      const isPresent = savedFinishes?.some(
        (f) => f.competitorId === c.id && f.startPresent === true,
      );
      return {
        competitor: c,
        code: explicitCode ?? (isPresent ? 'DNF' : 'implicit-dnc'),
      };
    });
}
