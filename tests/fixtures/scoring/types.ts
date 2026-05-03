/**
 * Unified scoring-fixture schema shared by the three test runners
 * (tests/scoring-fixtures.test.ts, tests/tcc-handicap-fixtures.test.ts,
 * tests/nhc-fixtures.test.ts) and the HTML preview renderer
 * (scripts/render-scoring-fixtures.ts).
 *
 * Every fixture carries a series wrapper and a top-level
 * `expected.standings` block so the series-scoring engine is exercised
 * even in single-race handicap examples. Per-race `expected` arrays
 * carry arithmetic that's worth showing a human scorer (CT, TCF
 * progression); they're optional and omitted for scratch fixtures.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type {
  Competitor,
  DiscardThreshold,
  Finish,
  Fleet,
  PenaltyCode,
  Race,
  RaceStart,
  ResultCode,
} from '@/lib/types';

// ─── Fixture schema ──────────────────────────────────────────────────────────

export interface FixtureFinish {
  sailor: string;
  position?: number;                        // scratch: finishing position
  /** Marks this finisher as tied with the immediately-prior row (RRS A8.1). */
  tiedWithPrevious?: boolean;
  finishTime?: string;                      // handicap: wall-clock finish time
  code?: ResultCode;
  startPresent?: boolean;
  penaltyCode?: PenaltyCode;
  penaltyOverride?: number;
  redressMethod?: 'all_races' | 'races_before' | 'stated';
  redressExcludeRaces?: number[];
  redressIncludeRaces?: number[];
  redressIncludeAllLater?: boolean;
  redressPoints?: number;
}

export interface FixtureRaceExpected {
  sailor: string;
  rank: number | null;
  points: number;
  elapsedTime?: number | null;
  correctedTime?: number | null;
  tcfApplied?: number | null;
  // Progressive (NHC / ECHO) — the same intermediates under different
  // notation. ECHO fixtures may use `pi` and `newH` as aliases of
  // `fairTcf` and `newTcf` for IS-formula fidelity in the YAML source.
  newTcf?: number | null;
  newH?: number | null;
  ctRatio?: number;
  fairTcf?: number;
  pi?: number;
  adjustment?: number;
  reciprocalEt?: number;
  code?: string;
}

export interface FixtureAggregates {
  alpha: number;
  finisherCount: number;
  ctAvg?: number;
  meanTcf?: number;
  // ECHO-specific aggregates (IS-formula fleet header)
  sumH?: number;
  sumReciprocalEt?: number;
  updateSuppressed?: boolean;
}

export interface FixtureRejection {
  sailor: string;
  reason: string;
}

export interface FixtureRace {
  number?: number;
  startTime?: string;
  finishes: FixtureFinish[];
  expected?: FixtureRaceExpected[];
  aggregates?: FixtureAggregates;
  rejected?: FixtureRejection[];
}

export interface FixtureStanding {
  rank: number;
  sailor: string;
  fleet?: string;
  racePoints: number[];
  raceCodes: (ResultCode | null)[];
  raceDiscards: boolean[];
  raceNonDiscardable?: boolean[];
  racePenaltyCodes?: (PenaltyCode | null)[];
  raceRedressFlags?: boolean[];
  totalPoints: number;
  netPoints: number;
}

export interface FixtureCompetitor {
  sailNumber: string;
  name: string;
  fleet?: string;            // multi-fleet scratch fixtures
  ircTcc?: number;
  pyNumber?: number;
  nhcStartingTcf?: number;
  echoStartingTcf?: number;
}

export interface FixtureFleet {
  scoringSystem: 'scratch' | 'irc' | 'py' | 'nhc' | 'echo';
  alpha?: number;            // NHC and ECHO (mapped to nhcAlpha / echoAlpha)
}

export interface Fixture {
  description: string;
  rrs_notes?: string;
  notes?: string;
  series: {
    discardThresholds: DiscardThreshold[];
    dnfScoring?: 'seriesEntries' | 'startingArea';
  };
  fleet?: FixtureFleet;        // present for handicap/NHC; optional for scratch
  competitors: FixtureCompetitor[];
  races: FixtureRace[];
  expected: {
    standings: FixtureStanding[];
  };
}

// ─── Library inputs built from a fixture ─────────────────────────────────────

export interface FixtureInputs {
  competitors: Competitor[];
  fleets: Fleet[];
  races: Race[];
  finishes: Finish[];
  raceStarts: RaceStart[];
  discardThresholds: DiscardThreshold[];
  dnfScoring: 'seriesEntries' | 'startingArea';
  sailToId: Map<string, string>;
}

