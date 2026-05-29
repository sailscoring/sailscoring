/**
 * Source-of-handicaps resolution for the Update Handicaps dialog (#144).
 *
 * Pure functions over already-loaded data. The dialog asks: "for each
 * competitor in some prior series, what is its end-of-series TCF per
 * fleet?" — and uses the answers as starting TCFs for the same boats
 * in a target series.
 *
 * Two layers:
 * - {@link endOfSeriesTcfs} resolves end-of-series progressive-handicap
 *   TCFs (NHC, ECHO) from a persisted `TcfRecord[]` history.
 * - {@link planHandicapUpdates} consumes that map together with the
 *   target series's competitors and fleets, plus an optional
 *   target→source fleet mapping, and produces the preview rows the
 *   dialog renders. IRC and PY are sourced directly off the source
 *   competitor's `ircTcc` / `pyNumber` (no fleet history involved).
 * - {@link proposeFleetMapping} seeds the dialog's fleet-mapping
 *   defaults: exact name match within scoringSystem first, then the
 *   single-candidate fallback when only one source fleet uses the
 *   target's system.
 */

import {
  normalizeBoatName,
  sailNumberParts,
  sailNumbersMatch,
  type IrcTccVariant,
  type IrishSailingRating,
  type SailNumberParts,
} from './irish-sailing-ratings';
import type { Competitor, Fleet, Race, TcfRecord } from './types';

/**
 * The progressive-handicap systems whose end-of-series TCF we can read
 * out of the persisted `TcfRecord` history. Static-TCF systems (IRC, PY)
 * carry no per-race history — they are sourced directly from the
 * competitor record by the diff planner instead.
 */
export type ProgressiveHandicapSystem = 'nhc' | 'echo';

export interface EndOfSeriesTcf {
  competitorId: string;
  fleetId: string;
  system: ProgressiveHandicapSystem;
  /** TCF the boat should carry into race 1 of the target series. */
  endTcf: number;
  /** The race whose `newTcf` we read. Surfaced so the dialog can show
   *  "handicaps as of {raceNumber}". */
  lastRaceId: string;
  lastRaceNumber: number;
}

/** Composite key for the returned map. Encodes `competitorId × fleetId` —
 *  a boat in two progressive-handicap fleets in the source series has an
 *  entry per fleet, and the consumer keeps both separate. */
export function endOfSeriesTcfKey(competitorId: string, fleetId: string): string {
  return `${competitorId}::${fleetId}`;
}

/**
 * For every `(competitor, progressive-fleet)` pairing in the source
 * series, return the `newTcf` from the latest scored race.
 *
 * "Latest" is defined by race date first, then race number — matching
 * the order the scoring engine processes races in.
 *
 * A pairing with no `TcfRecord` rows is omitted (the fleet either has
 * no scored races, or the boat never raced in any of them). The
 * consumer treats omissions as "not found in source" and leaves the
 * target competitor's current TCF in place.
 */
