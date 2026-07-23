/**
 * Loader for split-fleet (qualifying/final series) fixtures.
 *
 * Each `.yaml` in this directory is a declarative capture of a real
 * championship scoring case (see codes.md and README.md), authored at a small,
 * human-verifiable scale but with the real event's structural parameters
 * (fleet counts, discard profile, medal config, what-actually-happened). The
 * loader turns a fixture into the `SplitFleetData` the prototype engine
 * (`lib/split-fleets.ts`) consumes.
 *
 * Runner: tests/split-fleets-fixtures.test.ts.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

import {
  assignByRankPattern,
  finalBlockSizes,
  seedOrder,
  splitFleetStandings,
} from '@/lib/split-fleets';
import type {
  SplitFleetConfig,
  SplitFleetData,
  SplitRound,
  SeriesStage,
} from '@/lib/split-fleets';
import type { Competitor, Finish, Fleet, Race, ResultCode } from '@/lib/types';

// ─── Fixture schema ──────────────────────────────────────────────────────────

export interface FixtureProvenance {
  class: string;
  year: number;
  event: string;
  si?: string;
  results?: string;
  code: string; // 'F1' | 'F2'
  scenarios?: string[]; // e.g. ['D5']
  alternatives?: string; // other real events exhibiting the same case
}

export interface FixtureStageRace {
  n: number;
  /** fleet name → ordered finish list; tokens are "sail" or "sail CODE". */
  results: Record<string, string[]>;
}

/**
 * How a round's fleets are assigned. Exactly one form per stage:
 *   seed:          initial qualifying seeding by a competitor ordering
 *   reassignAfter: qualifying reassignment by the standings after race N
 *   split:         final split by the qualifying ranking (all Q races)
 *   splitAfter:    final split by the qualifying ranking through race N
 *   medalTop:      medal-fleet selection — top N of the opening series (the
 *                  rest of the top final fleet go to the companion fleet)
 * The engine's rank pattern (`assignByRankPattern`) and block-split
 * (`finalBlockSizes`) do the work; the fixture asserts the result via
 * `expectedFleets`.
 */
export interface FixtureAssign {
  seed?: 'entry-order' | 'sail-number' | 'nationality-spread';
  reassignAfter?: number;
  split?: boolean;
  splitAfter?: number;
  medalTop?: number;
}

export interface FixtureStage {
  stage: SeriesStage;
  from?: number; // fromStageRace, default 1
  /** Explicit fleet name → member sail numbers. Use for hand-picked
   *  memberships; prefer `assign` so the assignment logic is under test. */
  fleets?: Record<string, string[]>;
  /** Derive the round's fleets from a seed / ranking (see FixtureAssign). */
  assign?: FixtureAssign;
  /** Assert the computed assignment (membership per fleet; order within a
   *  fleet is not asserted). */
  expectedFleets?: Record<string, string[]>;
  races?: FixtureStageRace[];
}

export interface FixtureExpectedRow {
  rank: number;
  sail: string;
  total: number;
  net: number;
  fleet?: string; // final/medal fleet name
  medal?: boolean;
}

export interface SplitFleetFixture {
  description: string;
  provenance: FixtureProvenance;
  /** Whether the prototype engine reproduces the expected standings. When
   *  false, the fixture is a specification for the eventual engine and the
   *  runner marks it pending with `reason`. */
  runnable: boolean;
  reason?: string;
  notes?: string;
  config: {
    qualifyingFleets: string[];
    finalFleets?: string[];
    discardThresholds: { minRaces: number; discardCount: number }[];
    maxFinalDiscards: number;
    medal?: { size: number; raceCount: number; multiplier: number };
  };
  competitors: string[]; // "sail name..." — first token is the sail number
  stages: FixtureStage[];
  expected: { standings: FixtureExpectedRow[] };
}

export interface LoadedFixture {
  file: string;
  fixture: SplitFleetFixture;
}

const RESULT_CODES = new Set<ResultCode>([
  'DNC', 'DNS', 'OCS', 'NSC', 'DNF', 'RET', 'DSQ', 'DNE', 'UFD', 'BFD', 'RDG',
]);

// ─── Build SplitFleetData ────────────────────────────────────────────────────

const PREFIX: Record<SeriesStage, string> = {
  qualifying: 'Q',
  final: 'F',
  medal: 'M',
};

/** Fleet id is scoped to the ROUND, not just the colour: a round-1 "Yellow"
 *  and a round-2 "Yellow" are distinct fleets with distinct memberships (as
 *  they are in the real model), so scoring a round-1 race never sees the
 *  round-2 flight's members. */