export function buildFixtureInputs(fixture: Fixture): FixtureInputs {
  const topFleet = fixture.fleet;
  const hasPerCompetitorFleet = fixture.competitors.some((c) => c.fleet);

  // Build fleets. Three modes:
  //   - top-level `fleet:` present → single fleet with that scoring system
  //   - competitors carry `fleet: "Name"` strings → one scratch fleet per name
  //   - neither → a single default scratch fleet
  let fleets: Fleet[];
  let fleetIdByName: Map<string, string>;
  if (topFleet) {
    const alphaField = topFleet.scoringSystem === 'echo' ? 'echoAlpha' : 'nhcAlpha';
    fleets = [{
      id: 'fl-0',
      seriesId: 's1',
      name: 'Fleet',
      displayOrder: 0,
      scoringSystem: topFleet.scoringSystem,
      ...(topFleet.alpha != null ? { [alphaField]: topFleet.alpha } : {}),
    }];
    fleetIdByName = new Map([['Fleet', 'fl-0']]);
  } else if (hasPerCompetitorFleet) {
    const names = [...new Set(fixture.competitors.map((c) => c.fleet ?? 'Default'))];
    fleets = names.map((name, i) => ({
      id: `fl-${i}`,
      seriesId: 's1',
      name,
      displayOrder: i,
      scoringSystem: 'scratch' as const,
    }));
    fleetIdByName = new Map(fleets.map((f) => [f.name, f.id]));
  } else {
    fleets = [{
      id: 'fl-0',
      seriesId: 's1',
      name: 'Default',
      displayOrder: 0,
      scoringSystem: 'scratch' as const,
    }];
    fleetIdByName = new Map([['Default', 'fl-0']]);
  }

  const sailToId = new Map(fixture.competitors.map((c, i) => [c.sailNumber, `c-${i}`]));
  const competitors: Competitor[] = fixture.competitors.map((c, i) => {
    const fleetName = topFleet ? 'Fleet' : (c.fleet ?? 'Default');
    const fleetId = fleetIdByName.get(fleetName);
    if (!fleetId) throw new Error(`Fixture competitor ${c.sailNumber} references unknown fleet "${fleetName}"`);
    return {
      id: `c-${i}`,
      seriesId: 's1',
      fleetIds: [fleetId],
      sailNumber: c.sailNumber,
      name: c.name,
      club: '',
      gender: '',
      age: null,
      createdAt: 0,
      ...(c.ircTcc != null ? { ircTcc: c.ircTcc } : {}),
      ...(c.pyNumber != null ? { pyNumber: c.pyNumber } : {}),
      ...(c.nhcStartingTcf != null ? { nhcStartingTcf: c.nhcStartingTcf } : {}),
      ...(c.echoStartingTcf != null ? { echoStartingTcf: c.echoStartingTcf } : {}),
    };
  });

  const races: Race[] = fixture.races.map((r, i) => ({
    id: `r-${i}`,
    seriesId: 's1',
    raceNumber: r.number ?? i + 1,
    date: '2025-01-01',
    createdAt: 0,
  }));

  const raceStarts: RaceStart[] = [];
  const finishes: Finish[] = [];
  for (let ri = 0; ri < fixture.races.length; ri++) {
    const fr = fixture.races[ri];
    const raceId = races[ri].id;
    if (fr.startTime) {
      raceStarts.push({
        id: `rs-${ri}`,
        raceId,
        fleetIds: fleets.map((f) => f.id),
        startTime: fr.startTime,
      });
    }
    for (const f of fr.finishes) {
      const competitorId = sailToId.get(f.sailor);
      if (!competitorId) {
        throw new Error(`Fixture "${fixture.description}": unknown sailor "${f.sailor}" in race ${fr.number ?? ri + 1}`);
      }
      finishes.push({
        id: `f-${ri}-${f.sailor}`,
        raceId,
        competitorId,
        sortOrder: f.position ?? null,
        tiedWithPrevious: f.tiedWithPrevious ?? false,
        ...(f.finishTime ? { finishTime: f.finishTime } : {}),
        resultCode: f.code ?? null,
        startPresent: f.startPresent ?? null,
        penaltyCode: f.penaltyCode ?? null,
        penaltyOverride: f.penaltyOverride ?? null,
        redressMethod: f.redressMethod ?? null,
        redressExcludeRaces: f.redressExcludeRaces ?? null,
        redressIncludeRaces: f.redressIncludeRaces ?? null,
        redressIncludeAllLater: f.redressIncludeAllLater ?? false,
        redressPoints: f.redressPoints ?? null,
      });
    }
  }

  return {
    competitors,
    fleets,
    races,
    finishes,
    raceStarts,
    discardThresholds: fixture.series.discardThresholds,
    dnfScoring: fixture.series.dnfScoring ?? 'seriesEntries',
    sailToId,
  };
}

// ─── Directory walk ──────────────────────────────────────────────────────────

export interface LoadedFixture {
  yamlPath: string;
  yamlSource: string;
  fixture: Fixture;
}

export function loadFixturesFromDir(dir: string): LoadedFixture[] {
  const yamlFiles = readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .sort();
  return yamlFiles.map((file) => {
    const yamlPath = join(dir, file);
    const yamlSource = readFileSync(yamlPath, 'utf-8');
    const fixture = parseYaml(yamlSource) as Fixture;
    return { yamlPath, yamlSource, fixture };
  });
}
