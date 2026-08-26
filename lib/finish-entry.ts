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
    ...(overrides.matchedOn ? { matchedOn: overrides.matchedOn } : {}),
    ...(overrides.enteredSailNumber ? { enteredSailNumber: overrides.enteredSailNumber } : {}),
    sortOrder: overrides.sortOrder ?? null,
    tiedWithPrevious: overrides.tiedWithPrevious ?? false,
    ...(overrides.finishTime != null ? { finishTime: overrides.finishTime } : {}),
    ...(overrides.trackData != null ? { trackData: overrides.trackData } : {}),
    resultCode: overrides.resultCode ?? null,
    startPresent: overrides.startPresent ?? null,
    penaltyCode: overrides.penaltyCode ?? null,
    penaltyOverride: overrides.penaltyOverride ?? null,
    ...(overrides.penaltyLabel != null ? { penaltyLabel: overrides.penaltyLabel } : {}),
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

/** A finish as an imported sheet produces it: everything but the identity the
 *  committing race supplies. */
export type ImportedFinish = Omit<Finish, 'id' | 'raceId'>;

/** Identify a finish across the stored and incoming sides of an import. An
 *  unresolved crossing has no competitor, so it goes by the number written
 *  down. */
function importKey(f: { competitorId: string | null; unknownSailNumber?: string | null }): string {
  return f.competitorId ?? `?${f.unknownSailNumber ?? ''}`;
}

/** Each finisher's immediate predecessor in crossing order, by import key —
 *  the fact a tie marker hangs off. */
function predecessors(
  rows: readonly { competitorId: string | null; unknownSailNumber?: string | null; sortOrder: number | null }[],
): Map<string, string | null> {
  const order = rows
    .filter((f) => f.sortOrder !== null)
    .sort((a, b) => a.sortOrder! - b.sortOrder!);
  const map = new Map<string, string | null>();
  order.forEach((f, i) => map.set(importKey(f), i === 0 ? null : importKey(order[i - 1])));
  return map;
}

/**
 * Carry across what an imported sheet cannot express.
 *
 * Replacing a race's finishes with a sheet would otherwise clear its
 * penalties, redress, ties and start check-ins — state that reaches the
 * scorer as separate notes from the jury or race committee and can never be
 * re-derived from a sheet. So each imported row picks those up from the
 * stored finish for the same boat, wherever they still attach:
 *
 * - a penalty carries onto a boat who is still a finisher — additive
 *   penalties don't depend on her place. A boat the sheet now codes (DNF,
 *   DSQ…) doesn't get one: the penalty only means something on a finish.
 * - redress carries onto a still-finishing boat, whether the stored grant was
 *   on her finish or on a coded row. Redress that would land on an incoming
 *   coded row is not carried — the stored grant may have replaced the very
 *   code the sheet holds, and which of the two stands is the scorer's call.
 * - a tie carries when the boat and the boat immediately ahead of her are
 *   the same pair on both sides; a reshuffled order breaks the fact the
 *   marker recorded.
 * - a start check-in carries whenever the boat appears on the sheet at all.
 *
 * What cannot carry is left off, so the diff between the stored race and the
 * carried result shows exactly what an import would lose.
 */
export function carryAcrossImport(
  stored: readonly Finish[],
  imported: readonly ImportedFinish[],
): ImportedFinish[] {
  const storedByKey = new Map(stored.map((f) => [importKey(f), f]));
  const storedPredecessor = predecessors(stored);
  const importedPredecessor = predecessors(imported);

  return imported.map((f) => {
    const key = importKey(f);
    const prior = storedByKey.get(key);
    if (!prior) return f;

    const out: ImportedFinish = { ...f };
    if (out.startPresent === null) out.startPresent = prior.startPresent;
    if (out.sortOrder === null) return out;

    if (prior.penaltyCode) {
      out.penaltyCode = prior.penaltyCode;
      out.penaltyOverride = prior.penaltyOverride;
      if (prior.penaltyLabel) out.penaltyLabel = prior.penaltyLabel;
      if (prior.penaltyOverrideByFleet) out.penaltyOverrideByFleet = { ...prior.penaltyOverrideByFleet };
    }
    if (prior.resultCode === 'RDG') {
      out.resultCode = 'RDG';
      out.redressMethod = prior.redressMethod;
      out.redressExcludeRaceIds = prior.redressExcludeRaceIds ? [...prior.redressExcludeRaceIds] : null;
      out.redressIncludeRaceIds = prior.redressIncludeRaceIds ? [...prior.redressIncludeRaceIds] : null;
      out.redressIncludeAllLater = prior.redressIncludeAllLater;
      out.redressPoints = prior.redressPoints;
      if (prior.redressPointsByFleet) out.redressPointsByFleet = { ...prior.redressPointsByFleet };
    }
    if (prior.tiedWithPrevious) {
      const ahead = storedPredecessor.get(key);
      if (ahead != null && ahead === importedPredecessor.get(key)) out.tiedWithPrevious = true;
    }
    return out;
  });
}

