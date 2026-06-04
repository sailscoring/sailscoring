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
  withDefaultCountry,
  type IrcTccVariant,
  type SailNumberParts,
} from './rating-match';
import {
  classKey,
  normalizeClassName,
  ryaPyMatcher,
  type ClassMatcher,
} from './rya-py/class-match';
import type { RyaPyClass } from './rya-py/types';
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
export type HandicapSystem = 'nhc' | 'echo' | 'irc' | 'py' | 'vprs';

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
  /** More than one *different* boat in the rating list matched this competitor
   *  (same sail core but differing country prefixes, or same name) and we
   *  can't safely pick one. The scorer should disambiguate by entering the
   *  full sail number. (Multiple certificates for the *same* boat — a primary
   *  plus a secondary — are not ambiguous; see {@link CertChoice}.) */
  | 'ambiguous-match';

/** How a rating-list source matched a competitor to a record. Set on the Irish
 *  Sailing and international IRC sources; `undefined` on the prior-series
 *  source. */
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
  /** Present on an Irish Sailing `irc` row when the boat holds more than one
   *  certificate (a primary plus a secondary "(SC)" — different sail
   *  configurations). Lets the dialog offer a per-boat switch; we default to
   *  the higher TCC. */
  certChoice?: CertChoice;
}

/** One selectable certificate for a boat that holds more than one. */
export interface CertChoiceOption {
  /** IRC certificate number — the stable id used to switch. Falls back to a
   *  synthetic `idx:N` when a record has no number. */
  certId: string;
  /** Display label, e.g. `"#50718 · secondary (SC)"`. */
  label: string;
  /** This certificate's TCC for the row's spin/non-spin variant; `null` if
   *  the certificate has no value for that variant. */
  tcc: number | null;
  /** From the "(SC)" marker on the Irish Sailing boat name. */
  isSecondary: boolean;
}