export function endOfSeriesTcfs(
  competitors: readonly Competitor[],
  fleets: readonly Fleet[],
  races: readonly Race[],
  history: readonly TcfRecord[],
): Map<string, EndOfSeriesTcf> {
  // Index fleets that even produce progressive history.
  const progressiveFleetSystem = new Map<string, ProgressiveHandicapSystem>();
  for (const f of fleets) {
    if (f.scoringSystem === 'nhc' || f.scoringSystem === 'echo') {
      progressiveFleetSystem.set(f.id, f.scoringSystem);
    }
  }
  if (progressiveFleetSystem.size === 0) return new Map();

  // Order races so "latest" is well-defined. Date first (ISO sorts
  // lexicographically), then raceNumber so two races on the same day
  // resolve deterministically. Races missing from the input list (a
  // history record references a race we weren't given) are excluded
  // from the ordering — their records become unreachable and are
  // skipped below.
  const raceOrder = new Map<string, { date: string; raceNumber: number }>();
  for (const r of races) raceOrder.set(r.id, { date: r.date, raceNumber: r.raceNumber });

  function isLater(
    a: { date: string; raceNumber: number },
    b: { date: string; raceNumber: number },
  ): boolean {
    if (a.date !== b.date) return a.date > b.date;
    return a.raceNumber > b.raceNumber;
  }

  // Walk every history record, keep the latest per (competitor, fleet).
  type Pick = { record: TcfRecord; order: { date: string; raceNumber: number } };
  const latest = new Map<string, Pick>();
  for (const rec of history) {
    const system = progressiveFleetSystem.get(rec.fleetId);
    if (!system) continue;
    const order = raceOrder.get(rec.raceId);
    if (!order) continue;
    const key = endOfSeriesTcfKey(rec.competitorId, rec.fleetId);
    const prior = latest.get(key);
    if (!prior || isLater(order, prior.order)) {
      latest.set(key, { record: rec, order });
    }
  }

  // Materialise — only for competitors actually present in the source
  // series (a history record for a deleted competitor is dropped).
  const competitorIds = new Set(competitors.map((c) => c.id));
  const result = new Map<string, EndOfSeriesTcf>();
  for (const [key, pick] of latest) {
    if (!competitorIds.has(pick.record.competitorId)) continue;
    const system = progressiveFleetSystem.get(pick.record.fleetId)!;
    result.set(key, {
      competitorId: pick.record.competitorId,
      fleetId: pick.record.fleetId,
      system,
      endTcf: pick.record.newTcf,
      lastRaceId: pick.record.raceId,
      lastRaceNumber: pick.order.raceNumber,
    });
  }
  return result;
}

// ─── Diff planner ────────────────────────────────────────────────────────────

/**
 * Every handicap system the dialog can update. Progressive systems
 * (`nhc`, `echo`) are sourced from the end-of-series TCF map; static
 * systems (`irc`, `py`) are sourced directly from the source competitor
 * record.
 */
export type HandicapSystem = 'nhc' | 'echo' | 'irc' | 'py';

export type NotFoundReason =
  /** Target fleet was not mapped to a source fleet — the scorer picked
   *  "skip" (or no candidate auto-matched). */
  | 'no-source-fleet-mapping'
  /** No competitor in the source series matches the target boat's
   *  sail number. */
  | 'no-source-competitor'
  /** Source competitor exists but has no value for this system. For
   *  NHC/ECHO that means the boat never produced a TCF record (didn't
   *  race in the mapped source fleet, or the source fleet has no scored
   *  races yet). For IRC/PY it means the source competitor record has
   *  no `ircTcc` / `pyNumber`. */
  | 'no-source-value'
  /** The source publishes nothing for this system. Irish Sailing covers
   *  only IRC and ECHO, so `nhc`/`py` target fleets surface this. */
  | 'system-not-published'
  /** More than one Irish Sailing boat matched this competitor (same sail
   *  core, or same name) and we can't safely pick one. The scorer should
   *  disambiguate by entering the full sail number. */
  | 'ambiguous-match';

/** How the Irish Sailing source matched a competitor to a rating record. Only
 *  set on the Irish Sailing source; `undefined` on the prior-series source. */
export type RatingMatchMethod =
  /** Full sail number equal, e.g. `IRL1431` ↔ `IRL1431`. */
  | 'exact-sail'
  /** Sail cores equal with the competitor (or record) missing the country
   *  prefix, e.g. `1431` ↔ `IRL1431`. */
  | 'sail-no-country'
  /** Matched on boat name (the opt-in liberal fallback). */
  | 'name';

export interface RatingMatch {
  method: RatingMatchMethod;
  /** The matched record's sail number, for the scorer to verify against. */
  sail: string;
  /** The matched record's boat name, where present. */
  name?: string;
}

export interface PreviewRow {
  competitorId: string;
  targetFleetId: string;
  system: HandicapSystem;
  /** The target boat's current TCF for this system, or `null` if unset. */
  currentTcf: number | null;
  /** The TCF we propose to write. `null` iff `status === 'not-found'`. */
  newTcf: number | null;
  status: 'change' | 'unchanged' | 'not-found';
  /** Present iff `status === 'not-found'`. */
  notFoundReason?: NotFoundReason;
  /** How the source row was matched. Set only for non-exact Irish Sailing
   *  matches so the dialog can show the basis for the scorer to verify. */
  match?: RatingMatch;
  /** Which IRC TCC was used for this row. Set only on Irish Sailing `irc`
   *  rows, so the dialog can label "IRC (spin)" / "IRC (non-spin)". */
  ircVariant?: IrcTccVariant;
}