/** One piece of inexpressible state {@link carryAcrossImport} either kept or
 *  couldn't: the penalty code itself, `redress`, `tie`, or `start check-in`,
 *  against the boat it sits on. */
export interface CarryOutcomeItem {
  competitorId: string | null;
  unknownSailNumber?: string;
  what: string;
}

/**
 * What {@link carryAcrossImport} did with each piece of stored state a sheet
 * can't express, phrased for a confirm dialog: `kept` rode across onto the
 * imported rows; `cleared` had nowhere to attach and dies with the replaced
 * finishes unless the scorer re-enters it. Start check-ins are only reported
 * when cleared — they carry whenever the boat appears at all, and losing one
 * quietly turns her DNF default into a DNC.
 */
export function carryOutcome(
  stored: readonly Finish[],
  carried: readonly ImportedFinish[],
): { kept: CarryOutcomeItem[]; cleared: CarryOutcomeItem[] } {
  const carriedByKey = new Map(carried.map((f) => [importKey(f), f]));
  const kept: CarryOutcomeItem[] = [];
  const cleared: CarryOutcomeItem[] = [];
  for (const f of stored) {
    const after = carriedByKey.get(importKey(f));
    const item = (what: string): CarryOutcomeItem => ({
      competitorId: f.competitorId,
      ...(f.competitorId === null ? { unknownSailNumber: f.unknownSailNumber ?? '' } : {}),
      what,
    });
    if (f.penaltyCode) (after?.penaltyCode ? kept : cleared).push(item(f.penaltyCode));
    if (f.resultCode === 'RDG') (after?.resultCode === 'RDG' ? kept : cleared).push(item('redress'));
    if (f.tiedWithPrevious) (after?.tiedWithPrevious ? kept : cleared).push(item('tie'));
    if (f.startPresent === true && !after) cleared.push(item('start check-in'));
  }
  return { kept, cleared };
}

/**
 * The `Finish` rows an imported sheet becomes.
 *
 * Finishers first, renumbered 1..n in crossing order, then the coded
 * non-finishers. A coded row needs a competitor — "DNF for a boat nobody
 * recognises" isn't a result — so unresolved ones are dropped here; the
 * parser has already reported them.
 *
 * Everything else on a row is kept as given, so the state
 * {@link carryAcrossImport} attached — penalties, redress, ties, start
 * check-ins — survives the commit.
 *
 * Shared by the per-race CSV import and the RaceSense workbook import, which
 * differ in how they read a sheet and not at all in what they write.
 */
