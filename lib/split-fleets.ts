// Split-fleet (qualifying/final series) scoring engine.
// See docs/design/split-fleets.md and docs/design/ux/flows/split-fleets.md.
// Scope (#328): all three carry modes (continuous points, net+net,
// carried qualifying rank); RDG average points per RRS A9(a)/(b);
// SCP/DPI/ZFP penalties; A8.1+A8.2 tie-breaking; the validity gate as the
// ILCA equalisation (a qualifying race doesn't count until every fleet has
// completed it — the IODA exclude-most-recent variant is deferred).

import type { Competitor, Finish, Fleet, Race, RaceStart } from './types';
import { compareSailNumbersIgnoringPrefix } from './sail-number-sort';
import { applyAdditivePenalty } from './scoring';

export type SeriesStage = 'qualifying' | 'final' | 'medal';

/** Stored on series.qf_config — the split-fleet series' full scoring
 *  configuration (docs/design/split-fleets.md). */
export interface SplitFleetConfig {
  /** Qualifying fleet labels in SI order (the reassignment-pattern order). */
  qualifyingFleets: { label: string; color: string }[];
  /** Final fleet labels in tier order (Gold first). */
  finalFleets: { label: string; color: string }[];
  /** Planned schedule: races per day for the day strip. */
  plannedDays: { label: string; races: number }[];
  /** How qualifying results enter the championship score.
   *  - `points` — one continuous series: every qualifying and final race
   *    score totals into the championship, discards over the combined line
   *    (ILCA, Optimist).
   *  - `net-plus-net` — the qualifying and final series are scored as two
   *    series, each with its own discards, and the championship score is
   *    their sum (29er and similar).
   *  - `rank-seed` — a boat's finishing position in the qualifying series
   *    carries into the final series as one non-excludable score, and her
   *    qualifying race scores drop out (470, Topper). */
  carry: 'points' | 'net-plus-net' | 'rank-seed';
  /** Final-fleet sizing: near-equal blocks (Gold largest), or a fixed
   *  top-fleet size (49er/29er). The split ceremony seeds from this and the
   *  scorer may adjust before committing. */
  split: { kind: 'equal-blocks' } | { kind: 'fixed-top'; topSize: number };
  /** RRS A5.2 replacement bases per stage. `final: 'largest-qualifying'` is
   *  the pre-2026 IODA practice (largest qualifying fleet base in both
   *  stages). */
  codeBasis: {
    qualifying: 'largest-fleet' | 'fixed';
    fixedPoints?: number;
    final: 'own-fleet' | 'largest-qualifying';
  };
  /** End-of-qualifying equalisation. Only 'abandon-extra-races' (the ILCA
   *  A2.8 behaviour, expressed by the validity gate) is implemented;
   *  'exclude-extra-scores' (IODA/LE) is documented and deferred. */
  equalization: 'abandon-extra-races' | 'exclude-extra-scores';
  /** Discard thresholds over the combined line: [{minRaces, discardCount}].
   *  Medal races neither count toward these thresholds nor may be discarded. */
  discardThresholds: { minRaces: number; discardCount: number }[];
  /** Max discards that may fall on final-series races (ILCA: 1). */
  maxFinalDiscards: number;
  /** A lone completed final race may not be discarded (ILCA). */
  protectLoneFinalRace: boolean;
  /** How ties that survive RRS A8 are ordered when a ranking feeds an
   *  assignment: registration/seeding order, or LE's fleet-order scatter. */
  reassignmentTieOrder: 'a8-then-entry-order' | 'fleet-order';
  /** Medal config; absent = no medal phase. `raceCount` is a planning hint —
   *  the medal phase can add races beyond it. */
  medal?: { size: number; raceCount: number; multiplier: number };
}

export interface SplitRound {
  id: string;
  seriesId: string;
  stage: SeriesStage;
  fromStageRace: number;
  /** The round's fleets in SI/tier order. */
  fleetIds: string[];
  method: 'seeded' | 'rank-pattern' | 'split' | 'medal-select' | 'manual';
  basis: { throughStageRace: number; capturedAt: number } | null;
  /** Manual placements layered over the computed assignment (late entry,
   *  RC/jury move, redress promotion): competitorId → fleetId. The stored
   *  fleet memberships already reflect these; the map records which boats
   *  were hand-placed so the round card can show computed-vs-override. */
  overrides?: Record<string, string>;
  /** When the round's assignment lists were published (rolling page). */
  publishedAt?: number;
  createdAt: number;
}