export interface CertChoice {
  options: CertChoiceOption[];
  /** `certId` of the currently-selected option. */
  chosen: string;
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
    case 'vprs':
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
    case 'vprs':
      return competitor.vprsTcc ?? null;
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
      } else if (system === 'vprs') {
        newTcf = sourceComp.vprsTcc ?? null;
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

// ─── External rating-list sources: Irish Sailing (ECHO) + IRC (international) ──
//
// Two sources share this machinery: the national Irish Sailing list (the only
// source for ECHO, #168) and the worldwide IRC TCC listing (#168 follow-up).
// They differ only in which record type and which handicap system each emits —
// the sail-number / boat-name matching and the primary/secondary certificate
// handling are identical, so both run through the generic core below.

/** The fields the rating-list planners read from a source record. Both
 *  {@link IrishSailingRating} and {@link IrcRatingRecord} satisfy it
 *  structurally. */
export interface RatingRecord {
  sailNumber: string;
  boatName?: string;
  /** Spinnaker IRC TCC. */
  ircTcc?: number;
  /** Non-spinnaker IRC TCC. */
  ircNonSpinTcc?: number;
  ircCertNumber?: string;
  /** ECHO standard (Irish Sailing only). */
  echo?: number;
  /** Explicit secondary-certificate flag (IRC list `Secondary = SEC`). When
   *  absent, {@link isSecondaryCert} falls back to the `"(SC)"` name marker. */
  isSecondary?: boolean;
}

export interface RatingPlanInput {
  targetCompetitors: readonly Competitor[];
  targetFleets: readonly Fleet[];
  /** The rating list (already fetched + parsed). */
  records: readonly RatingRecord[];
  /** Spin/non-spin choice per IRC fleet, keyed by fleet id. A fleet whose
   *  boats race non-spinnaker uses the non-spin TCC; IRC fleets absent from
   *  the map default to spinnaker. Per-fleet (not global) so a series with a
   *  mix of spinnaker and non-spinnaker classes is handled in one pass.
   *  Ignored for ECHO fleets (ECHO has no spin/non-spin split). */
  ircVariantByFleet?: Readonly<Record<string, IrcTccVariant>>;
  /** Opt-in liberal fallback: when a competitor has no sail-number match,
   *  match on boat name instead. Off by default — names collide more readily
   *  than sail numbers, so the dialog gates this behind a toggle. */
  matchByName?: boolean;
  /** Per-competitor certificate override, keyed by competitor id → the chosen
   *  `certId` (see {@link CertChoiceOption}). For boats holding more than one
   *  certificate; when absent we default to the higher-TCC certificate. */
  certChoiceByCompetitor?: Readonly<Record<string, string>>;
  /** Country code to assume for a prefix-less competitor sail number (e.g.
   *  `"IRL"`). Defaults to `''` (assume nothing); the dialog passes
   *  {@link defaultSailCountry}. See {@link withDefaultCountry}. */
  defaultCountry?: string;
}

interface RatingEntry<T extends RatingRecord> {
  record: T;
  parts: SailNumberParts;
}

type MatchResult<T extends RatingRecord> =
  // One boat (a single sail number), holding one or more certificates. More
  // than one means a primary + secondary — a cert *choice*, not an ambiguity.
  | { kind: 'matched'; records: T[]; method: RatingMatchMethod }
  // Multiple *different* boats matched (differing prefixes, or name collision).
  | { kind: 'ambiguous' }
  | { kind: 'none' };

/** Unique full sail numbers among a set of candidates — used to tell "one boat,
 *  several certs" apart from "several boats". */
function distinctFullSails<T extends RatingRecord>(
  entries: readonly RatingEntry<T>[],
): Set<string> {
  return new Set(entries.map((e) => e.parts.full));
}

/**
 * Match indexes over a rating list, built once per plan. Sail numbers are
 * indexed by their numeric core so a country-code-less competitor (`"1431"`)
 * finds `"IRL1431"`; names are indexed for the opt-in fallback.
 *
 * `defaultCountry`, when set, is the prefix assumed for a competitor whose sail
 * number has none — so on an Irish instance `"1431"` resolves to the Irish boat
 * in the worldwide list rather than matching every `…1431` across all nations.
 */
class RatingMatcher<T extends RatingRecord> {
  private readonly byCore = new Map<string, RatingEntry<T>[]>();
  private readonly byName = new Map<string, RatingEntry<T>[]>();

  constructor(
    records: readonly T[],
    private readonly defaultCountry: string = '',
  ) {
    for (const record of records) {
      const parts = sailNumberParts(record.sailNumber);
      const entry: RatingEntry<T> = { record, parts };
      if (parts.core) push(this.byCore, parts.core, entry);
      const name = normalizeBoatName(record.boatName);
      if (name) push(this.byName, name, entry);
    }
  }

  match(competitor: Competitor, matchByName: boolean): MatchResult<T> {
    // Keep the raw parts (what the scorer typed) to decide whether the match
    // was exact, but resolve against the default-country-filled parts.
    const rawParts = sailNumberParts(competitor.sailNumber);
    const parts = withDefaultCountry(rawParts, this.defaultCountry);
    const sailCandidates = (this.byCore.get(parts.core) ?? []).filter((e) =>
      sailNumbersMatch(parts, e.parts),
    );

    if (sailCandidates.length > 0) {
      const fulls = distinctFullSails(sailCandidates);
      if (fulls.size === 1) {
        // One boat — possibly several certificates (primary + secondary).
        const method: RatingMatchMethod =
          sailCandidates[0].parts.full === rawParts.full ? 'exact-sail' : 'sail-no-country';
        return { kind: 'matched', records: sailCandidates.map((e) => e.record), method };
      }
      // Several *different* boats share this sail core. Try to narrow to one
      // boat by name (opt-in); otherwise it's a genuine ambiguity.
      if (matchByName) {
        const narrowed = this.narrowByName(sailCandidates, competitor.boatName);
        if (narrowed) return { kind: 'matched', records: narrowed, method: 'sail-no-country' };
      }
      return { kind: 'ambiguous' };
    }

    // No sail match — optional liberal name fallback.
    if (matchByName) {
      const name = normalizeBoatName(competitor.boatName);
      const nameCandidates = name ? this.byName.get(name) ?? [] : [];
      if (nameCandidates.length === 0) return { kind: 'none' };
      const narrowed = this.narrowByName(nameCandidates, competitor.boatName);
      if (narrowed) return { kind: 'matched', records: narrowed, method: 'name' };
      return { kind: 'ambiguous' };
    }

    return { kind: 'none' };
  }

  /** Among candidates spanning several boats, keep only those whose name
   *  matches the competitor's, and return them iff they're all one boat. */
  private narrowByName(
    candidates: readonly RatingEntry<T>[],
    boatName: string | undefined,
  ): T[] | null {
    const name = normalizeBoatName(boatName);
    if (!name) return null;
    const hits = candidates.filter((e) => normalizeBoatName(e.record.boatName) === name);
    if (hits.length > 0 && distinctFullSails(hits).size === 1) {
      return hits.map((e) => e.record);
    }
    return null;
  }
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** A boat's TCC for a given spin/non-spin variant. */
function tccForVariant(record: RatingRecord, variant: IrcTccVariant): number | null {
  return (variant === 'non-spin' ? record.ircNonSpinTcc : record.ircTcc) ?? null;
}

/** Whether a record is a secondary certificate (an alternative sail
 *  configuration). The IRC list carries an explicit `Secondary = SEC` flag; the
 *  Irish Sailing list instead marks it with a trailing `"(SC)"` on the boat
 *  name, so we fall back to that when no flag is present. */
function isSecondaryCert(record: RatingRecord): boolean {
  if (record.isSecondary !== undefined) return record.isSecondary;
  return /\(sc\)\s*$/i.test(record.boatName ?? '');
}

/** Stable id for a certificate within a boat's set — its IRC cert number, or a
 *  positional fallback when absent. */
function certId(record: RatingRecord, index: number): string {
  return record.ircCertNumber ? `cert:${record.ircCertNumber}` : `idx:${index}`;
}

/** Build the per-boat certificate switch for an IRC row, given the resolved
 *  index and the variant the TCCs should be shown in. */
function buildCertChoice(
  records: readonly RatingRecord[],
  variant: IrcTccVariant,
  chosenIndex: number,
): CertChoice {
  return {
    chosen: certId(records[chosenIndex], chosenIndex),
    options: records.map((r, i) => ({
      certId: certId(r, i),
      label: `${r.ircCertNumber ? `#${r.ircCertNumber}` : '—'} · ${isSecondaryCert(r) ? 'secondary' : 'primary'}`,
      tcc: tccForVariant(r, variant),
      isSecondary: isSecondaryCert(r),
    })),
  };
}

/** Allowed-system sets for the two rating-list sources. */
const IRC_ONLY: ReadonlySet<HandicapSystem> = new Set<HandicapSystem>(['irc']);
const ECHO_ONLY: ReadonlySet<HandicapSystem> = new Set<HandicapSystem>(['echo']);

/**
 * Produce preview rows for a rating-list source (Irish Sailing ECHO or
 * international IRC). Unlike the prior-series source there is no fleet mapping —
 * the list is a flat table matched by sail number, tolerant of a missing
 * country code (`"1431"` ↔ `"IRL1431"`, resolved via the instance's default
 * country), with an opt-in name fallback. `allowed` restricts which fleet
 * systems produce rows; fleets of any other system are skipped silently.
 *
 * Per allowed target `(competitor, fleet)`:
 * - `irc`  → the chosen certificate's spin/non-spin TCC, per `ircVariant`. A
 *   boat holding a primary plus a secondary certificate defaults to the higher
 *   TCC and carries a {@link CertChoice} so the scorer can switch.
 * - `echo` → the boat's published ECHO standard.
 *
 * Boats absent from the list surface as `no-source-competitor`; matches to
 * several *different* boats as `ambiguous-match`; a matched boat lacking the
 * relevant value as `no-source-value`. Non-exact matches carry a `match`
 * annotation so the dialog can show the basis for the scorer to verify.
 */
function planRatingUpdates(
  input: RatingPlanInput,
  allowed: ReadonlySet<HandicapSystem>,
): PreviewRow[] {
  const targetFleetById = new Map(input.targetFleets.map((f) => [f.id, f]));
  const matcher = new RatingMatcher(input.records, input.defaultCountry ?? '');
  const matchByName = input.matchByName ?? false;
  const ircVariantByFleet = input.ircVariantByFleet ?? {};
  const certChoiceByCompetitor = input.certChoiceByCompetitor ?? {};

  const rows: PreviewRow[] = [];

  for (const targetComp of input.targetCompetitors) {
    const matchResult = matcher.match(targetComp, matchByName);

    for (const targetFleetId of targetComp.fleetIds) {
      const targetFleet = targetFleetById.get(targetFleetId);
      if (!targetFleet) continue;
      const system = systemForFleet(targetFleet);
      if (!system || !allowed.has(system)) continue;

      // Per-fleet IRC variant; undefined on ECHO rows.
      const ircVariant = system === 'irc' ? ircVariantByFleet[targetFleetId] ?? 'spin' : undefined;
      const base = {
        competitorId: targetComp.id,
        targetFleetId,
        system,
        currentTcf: currentTcfFor(targetComp, system),
        ircVariant,
      };

      if (matchResult.kind === 'none') {
        rows.push({ ...base, newTcf: null, status: 'not-found', notFoundReason: 'no-source-competitor' });
        continue;
      }
      if (matchResult.kind === 'ambiguous') {
        rows.push({ ...base, newTcf: null, status: 'not-found', notFoundReason: 'ambiguous-match' });
        continue;
      }

      const records = matchResult.records;

      // Pick the certificate: an explicit per-boat override if it names one of
      // this boat's certs, otherwise the higher-TCC default (for IRC, by the
      // row's variant; for ECHO the value is the same across certs).
      const rankVariant: IrcTccVariant = ircVariant ?? 'spin';
      const override = certChoiceByCompetitor[targetComp.id];
      const chosenIndex = pickCertIndex(records, rankVariant, override);
      const record = records[chosenIndex];

      // Offer a switch only for IRC rows where the boat has more than one cert.
      const certChoice =
        system === 'irc' && records.length > 1
          ? buildCertChoice(records, rankVariant, chosenIndex)
          : undefined;

      const newTcf = system === 'irc' ? tccForVariant(record, ircVariant!) : record.echo ?? null;

      // Annotate non-exact matches so the scorer can verify the boat.
      const match: RatingMatch | undefined =
        matchResult.method === 'exact-sail'
          ? undefined
          : { method: matchResult.method, sail: record.sailNumber, name: record.boatName };

      if (newTcf === null) {
        rows.push({ ...base, newTcf: null, status: 'not-found', notFoundReason: 'no-source-value', match, certChoice });
        continue;
      }

      rows.push({
        ...base,
        newTcf,
        status: base.currentTcf === newTcf ? 'unchanged' : 'change',
        match,
        certChoice,
      });
    }
  }

  return rows;
}

/**
 * Preview rows for the international IRC source (the worldwide ClubListing).
 * One row per target IRC fleet membership; spin/non-spin per fleet;
 * primary/secondary certificate switch. Non-IRC fleets produce no rows.
 */
export function planIrcUpdates(input: RatingPlanInput): PreviewRow[] {
  return planRatingUpdates(input, IRC_ONLY);
}

/**
 * Preview rows for the Irish Sailing ECHO source. One row per target ECHO fleet
 * membership, seeded from the boat's published ECHO standard. IRC/NHC/PY fleets
 * produce no rows — IRC now comes from the international source, and Irish
 * Sailing publishes neither NHC nor PY.
 */
export function planEchoUpdates(input: RatingPlanInput): PreviewRow[] {
  return planRatingUpdates(input, ECHO_ONLY);
}

/**
 * Choose which certificate to use for a boat holding several. An `override`
 * `certId` wins when it names one of them; otherwise the default is the
 * certificate with the higher TCC for `variant` (nulls rank last). Returns the
 * index into `ratings`.
 */
function pickCertIndex(
  records: readonly RatingRecord[],
  variant: IrcTccVariant,
  override: string | undefined,
): number {
  if (override) {
    const i = records.findIndex((r, idx) => certId(r, idx) === override);
    if (i >= 0) return i;
  }
  let best = 0;
  let bestTcc = tccForVariant(records[0], variant);
  for (let i = 1; i < records.length; i++) {
    const tcc = tccForVariant(records[i], variant);
    if (tcc !== null && (bestTcc === null || tcc > bestTcc)) {
      best = i;
      bestTcc = tcc;
    }
  }
  return best;
}

// ─── Add-to-fleet candidates (#170) ──────────────────────────────────────────

/** The handicap systems a boat can be *added* to a fleet for: IRC from the
 *  international list, ECHO from Irish Sailing. */
export type AddableSystem = 'irc' | 'echo';

export interface FleetAdditionInput {
  targetCompetitors: readonly Competitor[];
  targetFleets: readonly Fleet[];
  records: readonly RatingRecord[];
  /** Spin/non-spin per IRC fleet — the chosen target fleet's variant decides
   *  which TCC seeds an IRC addition. */
  ircVariantByFleet?: Readonly<Record<string, IrcTccVariant>>;
  matchByName?: boolean;
  /** Shared with the update path so a boat's primary/secondary choice is
   *  consistent across both. */
  certChoiceByCompetitor?: Readonly<Record<string, string>>;
  /** Per-candidate chosen target fleet, keyed by {@link additionKey}. */
  targetFleetByKey?: Readonly<Record<string, string>>;
  /** Country to assume for a prefix-less competitor sail number. See
   *  {@link withDefaultCountry}. */
  defaultCountry?: string;
}

export interface FleetAdditionCandidate {
  competitorId: string;
  system: AddableSystem;
  /** Fleets of this system the boat could join. */
  fleetOptions: { fleetId: string; name: string }[];
  /** The chosen target fleet, or the sole option, or `null` when several
   *  exist and the scorer hasn't picked. */
  targetFleetId: string | null;
  /** Rating to seed for the (chosen) target fleet; `null` when no fleet is
   *  chosen yet or the certificate has no value for that fleet's variant. */
  proposedTcf: number | null;
  /** Non-exact match basis, for the scorer to verify (reused). */
  match?: RatingMatch;
  /** IRC primary/secondary switch (reused). */
  certChoice?: CertChoice;
}

/** Stable key for a `(competitor, system)` addition candidate. */
export function additionKey(competitorId: string, system: AddableSystem): string {
  return `${competitorId}::add::${system}`;
}

/**
 * Find boats that hold a certificate for a system the series scores, but aren't
 * yet in any fleet of that system — candidates to add (#170).
 *
 * A candidate per `(competitor, system)` in `systems` where: the boat matches a
 * record, the series has ≥1 fleet of that system, the boat is in none of them,
 * and the certificate carries a value for that system. IRC and ECHO are
 * independent and sourced separately, so each caller passes the single system
 * its list covers. The seeded value tracks the chosen target fleet's
 * spin/non-spin variant and the boat's certificate choice — same logic as the
 * update path.
 */
function planFleetAdditions(
  input: FleetAdditionInput,
  systems: readonly AddableSystem[],
): FleetAdditionCandidate[] {
  const matcher = new RatingMatcher(input.records, input.defaultCountry ?? '');
  const matchByName = input.matchByName ?? false;
  const ircVariantByFleet = input.ircVariantByFleet ?? {};
  const certChoiceByCompetitor = input.certChoiceByCompetitor ?? {};
  const targetFleetByKey = input.targetFleetByKey ?? {};

  const fleetSystemById = new Map<string, Fleet['scoringSystem']>();
  const fleetsBySystem: Record<AddableSystem, { fleetId: string; name: string }[]> = { irc: [], echo: [] };
  for (const f of input.targetFleets) {
    fleetSystemById.set(f.id, f.scoringSystem);
    if (f.scoringSystem === 'irc' || f.scoringSystem === 'echo') {
      fleetsBySystem[f.scoringSystem].push({ fleetId: f.id, name: f.name });
    }
  }

  const candidates: FleetAdditionCandidate[] = [];

  for (const comp of input.targetCompetitors) {
    const match = matcher.match(comp, matchByName);
    if (match.kind !== 'matched') continue;
    const records = match.records;

    const memberSystems = new Set<string>();
    for (const fid of comp.fleetIds) {
      const s = fleetSystemById.get(fid);
      if (s) memberSystems.add(s);
    }

    const matchAnno: RatingMatch | undefined =
      match.method === 'exact-sail'
        ? undefined
        : { method: match.method, sail: records[0].sailNumber, name: records[0].boatName };

    for (const system of systems) {
      const fleetOptions = fleetsBySystem[system];
      if (fleetOptions.length === 0) continue; // series scores no such fleet
      if (memberSystems.has(system)) continue; // already in one — update path's job

      // Is there a value to seed at all?
      const hasValue =
        system === 'echo'
          ? records.some((r) => r.echo != null)
          : records.some((r) => r.ircTcc != null || r.ircNonSpinTcc != null);
      if (!hasValue) continue;

      const key = additionKey(comp.id, system);
      const targetFleetId =
        targetFleetByKey[key] ?? (fleetOptions.length === 1 ? fleetOptions[0].fleetId : null);

      let proposedTcf: number | null;
      let certChoice: CertChoice | undefined;
      if (system === 'echo') {
        proposedTcf = records.find((r) => r.echo != null)?.echo ?? null;
      } else {
        const variant: IrcTccVariant =
          targetFleetId ? ircVariantByFleet[targetFleetId] ?? 'spin' : 'spin';
        const idx = pickCertIndex(records, variant, certChoiceByCompetitor[comp.id]);
        proposedTcf = tccForVariant(records[idx], variant);
        if (records.length > 1) certChoice = buildCertChoice(records, variant, idx);
      }

      candidates.push({
        competitorId: comp.id,
        system,
        fleetOptions,
        targetFleetId,
        proposedTcf,
        match: matchAnno,
        certChoice,
      });
    }
  }

  return candidates;
}

/** Add-to-IRC-fleet candidates from the international IRC list (#170). */
export function planIrcFleetAdditions(input: FleetAdditionInput): FleetAdditionCandidate[] {
  return planFleetAdditions(input, ['irc']);
}

/** Add-to-ECHO-fleet candidates from the Irish Sailing list (#170). */
export function planEchoFleetAdditions(input: FleetAdditionInput): FleetAdditionCandidate[] {
  return planFleetAdditions(input, ['echo']);
}

// ─── RYA Portsmouth Yardstick source ──────────────────────────────────────────
//
// Unlike the rating-list sources above, the RYA PY list is matched by *class*,
// not by sail number, and is bundled into the build rather than fetched (it
// changes at most once a year). So a whole one-design fleet collapses to a
// single proposal, and each proposal can update two competitor fields — the PY
// number and (optionally) the class name, normalised to the register spelling.

export interface RyaPyPlanInput {
  targetCompetitors: readonly Competitor[];
  targetFleets: readonly Fleet[];
  /** The class matcher (defaults to the bundled RYA dataset; injectable in tests). */
  matcher?: ClassMatcher;
  /** Manual resolution for ambiguous / unmatched classes, keyed by a group's
   *  `enteredKey`. The value is the chosen class's {@link classKey}, or
   *  `'__skip__'` to leave the group's boats untouched. A unique auto-match can
   *  also be overridden here. */
  chosenByClass?: Readonly<Record<string, string>>;
}

/** One distinct boat class found across the series' PY fleets, with its
 *  proposed RYA resolution and the boats it covers. The review unit of the PY
 *  source — the dialog renders one row per proposal. */
export interface PyClassProposal {
  /** A representative spelling as entered on the boats (the first seen). */
  enteredClass: string;
  /** Normalised group key — stable id for the dialog's picker + toggle state. */
  enteredKey: string;
  /** How the entered class resolved against the register before any manual pick. */
  matchStatus: 'matched' | 'ambiguous' | 'none';
  /** For a unique match, whether it was on the canonical name or a looser alias. */
  via?: 'name' | 'alias';
  /** The resolved class — a unique match, or the scorer's manual pick; `null`
   *  when ambiguous/unmatched and not yet resolved, or explicitly skipped. */
  resolved: RyaPyClass | null;
  /** Candidates when ambiguous (empty otherwise — the dialog offers the full list). */
  candidates: RyaPyClass[];
  /** The boats in PY fleets carrying this class, with their current PY number. */
  affected: { competitorId: string; fleetId: string; currentNumber: number | null }[];
}

/**
 * Group every PY-fleet boat by its (normalised) class, match each distinct
 * class once against the RYA register, and return a proposal per class. Boats
 * with no class set, and non-PY fleets, are ignored. Resolution honours
 * `chosenByClass` overrides (including `'__skip__'`); a unique auto-match needs
 * no override. The dialog turns each resolved proposal into per-boat writes of
 * the PY number and/or the canonical class name.
 */
export function planRyaPyUpdates(input: RyaPyPlanInput): PyClassProposal[] {
  const matcher = input.matcher ?? ryaPyMatcher;
  const chosen = input.chosenByClass ?? {};
  const byClassKey = new Map(matcher.all().map((c) => [classKey(c), c] as const));

  const pyFleetIds = new Set(
    input.targetFleets.filter((f) => f.scoringSystem === 'py').map((f) => f.id),
  );
  if (pyFleetIds.size === 0) return [];

  // Group affected (competitor, fleet) pairs by normalised class.
  interface Group {
    enteredClass: string;
    affected: PyClassProposal['affected'];
  }
  const groups = new Map<string, Group>();
  for (const c of input.targetCompetitors) {
    const entered = c.boatClass?.trim();
    if (!entered) continue;
    const key = normalizeClassName(entered);
    if (!key) continue;
    for (const fleetId of c.fleetIds) {
      if (!pyFleetIds.has(fleetId)) continue;
      let g = groups.get(key);
      if (!g) {
        g = { enteredClass: entered, affected: [] };
        groups.set(key, g);
      }
      g.affected.push({ competitorId: c.id, fleetId, currentNumber: c.pyNumber ?? null });
    }
  }

  const proposals: PyClassProposal[] = [];
  for (const [enteredKey, g] of groups) {
    const m = matcher.match(g.enteredClass);
    const matchStatus = m.kind;
    const via = m.kind === 'matched' ? m.via : undefined;
    const candidates = m.kind === 'ambiguous' ? m.candidates : [];

    // Resolve: manual override wins (including an explicit skip); otherwise the
    // unique auto-match, or null when ambiguous/unmatched.
    let resolved: RyaPyClass | null = m.kind === 'matched' ? m.cls : null;
    const override = chosen[enteredKey];
    if (override === '__skip__') resolved = null;
    else if (override) resolved = byClassKey.get(override) ?? resolved;

    proposals.push({
      enteredClass: g.enteredClass,
      enteredKey,
      matchStatus,
      via,
      resolved,
      candidates,
      affected: g.affected,
    });
  }

  proposals.sort((a, b) => a.enteredClass.localeCompare(b.enteredClass));
  return proposals;
}