export function finishRowsFromImport(
  raceId: string,
  finishes: readonly ImportedFinish[],
): Finish[] {
  const rows: Finish[] = [];
  finishes
    .filter((f) => f.sortOrder !== null)
    .sort((a, b) => a.sortOrder! - b.sortOrder!)
    .forEach((f, i) => {
      rows.push(makeFinish(raceId, {
        ...f,
        id: crypto.randomUUID(),
        ...(f.competitorId === null ? { unknownSailNumber: f.unknownSailNumber ?? '' } : {}),
        sortOrder: i + 1,
      }));
    });
  for (const f of finishes) {
    if (f.sortOrder === null && f.resultCode && f.competitorId) {
      rows.push(makeFinish(raceId, {
        ...f,
        id: crypto.randomUUID(),
      }));
    }
  }
  return rows;
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
  finisherPenalties: Map<string, { code: PenaltyCode; override: number | null; overrideByFleet: Record<string, number> | null; label?: string }>;
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

  const finisherPenalties = new Map<string, { code: PenaltyCode; override: number | null; overrideByFleet: Record<string, number> | null; label?: string }>();
  for (const finish of savedFinishes) {
    if (finish.penaltyCode && finish.competitorId && finishedIds.has(finish.competitorId)) {
      finisherPenalties.set(finish.competitorId, {
        code: finish.penaltyCode,
        override: finish.penaltyOverride ?? null,
        overrideByFleet: finish.penaltyOverrideByFleet ?? null,
        ...(finish.penaltyLabel ? { label: finish.penaltyLabel } : {}),
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

/**
 * Split non-finishers into boats with a recorded result and boats that did not
 * compete (auto DNC, or an explicit DNC). Lets the panel sink the did-not-
 * compete boats — usually most of the fleet, and needing no attention — below
 * the ones the scorer has actually recorded a result for. Order within each
 * group is preserved.
 */
export function partitionNonFinishers(views: NonFinisherView[]): {
  recorded: NonFinisherView[];
  didNotCompete: NonFinisherView[];
} {
  const recorded: NonFinisherView[] = [];
  const didNotCompete: NonFinisherView[] = [];
  for (const view of views) {
    if (view.code === 'implicit-dnc' || view.code === 'DNC') {
      didNotCompete.push(view);
    } else {
      recorded.push(view);
    }
  }
  return { recorded, didNotCompete };
}

// ─── Sail-number entry resolution ────────────────────────────────────────────

/** Which of a competitor's identifiers a typed entry resolved against.
 *  `sail` is the registered sail number; the other two are the fallbacks that
 *  only rescue an entry the registered number could not match. */
export type MatchTier = 'sail' | 'alternative' | 'bow';

/**
 * Match a typed value against one competitor's identifiers as a prefix, in
 * the same tier order the Enter resolution uses: registered sail number,
 * then alternative sail numbers, then bow number. Returns which identifier
 * matched and its full value (as the competitor spells it), or null.
 * Drives the suggestions dropdown — both the committable rows and the
 * already-entered ones. `query` must be trimmed, uppercased and non-empty.
 */
export function matchIdentifierPrefix(
  competitor: Competitor,
  query: string,
): { matchedOn: MatchTier; entered: string } | null {
  if (competitor.sailNumber.toUpperCase().startsWith(query)) {
    return { matchedOn: 'sail', entered: competitor.sailNumber };
  }
  const alt = (competitor.alternativeSailNumbers ?? []).find(
    (v) => v.trim() !== '' && v.trim().toUpperCase().startsWith(query),
  );
  if (alt !== undefined) {
    return { matchedOn: 'alternative', entered: alt };
  }
  const bow = (competitor.bowNumber ?? '').toUpperCase();
  if (bow !== '' && bow.startsWith(query)) {
    return { matchedOn: 'bow', entered: competitor.bowNumber! };
  }
  return null;
}

/** What a plain Enter in the sail-number box should do with the typed text. */
export type SailEntryResolution =
  | { kind: 'empty' }
  /** Add this competitor — an exact match on one of its identifiers, or the
   *  sole unfinished boat one of them is a prefix of. `matchedOn` records which
   *  identifier the typed text resolved against, so the UI can flag a row that
   *  did not come in under the registered sail number (the committed row shows
   *  that number, not what was typed). `entered` is the full identifier that
   *  matched — not the typed text, which may be only a prefix of it. */
  | {
      kind: 'commit';
      competitor: Competitor;
      matchedOn: MatchTier;
      entered: string;
    }
  /** Exact identifier match, but every boat carrying it is already in the
   *  order. Carries those boats so the UI can point at the existing rows —
   *  duplicate entries on a paper finish sheet are a recorder error the
   *  scorer discovers here, so the response must say where the boat already
   *  is, not just refuse. */
  | { kind: 'already-finished'; competitors: Competitor[] }
  /** Exact sail match shared by more than one unfinished boat. */
  | { kind: 'duplicate-sail' }
  /** No exact match, and the input is a prefix of two or more unfinished
   *  boats — no single target, so Enter should defer to the dropdown. */
  | { kind: 'ambiguous-prefix' }
  /** No exact match and no prefix match — offer to record it as unknown. */
  | { kind: 'unknown' };

/**
 * Decide what a plain Enter commits, given the typed text and the roster.
 * Exact sail matches take precedence over prefixes, so `7` wins over `72`;
 * a unique prefix commits the one boat it can only mean; anything ambiguous
 * or unmatched hands off to the dropdown / record-as-unknown path. Pure and
 * order-preserving (mirrors the prefix filter behind the suggestions list).
 *
 * The other identifiers layer strictly *underneath* sail matching, in tiers:
 * registered sail number (exact, then unique prefix), then alternative sail
 * numbers (exact, then unique prefix), then bow numbers (exact, then unique
 * prefix). Each tier only runs when every tier above it found nothing, so a
 * typed value that is one boat's registered sail number always resolves to
 * that boat, even if it happens to be another boat's alternative or bow
 * number. The lower tiers only ever rescue an otherwise-unknown entry
 * (#234, #379).
 */
/** The identifier value itself, as the competitor spells it, rather than the
 *  normalised form used for comparison or the possibly-partial typed text. */
function matchedValue(
  c: Competitor,
  values: (c: Competitor) => string[],
  predicate: (normalised: string) => boolean,
): string | undefined {
  return values(c).find((v) => predicate(v.trim().toUpperCase()));
}

export function resolveSailEntry(
  rawInput: string,
  competitors: Competitor[],
  finishedIds: Set<string>,
): SailEntryResolution {
  const sail = rawInput.trim().toUpperCase();
  if (!sail) return { kind: 'empty' };

  const exact = competitors.filter((c) => c.sailNumber.toUpperCase() === sail);
  if (exact.length > 0) {
    const unfinished = exact.filter((c) => !finishedIds.has(c.id));
    if (unfinished.length === 0) return { kind: 'already-finished', competitors: exact };
    if (unfinished.length > 1) return { kind: 'duplicate-sail' };
    return {
      kind: 'commit',
      competitor: unfinished[0],
      matchedOn: 'sail',
      entered: unfinished[0].sailNumber,
    };
  }

  const prefix = competitors.filter(
    (c) => !finishedIds.has(c.id) && c.sailNumber.toUpperCase().startsWith(sail),
  );
  if (prefix.length === 1) {
    return { kind: 'commit', competitor: prefix[0], matchedOn: 'sail', entered: prefix[0].sailNumber };
  }
  if (prefix.length > 1) return { kind: 'ambiguous-prefix' };

  // No registered-sail match at all — try the boat's other identifiers. Within
  // each tier an exact match wins over a prefix, mirroring the sail rules
  // above, and an identifier shared by more than one unfinished boat is
  // ambiguous: defer to the dropdown rather than guessing.
  const tiers: { matchedOn: 'alternative' | 'bow'; values: (c: Competitor) => string[] }[] = [
    {
      matchedOn: 'alternative',
      values: (c) => c.alternativeSailNumbers ?? [],
    },
    {
      matchedOn: 'bow',
      values: (c) => (c.bowNumber ? [c.bowNumber] : []),
    },
  ];

  for (const tier of tiers) {
    const unfinished = competitors.filter((c) => !finishedIds.has(c.id));
    const values = (c: Competitor) => tier.values(c).map((v) => v.trim().toUpperCase()).filter(Boolean);

    const tierExact = unfinished.filter((c) => values(c).includes(sail));
    if (tierExact.length === 1) {
      return {
        kind: 'commit',
        competitor: tierExact[0],
        matchedOn: tier.matchedOn,
        entered: matchedValue(tierExact[0], tier.values, (v) => v === sail)!,
      };
    }
    if (tierExact.length > 1) return { kind: 'ambiguous-prefix' };

    const tierPrefix = unfinished.filter((c) => values(c).some((v) => v.startsWith(sail)));
    if (tierPrefix.length === 1) {
      return {
        kind: 'commit',
        competitor: tierPrefix[0],
        matchedOn: tier.matchedOn,
        entered: matchedValue(tierPrefix[0], tier.values, (v) => v.startsWith(sail))!,
      };
    }
    if (tierPrefix.length > 1) return { kind: 'ambiguous-prefix' };
  }

  // The typed value is an exact alternative or bow number of a boat that has
  // already finished — the registered-sail case returned above. Report it as
  // already entered rather than unknown: the number is registered, and
  // offering to record it as a new unknown boat would invite a duplicate.
  // A mere prefix of a finished boat's identifier still falls through to
  // unknown, since it could genuinely be a different boat.
  const finishedExact = competitors.filter(
    (c) =>
      finishedIds.has(c.id) &&
      [...(c.alternativeSailNumbers ?? []), ...(c.bowNumber ? [c.bowNumber] : [])].some(
        (v) => v.trim().toUpperCase() === sail,
      ),
  );
  if (finishedExact.length > 0) return { kind: 'already-finished', competitors: finishedExact };

  return { kind: 'unknown' };
}