export const QUALIFYING_COLOR_SETS: { label: string; color: string }[] = [
  { label: 'Yellow', color: '#eab308' },
  { label: 'Blue', color: '#3b82f6' },
  { label: 'Red', color: '#ef4444' },
  { label: 'Green', color: '#22c55e' },
];

export const FINAL_FLEET_SET: { label: string; color: string }[] = [
  { label: 'Gold', color: '#ca8a04' },
  { label: 'Silver', color: '#94a3b8' },
  { label: 'Bronze', color: '#b45309' },
  { label: 'Emerald', color: '#059669' },
];

export function defaultSplitFleetConfig(fleetCount: number): SplitFleetConfig {
  return {
    qualifyingFleets: QUALIFYING_COLOR_SETS.slice(0, fleetCount),
    finalFleets: FINAL_FLEET_SET.slice(0, fleetCount),
    plannedDays: Array.from({ length: 6 }, (_, i) => ({
      label: `Day ${i + 1}`,
      races: 2,
    })),
    carry: 'points',
    split: { kind: 'equal-blocks' },
    codeBasis: { qualifying: 'largest-fleet', final: 'own-fleet' },
    equalization: 'abandon-extra-races',
    discardThresholds: [
      { minRaces: 4, discardCount: 1 },
      { minRaces: 10, discardCount: 2 },
    ],
    maxFinalDiscards: 1,
    protectLoneFinalRace: true,
    reassignmentTieOrder: 'a8-then-entry-order',
    medal: { size: 10, raceCount: 1, multiplier: 2 },
  };
}

/** Fill defaults for configs stored before the full surface existed (the
 *  prototype's sparse shape). Reading old rows through this keeps them
 *  scoring identically. */
export function normalizeSplitFleetConfig(raw: Partial<SplitFleetConfig>): SplitFleetConfig {
  const d = defaultSplitFleetConfig(raw.qualifyingFleets?.length ?? 3);
  return {
    ...d,
    ...raw,
    carry: raw.carry ?? 'points',
    split: raw.split ?? { kind: 'equal-blocks' },
    codeBasis: raw.codeBasis ?? { qualifying: 'largest-fleet', final: 'own-fleet' },
    equalization: raw.equalization ?? 'abandon-extra-races',
    protectLoneFinalRace: raw.protectLoneFinalRace ?? false,
    reassignmentTieOrder: raw.reassignmentTieOrder ?? 'a8-then-entry-order',
    medal: raw.medal,
  } as SplitFleetConfig;
}

/** The IODA preset: 4 fleets, one discard unlocked at 5 races (never a
 *  second), no medal race. */
export function iodaSplitFleetConfig(fleetCount: number): SplitFleetConfig {
  return {
    ...defaultSplitFleetConfig(fleetCount),
    discardThresholds: [{ minRaces: 5, discardCount: 1 }],
    medal: undefined,
  };
}

// ---------------------------------------------------------------------------
// Assignment

/** Rank index (0-based) → fleet index, walking down the fleet list and back
 *  (1 Yellow, 2 Blue, 3 Red, 4 Red, 5 Blue, 6 Yellow, 7 Yellow, …). */
export function rankPatternFleetIndex(rankIndex: number, fleetCount: number): number {
  const cycle = 2 * fleetCount;
  const pos = rankIndex % cycle;
  return pos < fleetCount ? pos : cycle - 1 - pos;
}

/** Distribute an ordered competitor list into `fleetCount` fleets by the
 *  reassignment pattern. Returns one array of competitor ids per fleet,
 *  in the given fleet order. */
export function assignByRankPattern(orderedIds: string[], fleetCount: number): string[][] {
  const fleets: string[][] = Array.from({ length: fleetCount }, () => []);
  orderedIds.forEach((id, i) => fleets[rankPatternFleetIndex(i, fleetCount)].push(id));
  return fleets;
}

export type SeedOrder = 'seed-rank' | 'sail-number' | 'nationality-spread' | 'entry-order';