export interface PlanInput {
  targetCompetitors: readonly Competitor[];
  targetFleets: readonly Fleet[];
  sourceCompetitors: readonly Competitor[];
  /** Output of {@link endOfSeriesTcfs} for the source series. */
  endOfSourceTcfs: ReadonlyMap<string, EndOfSeriesTcf>;
  /** `targetFleetId → sourceFleetId | null`. `null` means "skip this
   *  target fleet" (boats in it surface as `no-source-fleet-mapping`).
   *  A target fleet missing from the mapping is also treated as skipped. */
  fleetMapping: Readonly<Record<string, string | null>>;
}

function systemForFleet(fleet: Fleet): HandicapSystem | null {
  switch (fleet.scoringSystem) {
    case 'nhc':
    case 'echo':
    case 'irc':
    case 'py':
      return fleet.scoringSystem;
    case 'scratch':
      return null;
  }
}

function currentTcfFor(competitor: Competitor, system: HandicapSystem): number | null {
  switch (system) {
    case 'nhc':
      return competitor.nhcStartingTcf ?? null;
    case 'echo':
      return competitor.echoStartingTcf ?? null;
    case 'irc':
      return competitor.ircTcc ?? null;
    case 'py':
      return competitor.pyNumber ?? null;
  }
}

/**
 * Produce one preview row per `(target competitor, target fleet)` pair
 * where the target fleet uses a handicap system. The dialog renders
 * these rows directly.
 */
export function planHandicapUpdates(input: PlanInput): PreviewRow[] {
  const targetFleetById = new Map(input.targetFleets.map((f) => [f.id, f]));
  const sourceCompBySail = new Map<string, Competitor>();
  for (const c of input.sourceCompetitors) {
    sourceCompBySail.set(c.sailNumber.toUpperCase(), c);
  }

  const rows: PreviewRow[] = [];

  for (const targetComp of input.targetCompetitors) {
    const sourceComp = sourceCompBySail.get(targetComp.sailNumber.toUpperCase());

    for (const targetFleetId of targetComp.fleetIds) {
      const targetFleet = targetFleetById.get(targetFleetId);
      if (!targetFleet) continue;
      const system = systemForFleet(targetFleet);
      if (!system) continue;

      const currentTcf = currentTcfFor(targetComp, system);
      const mapped = input.fleetMapping[targetFleetId];

      if (mapped === undefined || mapped === null) {
        rows.push({
          competitorId: targetComp.id,
          targetFleetId,
          system,
          currentTcf,
          newTcf: null,
          status: 'not-found',
          notFoundReason: 'no-source-fleet-mapping',
        });
        continue;
      }

      if (!sourceComp) {
        rows.push({
          competitorId: targetComp.id,
          targetFleetId,
          system,
          currentTcf,
          newTcf: null,
          status: 'not-found',
          notFoundReason: 'no-source-competitor',
        });
        continue;
      }

      let newTcf: number | null = null;
      if (system === 'nhc' || system === 'echo') {
        const entry = input.endOfSourceTcfs.get(endOfSeriesTcfKey(sourceComp.id, mapped));
        newTcf = entry?.endTcf ?? null;
      } else if (system === 'irc') {
        newTcf = sourceComp.ircTcc ?? null;
      } else {
        // system === 'py'
        newTcf = sourceComp.pyNumber ?? null;
      }

      if (newTcf === null) {
        rows.push({
          competitorId: targetComp.id,
          targetFleetId,
          system,
          currentTcf,
          newTcf: null,
          status: 'not-found',
          notFoundReason: 'no-source-value',
        });
        continue;
      }

      rows.push({
        competitorId: targetComp.id,
        targetFleetId,
        system,
        currentTcf,
        newTcf,
        status: currentTcf === newTcf ? 'unchanged' : 'change',
      });
    }
  }

  return rows;
}

