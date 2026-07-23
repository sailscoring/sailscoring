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

export interface FixtureStage {
  stage: SeriesStage;
  from?: number; // fromStageRace, default 1
  /** fleet name → member sail numbers (in this round). */
  fleets: Record<string, string[]>;
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

/** A stable, readable id (fixtures are single-run; readability aids debugging). */
function fleetId(name: string): string {
  return `fleet:${name}`;
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

/** Turn a fixture into the engine's SplitFleetData. */
export function buildSplitFleetData(fx: SplitFleetFixture): SplitFleetData {
  const dummy = (names: string[]) => names.map((label) => ({ label, color: '#000' }));
  const config: SplitFleetConfig = {
    qualifyingFleets: dummy(fx.config.qualifyingFleets),
    finalFleets: dummy(fx.config.finalFleets ?? []),
    plannedDays: [],
    discardThresholds: fx.config.discardThresholds,
    maxFinalDiscards: fx.config.maxFinalDiscards,
    medal: fx.config.medal,
  };

  // Competitors — fleetIds accumulate across every stage they appear in.
  const competitors = new Map<string, Competitor>();
  for (const [i, entry] of fx.competitors.entries()) {
    const [sail, ...rest] = entry.trim().split(/\s+/);
    competitors.set(sail, {
      id: sail,
      seriesId: 's',
      fleetIds: [],
      sailNumber: sail,
      names: [rest.join(' ') || sail],
      club: '',
      gender: '',
      age: null,
      createdAt: i,
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
  let order = 0;
  let createdAt = 0;

  for (const stage of fx.stages) {
    const fleetNames = Object.keys(stage.fleets);
    // Fleets + memberships.
    for (const name of fleetNames) {
      if (!fleets.some((f) => f.id === fleetId(name))) {
        fleets.push({
          id: fleetId(name),
          seriesId: 's',
          name,
          displayOrder: order++,
          scoringSystem: 'scratch',
        });
      }
      for (const sail of stage.fleets[name]) {
        const c = requireCompetitor(sail);
        if (!c.fleetIds.includes(fleetId(name))) c.fleetIds.push(fleetId(name));
      }
    }
    // Round.
    rounds.push({
      id: `round:${stage.stage}:${stage.from ?? 1}`,
      seriesId: 's',
      stage: stage.stage,
      fromStageRace: stage.from ?? 1,
      fleetIds: fleetNames.map(fleetId),
      method: stage.stage === 'qualifying' ? 'seeded' : stage.stage === 'final' ? 'split' : 'medal-select',
      basis: null,
      createdAt: createdAt++,
    });
    // Physical races + finishes.
    for (const r of stage.races ?? []) {
      for (const name of Object.keys(r.results)) {
        const raceId = `${stage.stage}${r.n}:${name}`;
        races.push({
          id: raceId,
          seriesId: 's',
          raceNumber: races.length + 1,
          name: `${PREFIX[stage.stage]}${r.n} ${name}`,
          date: '2020-01-01',
          createdAt: createdAt++,
          stage: stage.stage,
          stageRaceNumber: r.n,
        });
        raceFleetIds[raceId] = fleetId(name);
        let finisherIndex = 0;
        for (const token of r.results[name]) {
          const [sail, codeRaw] = token.trim().split(/\s+/);
          requireCompetitor(sail);
          const code = codeRaw ? (codeRaw.toUpperCase() as ResultCode) : null;
          if (code && !RESULT_CODES.has(code)) {
            throw new Error(`fixture uses unknown result code "${codeRaw}"`);
          }
          finishes.push(
            code
              ? makeFinish(raceId, sail, null, code)
              : makeFinish(raceId, sail, finisherIndex++, null),
          );
        }
      }
    }
  }

  return {
    config,
    rounds,
    fleets,
    competitors: [...competitors.values()],
    races,
    raceFleetIds,
    finishes,
  };
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