/** Initial seeding order. Prototype sources: numeric-ish sail-number order,
 *  nationality-then-sail (spreads compatriots across fleets when fed through
 *  the rank pattern), or plain entry order. */
/** Fleets not owned by a split round — what general-purpose fleet pickers
 *  (competitor assignment, start sequences, publishing groups, prize
 *  conditions) should offer. Round fleets' membership belongs to the Split
 *  Fleets ceremonies. */
export function pickableFleets<T extends { splitRoundId?: string }>(fleets: T[]): T[] {
  return fleets.filter((f) => !f.splitRoundId);
}

/** How sailors the seeding rank doesn't reach are ordered among themselves.
 *  They sort below every ranked sailor either way; this decides the order
 *  within that tail. At a championship where boats are chartered the sail
 *  number carries no information, so spreading compatriots is the useful
 *  choice — otherwise the unranked tail hands one fleet a national bloc. */
export type SeedTailOrder = 'sail-number' | 'nationality-spread';

export function seedOrder(
  competitors: Competitor[],
  order: SeedOrder,
  tailOrder: SeedTailOrder = 'sail-number',
): string[] {
  // Deliberately prefix-blind: at a championship where boats are chartered
  // the national letters say nothing about the boat, and grouping by nation
  // is the outcome seeding exists to avoid.
  const bySail = (a: Competitor, b: Competitor) =>
    compareSailNumbersIgnoringPrefix(a.sailNumber, b.sailNumber);
  const byNationality = (a: Competitor, b: Competitor) =>
    (a.nationality ?? '').localeCompare(b.nationality ?? '') || bySail(a, b);
  const sorted = [...competitors];
  if (order === 'seed-rank') {
    const tail = tailOrder === 'nationality-spread' ? byNationality : bySail;
    sorted.sort((a, b) => {
      const ra = a.seed ?? Infinity;
      const rb = b.seed ?? Infinity;
      if (ra !== rb) return ra - rb;
      // Both unranked: the tail order decides. Both ranked and equal can only
      // happen if two seeds collide, where sail number is as good as anything.
      return ra === Infinity ? tail(a, b) : bySail(a, b);
    });
  }
  else if (order === 'sail-number') sorted.sort(bySail);
  else if (order === 'nationality-spread')
    sorted.sort(
      (a, b) => (a.nationality ?? '').localeCompare(b.nationality ?? '') || bySail(a, b),
    );
  else sorted.sort((a, b) => a.createdAt - b.createdAt);
  return sorted.map((c) => c.id);
}

/** Near-equal final-fleet block sizes: earlier fleets never smaller than
 *  later ones (Gold ≥ Silver ≥ Bronze). */