/**
 * Seed the fleet-mapping dropdowns. For each non-scratch target fleet,
 * try in order:
 * 1. Same scoringSystem AND exact name match (case-insensitive).
 * 2. Same scoringSystem AND exactly one candidate in the source.
 *
 * Otherwise leave the entry `null` (skipped) — the scorer picks
 * explicitly. Scratch target fleets are omitted from the result
 * entirely (no handicap to update).
 */
export function proposeFleetMapping(
  targetFleets: readonly Fleet[],
  sourceFleets: readonly Fleet[],
): Record<string, string | null> {
  const sourceBySystem = new Map<Fleet['scoringSystem'], Fleet[]>();
  for (const f of sourceFleets) {
    if (f.scoringSystem === 'scratch') continue;
    const list = sourceBySystem.get(f.scoringSystem) ?? [];
    list.push(f);
    sourceBySystem.set(f.scoringSystem, list);
  }

  const mapping: Record<string, string | null> = {};
  for (const tf of targetFleets) {
    if (tf.scoringSystem === 'scratch') continue;
    const candidates = sourceBySystem.get(tf.scoringSystem) ?? [];

    const exact = candidates.find((c) => c.name.toLowerCase() === tf.name.toLowerCase());
    if (exact) {
      mapping[tf.id] = exact.id;
      continue;
    }
    mapping[tf.id] = candidates.length === 1 ? candidates[0].id : null;
  }
  return mapping;
}

// ─── Irish Sailing certificate source (#168) ─────────────────────────────────

export interface IrishSailingPlanInput {
  targetCompetitors: readonly Competitor[];
  targetFleets: readonly Fleet[];
  /** The national ratings list (already fetched + parsed). */
  ratings: readonly IrishSailingRating[];
  /** Spin/non-spin choice per IRC fleet, keyed by fleet id. A fleet whose
   *  boats race non-spinnaker uses the non-spin TCC; IRC fleets absent from
   *  the map default to spinnaker. Per-fleet (not global) so a series with a
   *  mix of spinnaker and non-spinnaker classes is handled in one pass.
   *  Ignored for ECHO fleets (ECHO has no spin/non-spin split). */
  ircVariantByFleet: Readonly<Record<string, IrcTccVariant>>;
  /** Opt-in liberal fallback: when a competitor has no sail-number match,
   *  match on boat name instead. Off by default — names collide more readily
   *  than sail numbers, so the dialog gates this behind a toggle. */
  matchByName?: boolean;
}

interface RatingEntry {
  rating: IrishSailingRating;
  parts: SailNumberParts;
}

type MatchResult =
  | { kind: 'matched'; rating: IrishSailingRating; method: RatingMatchMethod }
  | { kind: 'ambiguous' }
  | { kind: 'none' };

/**
 * Match indexes over the ratings list, built once per plan. Sail numbers are
 * indexed by their numeric core so a country-code-less competitor (`"1431"`)
 * finds `"IRL1431"`; names are indexed for the opt-in fallback.
 */
class RatingMatcher {
  private readonly byCore = new Map<string, RatingEntry[]>();
  private readonly byName = new Map<string, RatingEntry[]>();

  constructor(ratings: readonly IrishSailingRating[]) {
    for (const rating of ratings) {
      const parts = sailNumberParts(rating.sailNumber);
      const entry: RatingEntry = { rating, parts };
      if (parts.core) push(this.byCore, parts.core, entry);
      const name = normalizeBoatName(rating.boatName);
      if (name) push(this.byName, name, entry);
    }
  }