function fleetId(roundKey: string, name: string): string {
  return `fleet:${roundKey}:${name}`;
}

function makeFinish(raceId: string, competitorId: string, sortOrder: number | null, code: ResultCode | null): Finish {
  return {
    id: `${raceId}:${competitorId}`,
    raceId,
    competitorId,
    sortOrder,
    tiedWithPrevious: false,
    resultCode: code,
    startPresent: null,
    penaltyCode: null,
    penaltyOverride: null,
    redressMethod: null,
    redressExcludeRaceIds: null,
    redressIncludeRaceIds: null,
    redressIncludeAllLater: false,
    redressPoints: null,
  };
}

/** A round's computed membership, and the fixture's assertion for it. */
export interface ResolvedRound {
  stage: SeriesStage;
  from: number;
  /** How it was assigned, for display/debug ('seeded (entry-order)', …). */
  method: string;
  /** fleet name → member sails (sorted), as computed. */
  computed: Record<string, string[]>;
  /** fleet name → member sails (sorted), as the fixture expects (if given). */
  expected?: Record<string, string[]>;
}

export interface BuiltSplitFleet {
  data: SplitFleetData;
  rounds: ResolvedRound[];
}

const sortedMembers = (m: Record<string, string[]>): Record<string, string[]> =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [k, [...v].sort()]));

/**
 * Build the engine's SplitFleetData from a fixture, resolving each round's
 * fleet membership. `assign` rounds derive membership from a seed / ranking /
 * split rule (so the assignment logic is exercised); `fleets` rounds use the
 * declared membership. Stages are processed in event order so a reassignment
 * or split can be computed from the standings of the races already added.
 */