export function finalBlockSizes(total: number, fleetCount: number): number[] {
  const base = Math.floor(total / fleetCount);
  const rem = total % fleetCount;
  return Array.from({ length: fleetCount }, (_, i) => base + (i < rem ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Scoring

/** One physical race: one fleet's sailing of a stage race. A stored `Race`
 *  is the on-water start sequence; the start carries which stage race its
 *  fleets are sailing, so the (race, start, fleet) triple is the scoring
 *  unit. */
export interface StageRaceRef {
  race: Race;
  start: RaceStart;
  fleetId: string;
}

export interface LogicalRace {
  stageRaceNumber: number;
  round: SplitRound | null;
  /** fleetId → physical race (may miss fleets that haven't got one yet). */
  races: Map<string, StageRaceRef>;
  /** Every fleet of the covering round has a completed physical race. */
  valid: boolean;
}

export interface SplitFleetData {
  config: SplitFleetConfig;
  rounds: SplitRound[];
  fleets: Fleet[];
  competitors: Competitor[];
  /** The series' races — the lookup behind the starts; a race is one start
   *  sequence and may hold several fleets' stage races. */
  races: Race[];
  /** All starts; those with `stage` set carry the split-fleet identity. */
  raceStarts: RaceStart[];
  finishes: Finish[];
}

/** Enumerate the physical races — one ref per (race, start, fleet) for every
 *  start carrying a stage identity, optionally restricted to one stage. */
export function stageRaceRefs(data: SplitFleetData, stage?: SeriesStage): StageRaceRef[] {
  const raceById = new Map(data.races.map((r) => [r.id, r]));
  const refs: StageRaceRef[] = [];
  for (const start of data.raceStarts) {
    if (!start.stage || start.stageRaceNumber == null) continue;
    if (stage && start.stage !== stage) continue;
    const race = raceById.get(start.raceId);
    if (!race) continue;
    for (const fleetId of start.fleetIds) refs.push({ race, start, fleetId });
  }
  return refs;
}

export function roundsForStage(rounds: SplitRound[], stage: SeriesStage): SplitRound[] {
  return rounds
    .filter((r) => r.stage === stage)
    .sort((a, b) => a.fromStageRace - b.fromStageRace || a.createdAt - b.createdAt);
}

export function coveringRound(
  rounds: SplitRound[],
  stage: SeriesStage,
  stageRaceNumber: number,
): SplitRound | null {
  const eligible = roundsForStage(rounds, stage).filter(
    (r) => r.fromStageRace <= stageRaceNumber,
  );
  return eligible.length ? eligible[eligible.length - 1] : null;
}

/** A physical race is complete when its fleet has rows on the race's sheet
 *  (a crossing or a code). Per fleet: one sequence's combined sheet may
 *  complete some of its fleets before others. */
export function physicalRaceCompleted(
  ref: StageRaceRef,
  competitors: Competitor[],
  finishes: Finish[],
): boolean {
  const members = new Set(
    competitors.filter((c) => c.fleetIds.includes(ref.fleetId)).map((c) => c.id),
  );
  return finishes.some(
    (f) =>
      f.raceId === ref.race.id &&
      f.competitorId !== null &&
      members.has(f.competitorId) &&
      (f.sortOrder !== null || f.resultCode !== null),
  );
}

/** Group a stage's physical races into logical races with validity. Two
 *  starts can claim the same (fleet, stage race number) — an abandoned
 *  attempt lingering beside its resail — so the grouping prefers a complete
 *  physical race over an incomplete one, and the later-created race (the
 *  resail) among equals, rather than depending on start order. */
export function logicalRaces(data: SplitFleetData, stage: SeriesStage): LogicalRace[] {
  const prefer = (a: StageRaceRef | undefined, b: StageRaceRef): StageRaceRef => {
    if (!a) return b;
    const aDone = physicalRaceCompleted(a, data.competitors, data.finishes);
    const bDone = physicalRaceCompleted(b, data.competitors, data.finishes);
    if (aDone !== bDone) return aDone ? a : b;
    return b.race.raceNumber >= a.race.raceNumber ? b : a;
  };
  const byNumber = new Map<number, Map<string, StageRaceRef>>();
  for (const ref of stageRaceRefs(data, stage)) {
    let entry = byNumber.get(ref.start.stageRaceNumber!);
    if (!entry) byNumber.set(ref.start.stageRaceNumber!, (entry = new Map()));
    entry.set(ref.fleetId, prefer(entry.get(ref.fleetId), ref));
  }
  return [...byNumber.entries()]
    .sort(([a], [b]) => a - b)
    .map(([stageRaceNumber, races]) => {
      const round = coveringRound(data.rounds, stage, stageRaceNumber);
      const valid =
        !!round &&
        round.fleetIds.every((fid) => {
          const ref = races.get(fid);
          return !!ref && physicalRaceCompleted(ref, data.competitors, data.finishes);
        });
      return { stageRaceNumber, round, races, valid };
    });
}

export function fleetMembers(competitors: Competitor[], fleetId: string): Competitor[] {
  return competitors.filter((c) => c.fleetIds.includes(fleetId));
}

function largestFleetSize(data: SplitFleetData, round: SplitRound): number {
  return Math.max(...round.fleetIds.map((fid) => fleetMembers(data.competitors, fid).length));
}

export interface CellScore {
  stage: SeriesStage;
  stageRaceNumber: number;
  fleetId: string;
  raceId: string;
  points: number;
  code: string | null; // 'DNC', a result/penalty code, or 'RDG'
  discarded: boolean;
  counts: boolean; // false while the logical race is not yet valid
  discardable: boolean;
  /** `rank-seed` carry: this cell is the qualifying-series position carried
   *  into the final series, not a race result. */
  carriedRank?: boolean;
  /** `rank-seed` carry: a qualifying race score replaced by the carried
   *  rank. Shown, but out of the championship score. */
  superseded?: boolean;
  /** The RDG finish awaiting A9 resolution (engine-internal). */
  rdg?: Finish | null;
}

export interface SplitStandingRow {
  competitor: Competitor;
  cells: CellScore[];
  total: number;
  net: number;
  /** Rank in the current phase's ordering (qualifying: combined; after the
   *  split: within-tier, continuing across tiers). */
  rank: number;
  /** Final fleet id once split (display grouping), else null. */
  finalFleetId: string | null;
  medal: boolean;
}

/** Score one physical race — one fleet's sailing of a stage race — over the
 *  race's sheet. Rows are scoped to the fleet's members, so a combined sheet
 *  interleaving a sequence's fleets yields correct per-fleet places.
 *  - Finishers score their place within the fleet + start.firstPlaceOffset
 *    (the companion "last race" primitive), multiplied by `multiplier`
 *    (medal doubling applies to finish points only — RRS A4.1 "points ...
 *    doubled", not the code base).
 *  - Coded finishes and absentees (implicit DNC) score `codeBase`,
 *    undoubled.
 *  - SCP/ZFP add a percentage of the race's DNF score and DPI adds stated
 *    points, both through the engine-wide `applyAdditivePenalty` (RRS
 *    44.3(c) rounding and DNF cap). Penalties apply to finishers only (a
 *    coded boat is already at the base).
 *  - RDG rows are emitted with `rdg` set and points 0; the standings pass
 *    resolves them per RRS A9 once all other cells exist.
 */
function scorePhysicalRace(
  ref: StageRaceRef,
  members: Competitor[],
  finishes: Finish[],
  codeBase: number,
  multiplier: number,
): Map<string, { points: number; code: string | null; rdg: Finish | null }> {
  const offset = ref.start.firstPlaceOffset ?? 0;
  const memberIds = new Set(members.map((m) => m.id));
  const rows = finishes.filter(
    (f) => f.raceId === ref.race.id && f.competitorId && memberIds.has(f.competitorId),
  );
  const finishers = rows
    .filter((f) => f.sortOrder !== null && !f.resultCode)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const out = new Map<string, { points: number; code: string | null; rdg: Finish | null }>();
  finishers.forEach((f, i) => {
    const placePoints = (i + 1 + offset) * multiplier;
    // One implementation of RRS 44.3(c) for both engines: the percentage is of
    // the race's DNF score, rounded to the nearest tenth (0.05 up), and the
    // penalty never makes her worse than DNF.
    const points = applyAdditivePenalty(placePoints, f, codeBase, ref.fleetId);
    out.set(f.competitorId!, { points, code: f.penaltyCode ?? null, rdg: null });
  });
  for (const f of rows) {
    if (out.has(f.competitorId!)) continue;
    if (f.resultCode === 'RDG') {
      out.set(f.competitorId!, { points: 0, code: 'RDG', rdg: f });
    } else if (f.resultCode) {
      out.set(f.competitorId!, { points: codeBase, code: f.resultCode, rdg: null });
    }
  }
  for (const m of members) {
    if (!out.has(m.id)) out.set(m.id, { points: codeBase, code: 'DNC', rdg: null });
  }
  return out;
}

/** RRS A8.1: compare best-to-worst score lists (ascending, lexicographic).
 *  Returns negative when a ranks ahead of b. */
function compareScoreLists(a: number[], b: number[]): number {
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  for (let i = 0; i < Math.min(sa.length, sb.length); i++) {
    if (sa[i] !== sb[i]) return sa[i] - sb[i];
  }
  return 0;
}

/** RRS A8.2: last race, then next-to-last, and so on — over counting cells
 *  in stage/race order, including discarded scores. */
function compareLastRace(a: CellScore[], b: CellScore[]): number {
  const order: SeriesStage[] = ['qualifying', 'final', 'medal'];
  const key = (c: CellScore) => order.indexOf(c.stage) * 1000 + c.stageRaceNumber;
  const la = a.filter((c) => c.counts).sort((x, y) => key(x) - key(y));
  const lb = b.filter((c) => c.counts).sort((x, y) => key(x) - key(y));
  for (let i = 0; i < Math.min(la.length, lb.length); i++) {
    const ca = la[la.length - 1 - i];
    const cb = lb[lb.length - 1 - i];
    if (ca.points !== cb.points) return ca.points - cb.points;
  }
  return 0;
}

function discardCount(config: SplitFleetConfig, countedRaces: number): number {
  let n = 0;
  for (const t of config.discardThresholds) {
    if (countedRaces >= t.minRaces) n = Math.max(n, t.discardCount);
  }
  return n;
}

/** Apply the discard ladder over one group of a row's cells. Medal cells are
 *  never discardable and do not count toward the thresholds (2024 ILCA
 *  SI 18.6). With `finalCaps` (the continuous-carry line, where one ladder
 *  spans both series) at most `maxFinalDiscards` may fall on final-series
 *  cells and `protectLoneFinalRace` protects a lone completed final race
 *  (ILCA: "if only one Final series race is completed it will not be
 *  excluded"); the per-series ladders of net+net carry no such caps — each
 *  series simply discards its own worst. Ties in badness discard the
 *  earliest race (RRS A2.1). Mutates cell.discarded. */
function applyDiscardGroup(
  config: SplitFleetConfig,
  cells: CellScore[],
  opts: { finalCaps: boolean },
): void {
  const counting = cells.filter((c) => c.counts);
  // A carried qualifying position is a score, not a race, so it never moves
  // the "when N races have been completed" ladder.
  const thresholdRaces = counting.filter(
    (c) => c.stage !== 'medal' && !c.carriedRank,
  ).length;
  const n = discardCount(config, thresholdRaces);
  const finalCells = counting.filter((c) => c.stage === 'final' && !c.carriedRank);
  const loneFinalProtected =
    opts.finalCaps && config.protectLoneFinalRace && finalCells.length === 1;
  const order: SeriesStage[] = ['qualifying', 'final', 'medal'];
  const raceKey = (c: CellScore) => order.indexOf(c.stage) * 1000 + c.stageRaceNumber;
  let finalDiscards = 0;
  const candidates = counting
    .filter((c) => c.discardable && c.stage !== 'medal')
    .sort((a, b) => b.points - a.points || raceKey(a) - raceKey(b));
  let applied = 0;
  for (const c of candidates) {
    if (applied >= n) break;
    if (opts.finalCaps && c.stage === 'final') {
      if (loneFinalProtected) continue;
      if (finalDiscards >= config.maxFinalDiscards) continue;
      finalDiscards++;
    }
    c.discarded = true;
    applied++;
  }
}

/** Select discards for a row according to the carry mode:
 *  - `points` — one ladder over the combined line, with the final-series caps.
 *  - `net-plus-net` — the ladder applied separately to each series, so the
 *    championship score is the sum of two independently-discarded series.
 *  - `rank-seed` — the carried qualifying position is non-excludable and the
 *    superseded qualifying cells are out of the score, so only the final
 *    series discards. */
function applyDiscards(config: SplitFleetConfig, cells: CellScore[]): void {
  if (config.carry === 'points') {
    applyDiscardGroup(config, cells, { finalCaps: true });
    return;
  }
  // Both remaining modes discard per series. Under `rank-seed` the
  // qualifying cells stop counting once the position is carried, so the
  // first call is a no-op after the split and the running qualifying ladder
  // before it.
  applyDiscardGroup(config, cells.filter((c) => c.stage === 'qualifying'), { finalCaps: false });
  applyDiscardGroup(config, cells.filter((c) => c.stage !== 'qualifying'), { finalCaps: false });
}

/** Finishing positions in the qualifying series alone — the input to
 *  `rank-seed` carry. Scored over the qualifying cells with the qualifying
 *  ladder, ranked by RRS A8. Boats with no qualifying race at all (a late
 *  entry into the final series) get no position, and so no carried score. */
function rankQualifyingSeries(
  config: SplitFleetConfig,
  rows: SplitStandingRow[],
): Map<string, number> {
  const scored = rows
    .map((row) => {
      const cells = row.cells
        .filter((c) => c.stage === 'qualifying')
        .map((c) => ({ ...c }));
      applyDiscardGroup(config, cells, { finalCaps: false });
      const counting = cells.filter((c) => c.counts);
      return {
        id: row.competitor.id,
        cells,
        sailed: counting.length > 0,
        net: counting.filter((c) => !c.discarded).reduce((sum, c) => sum + c.points, 0),
      };
    })
    .filter((r) => r.sailed);
  scored.sort(
    (a, b) =>
      a.net - b.net ||
      compareScoreLists(
        a.cells.filter((c) => c.counts && !c.discarded).map((c) => c.points),
        b.cells.filter((c) => c.counts && !c.discarded).map((c) => c.points),
      ) ||
      compareLastRace(a.cells, b.cells),
  );
  const positions = new Map<string, number>();
  scored.forEach((r, i) => positions.set(r.id, i + 1));
  return positions;
}

/**
 * Combined standings over qualifying (+ final + medal once they exist).
 * Ordering: medal boats first (by net), then final-fleet tiers in order
 * (each by net), then — before any split — everyone by net over the
 * combined line. Returns rows with per-cell detail for rendering.
 */
export function splitFleetStandings(data: SplitFleetData): SplitStandingRow[] {
  const { config, rounds, competitors } = data;

  const qRaces = logicalRaces(data, 'qualifying');
  const fRaces = logicalRaces(data, 'final');
  const mRaces = logicalRaces(data, 'medal');

  const splitRound = roundsForStage(rounds, 'final')[0] ?? null;
  const medalRound = roundsForStage(rounds, 'medal')[0] ?? null;
  const medalFleetId = medalRound?.fleetIds[0] ?? null;

  const rowByCompetitor = new Map<string, SplitStandingRow>();
  for (const c of competitors) {
    rowByCompetitor.set(c.id, {
      competitor: c,
      cells: [],
      total: 0,
      net: 0,
      rank: 0,
      finalFleetId: splitRound?.fleetIds.find((fid) => c.fleetIds.includes(fid)) ?? null,
      medal: !!medalFleetId && c.fleetIds.includes(medalFleetId),
    });
  }

  const qualifyingRound = roundsForStage(rounds, 'qualifying')[0] ?? null;
  const largestQualifying = qualifyingRound ? largestFleetSize(data, qualifyingRound) : 0;

  const addStage = (lrs: LogicalRace[], stage: SeriesStage) => {
    for (const lr of lrs) {
      if (!lr.round) continue;
      const qualifying = stage === 'qualifying';
      // RRS A5.2 replacement base per stage, from config.codeBasis.
      const stageLargest = largestFleetSize(data, lr.round);
      const codeBaseQ =
        config.codeBasis.qualifying === 'fixed'
          ? (config.codeBasis.fixedPoints ?? stageLargest + 1)
          : stageLargest + 1;
      for (const fleetId of lr.round.fleetIds) {
        const ref = lr.races.get(fleetId);
        if (!ref) continue;
        const members = fleetMembers(competitors, fleetId);
        const codeBase = qualifying
          ? codeBaseQ
          : config.codeBasis.final === 'largest-qualifying'
            ? largestQualifying + 1
            : members.length + 1;
        const isMedalFleet = stage === 'medal' && fleetId === lr.round.fleetIds[0];
        const multiplier = isMedalFleet ? (config.medal?.multiplier ?? 2) : 1;
        const scores = scorePhysicalRace(ref, members, data.finishes, codeBase, multiplier);
        for (const [competitorId, sc] of scores) {
          const row = rowByCompetitor.get(competitorId);
          if (!row) continue;
          row.cells.push({
            stage,
            stageRaceNumber: lr.stageRaceNumber,
            fleetId,
            raceId: ref.race.id,
            points: sc.points,
            code: sc.code,
            // qualifying: only valid logical races count; final/medal races
            // count as soon as they're completed
            counts: qualifying ? lr.valid : physicalRaceCompleted(ref, competitors, data.finishes),
            discardable: stage !== 'medal',
            discarded: false,
            rdg: sc.rdg,
          });
        }
      }
    }
  };

  addStage(qRaces, 'qualifying');
  addStage(fRaces, 'final');
  addStage(mRaces, 'medal');

  const rows = [...rowByCompetitor.values()];

  // Resolve RDG cells per RRS A9: average points, to the nearest tenth
  // (0.05 rounded up), over the boat's other counting non-RDG cells --
  // honouring the finish's method and include/exclude race-id sets. Stated
  // points pass straight through. Resolution reads only non-RDG cells, so
  // two RDG cells never feed each other.
  const stageOrder: SeriesStage[] = ['qualifying', 'final', 'medal'];
  const cellKey = (c: CellScore) => stageOrder.indexOf(c.stage) * 1000 + c.stageRaceNumber;
  for (const row of rows) {
    for (const cell of row.cells) {
      if (!cell.rdg) continue;
      const f = cell.rdg;
      if (f.redressMethod === 'stated' && f.redressPoints != null) {
        cell.points = f.redressPoints;
        continue;
      }
      let pool = row.cells.filter((c) => c !== cell && c.counts && !c.rdg);
      if (f.redressMethod === 'races_before') {
        pool = pool.filter((c) => cellKey(c) < cellKey(cell));
      }
      if (f.redressIncludeRaceIds?.length) {
        pool = pool.filter((c) => f.redressIncludeRaceIds!.includes(c.raceId));
      } else if (f.redressExcludeRaceIds?.length) {
        pool = pool.filter((c) => !f.redressExcludeRaceIds!.includes(c.raceId));
      }
      if (pool.length === 0) {
        cell.points = 0;
        continue;
      }
      const mean = pool.reduce((sum, c) => sum + c.points, 0) / pool.length;
      cell.points = Math.round(mean * 10 + 1e-9) / 10;
    }
  }

  // `rank-seed` carry: once the final series exists, a boat's qualifying
  // position becomes one non-excludable score and her qualifying race scores
  // drop out of the championship total (470/Topper wording: "the position of
  // each boat in the Qualifying Series shall be carried forward to the Final
  // Series as non-excludable points").
  if (config.carry === 'rank-seed' && splitRound) {
    const qualifyingPosition = rankQualifyingSeries(config, rows);
    for (const row of rows) {
      for (const cell of row.cells) {
        if (cell.stage !== 'qualifying') continue;
        cell.counts = false;
        cell.superseded = true;
      }
      const position = qualifyingPosition.get(row.competitor.id);
      if (position == null) continue;
      row.cells.push({
        stage: 'final',
        stageRaceNumber: 0,
        fleetId: row.finalFleetId ?? '',
        raceId: '',
        points: position,
        code: null,
        counts: true,
        discardable: false,
        discarded: false,
        carriedRank: true,
      });
    }
  }

  for (const row of rows) {
    applyDiscards(config, row.cells);
    const counting = row.cells.filter((c) => c.counts);
    row.total = counting.reduce((s, c) => s + c.points, 0);
    row.net = counting.filter((c) => !c.discarded).reduce((s, c) => s + c.points, 0);
  }

  // RRS A8: A8.1 (best score lists, excluded scores out) then A8.2 (last
  // race backwards, including excluded scores).
  const byNet = (a: SplitStandingRow, b: SplitStandingRow) =>
    a.net - b.net ||
    compareScoreLists(
      a.cells.filter((c) => c.counts && !c.discarded).map((c) => c.points),
      b.cells.filter((c) => c.counts && !c.discarded).map((c) => c.points),
    ) ||
    compareLastRace(a.cells, b.cells);

  // Tier ordering: medal first, then final fleets in order, then the rest.
  const tierIndex = (row: SplitStandingRow): number => {
    if (row.medal) return -1;
    if (!splitRound || !row.finalFleetId) return splitRound ? 999 : 0;
    return splitRound.fleetIds.indexOf(row.finalFleetId);
  };
  rows.sort((a, b) => tierIndex(a) - tierIndex(b) || byNet(a, b));
  rows.forEach((row, i) => (row.rank = i + 1));
  return rows;
}

/** Provisional final-series cut boundaries over a pre-split qualifying
 *  ranking: returns the 0-based row indexes after which a cut line renders. */
export function provisionalCutIndexes(total: number, fleetCount: number): number[] {
  const sizes = finalBlockSizes(total, fleetCount);
  const cuts: number[] = [];
  let acc = 0;
  for (let i = 0; i < sizes.length - 1; i++) {
    acc += sizes[i];
    cuts.push(acc - 1);
  }
  return cuts;
}