  match(competitor: Competitor, matchByName: boolean): MatchResult {
    const parts = sailNumberParts(competitor.sailNumber);
    const sailCandidates = (this.byCore.get(parts.core) ?? []).filter((e) =>
      sailNumbersMatch(parts, e.parts),
    );

    if (sailCandidates.length === 1) {
      const e = sailCandidates[0];
      return {
        kind: 'matched',
        rating: e.rating,
        method: e.parts.full === parts.full ? 'exact-sail' : 'sail-no-country',
      };
    }

    if (sailCandidates.length > 1) {
      // Same sail core, can't pick on number alone. Try to break the tie on
      // name if that's enabled; otherwise it's ambiguous.
      if (matchByName) {
        const name = normalizeBoatName(competitor.boatName);
        const byName = name
          ? sailCandidates.filter((e) => normalizeBoatName(e.rating.boatName) === name)
          : [];
        if (byName.length === 1) {
          return { kind: 'matched', rating: byName[0].rating, method: 'sail-no-country' };
        }
      }
      return { kind: 'ambiguous' };
    }

    // No sail match — optional liberal name fallback.
    if (matchByName) {
      const name = normalizeBoatName(competitor.boatName);
      const nameCandidates = name ? this.byName.get(name) ?? [] : [];
      if (nameCandidates.length === 1) {
        return { kind: 'matched', rating: nameCandidates[0].rating, method: 'name' };
      }
      if (nameCandidates.length > 1) return { kind: 'ambiguous' };
    }

    return { kind: 'none' };
  }
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * Produce preview rows for the "Irish Sailing certificates" source. Unlike the
 * prior-series source there is no fleet mapping — the ratings list is a flat
 * national table matched by sail number, tolerant of a missing country code
 * (`"1431"` ↔ `"IRL1431"`), with an opt-in name fallback.
 *
 * Per target `(competitor, fleet)` where the fleet uses a handicap system:
 * - `irc`  → the boat's spin or non-spin TCC, per `ircVariant`.
 * - `echo` → the boat's published ECHO standard.
 * - `nhc` / `py` → `not-found` with reason `system-not-published` (Irish
 *   Sailing publishes neither).
 *
 * Boats absent from the list surface as `no-source-competitor`; multiple
 * matches as `ambiguous-match`; a matched boat lacking the relevant value as
 * `no-source-value`. Non-exact matches carry a `match` annotation so the
 * dialog can show the basis for the scorer to verify.
 */
export function planHandicapUpdatesFromIrishSailing(
  input: IrishSailingPlanInput,
): PreviewRow[] {
  const targetFleetById = new Map(input.targetFleets.map((f) => [f.id, f]));
  const matcher = new RatingMatcher(input.ratings);
  const matchByName = input.matchByName ?? false;

  const rows: PreviewRow[] = [];

  for (const targetComp of input.targetCompetitors) {
    const matchResult = matcher.match(targetComp, matchByName);

    for (const targetFleetId of targetComp.fleetIds) {
      const targetFleet = targetFleetById.get(targetFleetId);
      if (!targetFleet) continue;
      const system = systemForFleet(targetFleet);
      if (!system) continue;

      // Per-fleet IRC variant; undefined on non-IRC rows.
      const ircVariant =
        system === 'irc' ? input.ircVariantByFleet[targetFleetId] ?? 'spin' : undefined;
      const base = {
        competitorId: targetComp.id,
        targetFleetId,
        system,
        currentTcf: currentTcfFor(targetComp, system),
        ircVariant,
      };

      // Irish Sailing publishes only IRC and ECHO — independent of any match.
      if (system === 'nhc' || system === 'py') {
        rows.push({ ...base, newTcf: null, status: 'not-found', notFoundReason: 'system-not-published' });
        continue;
      }

      if (matchResult.kind === 'none') {
        rows.push({ ...base, newTcf: null, status: 'not-found', notFoundReason: 'no-source-competitor' });
        continue;
      }
      if (matchResult.kind === 'ambiguous') {
        rows.push({ ...base, newTcf: null, status: 'not-found', notFoundReason: 'ambiguous-match' });
        continue;
      }

      const rating = matchResult.rating;
      const newTcf =
        system === 'irc'
          ? (ircVariant === 'non-spin' ? rating.ircNonSpinTcc : rating.ircTcc) ?? null
          : rating.echo ?? null;

      // Annotate non-exact matches so the scorer can verify the boat.
      const match: RatingMatch | undefined =
        matchResult.method === 'exact-sail'
          ? undefined
          : { method: matchResult.method, sail: rating.sailNumber, name: rating.boatName };

      if (newTcf === null) {
        rows.push({ ...base, newTcf: null, status: 'not-found', notFoundReason: 'no-source-value', match });
        continue;
      }

      rows.push({ ...base, newTcf, status: base.currentTcf === newTcf ? 'unchanged' : 'change', match });
    }
  }

  return rows;
}