export function buildSplitFleet(fx: SplitFleetFixture): BuiltSplitFleet {
  const dummy = (names: string[]) => names.map((label) => ({ label, color: '#000' }));
  const config: SplitFleetConfig = {
    qualifyingFleets: dummy(fx.config.qualifyingFleets),
    finalFleets: dummy(fx.config.finalFleets ?? []),
    plannedDays: [],
    discardThresholds: fx.config.discardThresholds,
    maxFinalDiscards: fx.config.maxFinalDiscards,
    medal: fx.config.medal,
  };

  const competitors = new Map<string, Competitor>();
  for (const [i, entry] of fx.competitors.entries()) {
    const [sail, ...rest] = entry.trim().split(/\s+/);
    competitors.set(sail, {
      id: sail, seriesId: 's', fleetIds: [], sailNumber: sail,
      names: [rest.join(' ') || sail], club: '', gender: '', age: null, createdAt: i,
    });
  }
  const requireCompetitor = (sail: string): Competitor => {
    const c = competitors.get(sail);
    if (!c) throw new Error(`fixture references unknown sail "${sail}"`);
    return c;
  };

  const fleets: Fleet[] = [];
  const rounds: SplitRound[] = [];
  const races: Race[] = [];
  const raceFleetIds: Record<string, string> = {};
  const finishes: Finish[] = [];
  const resolved: ResolvedRound[] = [];
  let order = 0;
  let createdAt = 0;

  const snapshot = (): SplitFleetData => ({
    config, rounds, fleets, competitors: [...competitors.values()], races, raceFleetIds, finishes,
  });
  /** Ordered sails of a qualifying standings snapshot restricted to Q≤n. */
  const qualifyingOrder = (throughRace: number | null): string[] => {
    const qRaces = races.filter((r) => r.stage === 'qualifying' && (throughRace == null || (r.stageRaceNumber ?? 0) <= throughRace));
    const data: SplitFleetData = { ...snapshot(), races: qRaces };
    return splitFleetStandings(data).map((row) => row.competitor.sailNumber);
  };

  // Process stages in event order (qualifying < final < medal, then `from`).
  const stageOrder: Record<SeriesStage, number> = { qualifying: 0, final: 1, medal: 2 };
  const stages = [...fx.stages].sort(
    (a, b) => stageOrder[a.stage] - stageOrder[b.stage] || (a.from ?? 1) - (b.from ?? 1),
  );

  for (const stage of stages) {
    const st = stage.stage;
    let membership: Record<string, string[]>;
    let method: string;

    if (stage.fleets) {
      membership = stage.fleets;
      method = 'explicit';
    } else if (stage.assign) {
      const a = stage.assign;
      if (st === 'qualifying' && a.seed) {
        const names = fx.config.qualifyingFleets;
        const ordered = seedOrder([...competitors.values()], a.seed);
        const byFleet = assignByRankPattern(ordered, names.length);
        membership = Object.fromEntries(names.map((n, i) => [n, byFleet[i]]));
        method = `seeded (${a.seed})`;
      } else if (st === 'qualifying' && a.reassignAfter != null) {
        const names = fx.config.qualifyingFleets;
        const byFleet = assignByRankPattern(qualifyingOrder(a.reassignAfter), names.length);
        membership = Object.fromEntries(names.map((n, i) => [n, byFleet[i]]));
        method = `reassigned after Q${a.reassignAfter}`;
      } else if (st === 'final' && (a.split || a.splitAfter != null)) {
        const names = fx.config.finalFleets ?? [];
        const ordered = qualifyingOrder(a.splitAfter ?? null);
        const sizes = finalBlockSizes(ordered.length, names.length);
        membership = {};
        let idx = 0;
        names.forEach((n, i) => { membership[n] = ordered.slice(idx, idx + sizes[i]); idx += sizes[i]; });
        method = a.splitAfter != null ? `split after Q${a.splitAfter}` : 'split (qualifying ranking)';
      } else if (st === 'medal' && a.medalTop != null) {
        const [medalName, companionName] = Object.keys(stage.expectedFleets ?? {});
        const mName = medalName ?? 'Medal';
        const cName = companionName ?? 'Companion';
        const opening = splitFleetStandings(snapshot());
        const top = opening.slice(0, a.medalTop).map((r) => r.competitor.sailNumber);
        // The companion "last race" is for the rest of the top final fleet.
        const goldFinalId = rounds.find((r) => r.stage === 'final')?.fleetIds[0];
        const companion = opening
          .filter((r) => goldFinalId && r.finalFleetId === goldFinalId && !top.includes(r.competitor.sailNumber))
          .map((r) => r.competitor.sailNumber);
        membership = { [mName]: top, [cName]: companion };
        method = `medal top ${a.medalTop}`;
      } else {
        throw new Error(`stage ${st}: unsupported assign ${JSON.stringify(a)}`);
      }
    } else {
      throw new Error(`stage ${st}: needs one of 'fleets' or 'assign'`);
    }

    const roundKey = `${st}:${stage.from ?? 1}`;
    const fid = (name: string) => fleetId(roundKey, name);
    const fleetNames = Object.keys(membership);
    resolved.push({
      stage: st, from: stage.from ?? 1, method,
      computed: sortedMembers(membership),
      expected: stage.expectedFleets ? sortedMembers(stage.expectedFleets) : undefined,
    });

    for (const name of fleetNames) {
      if (!fleets.some((f) => f.id === fid(name))) {
        fleets.push({ id: fid(name), seriesId: 's', name, displayOrder: order++, scoringSystem: 'scratch' });
      }
      for (const sail of membership[name]) {
        const c = requireCompetitor(sail);
        if (!c.fleetIds.includes(fid(name))) c.fleetIds.push(fid(name));
      }
    }
    rounds.push({
      id: `round:${roundKey}`,
      seriesId: 's', stage: st, fromStageRace: stage.from ?? 1,
      fleetIds: fleetNames.map(fid),
      method: st === 'qualifying' ? 'seeded' : st === 'final' ? 'split' : 'medal-select',
      basis: null, createdAt: createdAt++,
    });

    for (const r of stage.races ?? []) {
      for (const name of Object.keys(r.results)) {
        const raceId = `${st}${r.n}:${name}`;
        races.push({
          id: raceId, seriesId: 's', raceNumber: races.length + 1,
          name: `${PREFIX[st]}${r.n} ${name}`, date: '2020-01-01', createdAt: createdAt++,
          stage: st, stageRaceNumber: r.n,
        });
        raceFleetIds[raceId] = fid(name);
        let finisherIndex = 0;
        for (const token of r.results[name]) {
          const [sail, codeRaw] = token.trim().split(/\s+/);
          requireCompetitor(sail);
          const code = codeRaw ? (codeRaw.toUpperCase() as ResultCode) : null;
          if (code && !RESULT_CODES.has(code)) throw new Error(`fixture uses unknown result code "${codeRaw}"`);
          finishes.push(code ? makeFinish(raceId, sail, null, code) : makeFinish(raceId, sail, finisherIndex++, null));
        }
      }
    }
  }

  return { data: snapshot(), rounds: resolved };
}

/** Turn a fixture into the engine's SplitFleetData. */
export function buildSplitFleetData(fx: SplitFleetFixture): SplitFleetData {
  return buildSplitFleet(fx).data;
}

// ─── Directory loading ───────────────────────────────────────────────────────

export function loadSplitFleetFixtures(dir: string): LoadedFixture[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .sort()
    .map((file) => ({
      file,
      fixture: parseYaml(readFileSync(join(dir, file), 'utf8')) as SplitFleetFixture,
    }));
}
