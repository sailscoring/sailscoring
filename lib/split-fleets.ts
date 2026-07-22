// Split-fleet (qualifying/final series) prototype engine.
// See docs/design/split-fleets.md and
// docs/design/ux/flows/split-fleets.md. PROTOTYPE: continuous-points carry
// only; no RDG/penalty handling; simplified tie-breaking (A8.1 without the
// A8.2 last-race step); no equalisation modes (a qualifying race simply
// doesn't count until every fleet has completed it).

import type { Competitor, Finish, Fleet, Race } from './types';

export type SeriesStage = 'qualifying' | 'final' | 'medal';

/** Stored on series.qf_config. Sparse prototype of the design's
 *  QualifyingFinalConfig — only what the prototype scoring path reads. */
export interface SplitFleetConfig {
  /** Qualifying fleet labels in SI order (the reassignment-pattern order). */
  qualifyingFleets: { label: string; color: string }[];
  /** Final fleet labels in tier order (Gold first). */
  finalFleets: { label: string; color: string }[];
  /** Planned schedule: races per day for the day strip. */
  plannedDays: { label: string; races: number }[];
  /** Discard thresholds over the combined line: [{minRaces, discardCount}]. */
  discardThresholds: { minRaces: number; discardCount: number }[];
  /** Max discards that may fall on final-series races (ILCA: 1). */
  maxFinalDiscards: number;
  /** Medal config; absent = no medal phase. */
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
    discardThresholds: [
      { minRaces: 4, discardCount: 1 },
      { minRaces: 10, discardCount: 2 },
    ],
    maxFinalDiscards: 1,
    medal: { size: 10, raceCount: 1, multiplier: 2 },
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

export type SeedOrder = 'sail-number' | 'nationality-spread' | 'entry-order';

/** Initial seeding order. Prototype sources: numeric-ish sail-number order,
 *  nationality-then-sail (spreads compatriots across fleets when fed through
 *  the rank pattern), or plain entry order. */
export function seedOrder(competitors: Competitor[], order: SeedOrder): string[] {
  const bySail = (a: Competitor, b: Competitor) => {
    const na = parseInt(a.sailNumber.replace(/\D/g, ''), 10) || 0;
    const nb = parseInt(b.sailNumber.replace(/\D/g, ''), 10) || 0;
    return na - nb || a.sailNumber.localeCompare(b.sailNumber);
  };
  const sorted = [...competitors];
  if (order === 'sail-number') sorted.sort(bySail);
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

export interface StageRaceRef {
  race: Race;
  fleetId: string;
}

export interface LogicalRace {
  stageRaceNumber: number;
  round: SplitRound | null;
  /** fleetId → race (may miss fleets that haven't got a race yet). */
  races: Map<string, StageRaceRef>;
  /** Every fleet of the covering round has a completed race. */
  valid: boolean;
}

export interface SplitFleetData {
  config: SplitFleetConfig;
  rounds: SplitRound[];
  fleets: Fleet[];
  competitors: Competitor[];
  /** Qualifying/final/medal races only (race.stage set). */
  races: Race[];
  /** raceId → the single fleet that sails it (from its start). */
  raceFleetIds: Record<string, string>;
  finishes: Finish[];
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

export function raceCompleted(race: Race, finishes: Finish[]): boolean {
  return finishes.some(
    (f) => f.raceId === race.id && (f.sortOrder !== null || f.resultCode !== null),
  );
}

/** Group a stage's races into logical races with validity. */
export function logicalRaces(data: SplitFleetData, stage: SeriesStage): LogicalRace[] {
  const byNumber = new Map<number, Map<string, StageRaceRef>>();
  for (const race of data.races) {
    if (race.stage !== stage || race.stageRaceNumber == null) continue;
    const fleetId = data.raceFleetIds[race.id];
    if (!fleetId) continue;
    let entry = byNumber.get(race.stageRaceNumber);
    if (!entry) byNumber.set(race.stageRaceNumber, (entry = new Map()));
    entry.set(fleetId, { race, fleetId });
  }
  return [...byNumber.entries()]
    .sort(([a], [b]) => a - b)
    .map(([stageRaceNumber, races]) => {
      const round = coveringRound(data.rounds, stage, stageRaceNumber);
      const valid =
        !!round &&
        round.fleetIds.every((fid) => {
          const ref = races.get(fid);
          return !!ref && raceCompleted(ref.race, data.finishes);
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
  points: number;
  code: string | null; // 'DNC', or the recorded result code
  discarded: boolean;
  counts: boolean; // false while the logical race is not yet valid
  discardable: boolean;
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

/** Score one physical race within its fleet: place points for finishers by
 *  sortOrder, codeBase points for coded finishes and absentees.
 *  PROTOTYPE: penalty/redress/ties ignored. */
function scorePhysicalRace(
  ref: StageRaceRef,
  members: Competitor[],
  finishes: Finish[],
  codeBase: number,
  multiplier: number,
  offset: number,
): Map<string, { points: number; code: string | null }> {
  const rows = finishes.filter((f) => f.raceId === ref.race.id && f.competitorId);
  const finishers = rows
    .filter((f) => f.sortOrder !== null && !f.resultCode)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const out = new Map<string, { points: number; code: string | null }>();
  finishers.forEach((f, i) => {
    out.set(f.competitorId!, { points: (i + 1 + offset) * multiplier, code: null });
  });
  for (const f of rows) {
    if (f.resultCode && !out.has(f.competitorId!)) {
      out.set(f.competitorId!, { points: codeBase * multiplier, code: f.resultCode });
    }
  }
  for (const m of members) {
    if (!out.has(m.id)) out.set(m.id, { points: codeBase * multiplier, code: 'DNC' });
  }
  return out;
}

/** A8.1-style comparison of counted scores (lexicographic over ascending
 *  score lists). Returns negative when a ranks ahead of b. */
function compareScoreLists(a: number[], b: number[]): number {
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  for (let i = 0; i < Math.min(sa.length, sb.length); i++) {
    if (sa[i] !== sb[i]) return sa[i] - sb[i];
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

/** Apply discards over a row's counting cells, honouring maxFinalDiscards
 *  and never discarding medal cells. Mutates cell.discarded. */
function applyDiscards(config: SplitFleetConfig, cells: CellScore[]): void {
  const counting = cells.filter((c) => c.counts);
  const n = discardCount(config, counting.length);
  let finalDiscards = 0;
  const candidates = counting
    .filter((c) => c.discardable)
    .sort((a, b) => b.points - a.points);
  let applied = 0;
  for (const c of candidates) {
    if (applied >= n) break;
    if (c.stage !== 'qualifying') {
      if (finalDiscards >= config.maxFinalDiscards) continue;
      finalDiscards++;
    }
    c.discarded = true;
    applied++;
  }
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

  const addStage = (lrs: LogicalRace[], stage: SeriesStage) => {
    for (const lr of lrs) {
      if (!lr.round) continue;
      const qualifying = stage === 'qualifying';
      const codeBaseQ = qualifying ? largestFleetSize(data, lr.round) + 1 : 0;
      for (const fleetId of lr.round.fleetIds) {
        const ref = lr.races.get(fleetId);
        if (!ref) continue;
        const members = fleetMembers(competitors, fleetId);
        const codeBase = qualifying ? codeBaseQ : members.length + 1;
        const isMedalFleet = stage === 'medal' && fleetId === lr.round.fleetIds[0];
        const multiplier = isMedalFleet ? (config.medal?.multiplier ?? 2) : 1;
        const offset =
          stage === 'medal' && !isMedalFleet ? (config.medal?.size ?? 10) : 0;
        const scores = scorePhysicalRace(
          ref,
          members,
          data.finishes,
          codeBase,
          multiplier,
          offset,
        );
        for (const [competitorId, s] of scores) {
          const row = rowByCompetitor.get(competitorId);
          if (!row) continue;
          row.cells.push({
            stage,
            stageRaceNumber: lr.stageRaceNumber,
            fleetId,
            points: s.points,
            code: s.code,
            // qualifying: only valid logical races count; final/medal races
            // count as soon as they're completed
            counts: qualifying ? lr.valid : raceCompleted(ref.race, data.finishes),
            discardable: stage !== 'medal',
            discarded: false,
          });
        }
      }
    }
  };

  addStage(qRaces, 'qualifying');
  addStage(fRaces, 'final');
  addStage(mRaces, 'medal');

  const rows = [...rowByCompetitor.values()];
  for (const row of rows) {
    applyDiscards(config, row.cells);
    const counting = row.cells.filter((c) => c.counts);
    row.total = counting.reduce((s, c) => s + c.points, 0);
    row.net = counting.filter((c) => !c.discarded).reduce((s, c) => s + c.points, 0);
  }

  const byNet = (a: SplitStandingRow, b: SplitStandingRow) =>
    a.net - b.net ||
    compareScoreLists(
      a.cells.filter((c) => c.counts && !c.discarded).map((c) => c.points),
      b.cells.filter((c) => c.counts && !c.discarded).map((c) => c.points),
    );

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
