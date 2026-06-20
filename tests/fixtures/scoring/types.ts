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
  RaceStart, RaceRatingOverride,
  ResultCode,
  SubSeries,
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
  redressMethod?: 'all_races' | 'all_races_excl_dnc' | 'races_before' | 'stated';
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
  // Progressive (NHC / ECHO) — the per-system intermediates. ECHO uses
  // `ctRatio`/`fairTcf`/`adjustment`/`reciprocalEt` (or aliases `pi`/`newH`).
  // NHC (SWNHC2015) uses `fairTcf`/`compScore`/`isExtreme`/`alphaApplied`/
  // `provisionalTcf`/`adjustment`.
  newTcf?: number | null;
  newH?: number | null;
  ctRatio?: number;
  fairTcf?: number;
  pi?: number;
  adjustment?: number;
  reciprocalEt?: number;
  // NHC-only (SWNHC2015)
  compScore?: number;
  isExtreme?: boolean;
  extremeDirection?: 'fast' | 'slow';
  alphaApplied?: number;
  provisionalTcf?: number;
  code?: string;
}

export interface FixtureAggregates {
  finisherCount: number;
  ctAvg?: number;
  meanTcf?: number;
  // ECHO-specific aggregates (IS-formula fleet header)
  alpha?: number;
  sumH?: number;
  sumReciprocalEt?: number;
  updateSuppressed?: boolean;
  // NHC-specific aggregates (SWNHC2015 fleet header)
  p50?: number;
  w51?: number | null;
  sMean?: number;
  sStdev?: number;
  sHi?: number;
  sLo?: number;
  extremeCount?: number;
  realignmentFactor?: number;
}

export interface FixtureRejection {
  sailor: string;
  reason: string;
}

export interface FixtureRace {
  number?: number;
  startTime?: string;
  /** Sub-series (block) this race belongs to, by name. Either every race
   *  names a block or none does. */
  subSeries?: string;
  finishes: FixtureFinish[];
  expected?: FixtureRaceExpected[];
  aggregates?: FixtureAggregates;
  rejected?: FixtureRejection[];
  /** Per-race static-rating overrides (mid-series rating change). */
  ratingOverrides?: { sailor: string; field: 'ircTcc' | 'pyNumber' | 'vprsTcc'; value: number }[];
}

export interface FixtureStanding {
  rank: number;
  sailor: string;
  fleet?: string;
  racePoints: number[];
  raceCodes: (ResultCode | null)[];
  raceDiscards: boolean[];
  raceNonDiscardable?: boolean[];
  raceExcluded?: boolean[];
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
  vprsTcc?: number;
  pyNumber?: number;
  nhcStartingTcf?: number;
  echoStartingTcf?: number;
}

export interface FixtureFleet {
  scoringSystem: 'scratch' | 'irc' | 'py' | 'nhc' | 'echo' | 'vprs';
  alpha?: number;            // ECHO only (mapped to echoAlpha); NHC ignores
  // NHC only — full inline profile override (mapped to fleet.nhcProfile).
  // Absent means the engine falls back to DEFAULT_NHC_PROFILE.
  nhcProfile?: import('@/lib/types').NhcProfile;
}

/** Expected standings for one sub-series, matched to the block by name. */
export interface FixtureSubSeriesExpected {
  name: string;
  standings: FixtureStanding[];
}

export interface Fixture {
  description: string;
  rrs_notes?: string;
  notes?: string;
  series: {
    discardThresholds: DiscardThreshold[];
    dnfScoring?: 'seriesEntries' | 'startingArea' | 'startingAreaInclDnc';
  };
  fleet?: FixtureFleet;        // present for handicap/NHC; optional for scratch
  // When true, each sub-series (in race-appearance order) continues the
  // previous one's progressive chain (startingHandicapSource: 'continue').
  // Models a single chain spanning contiguous blocks.
  subSeriesCarryChain?: boolean;
  competitors: FixtureCompetitor[];
  races: FixtureRace[];
  expected: {
    /** Whole-series standings. Omitted by sub-series fixtures, which carry
     *  per-block standings instead (blocks replace the overall table). */
    standings?: FixtureStanding[];
    subSeries?: FixtureSubSeriesExpected[];
  };
}

// ─── Library inputs built from a fixture ─────────────────────────────────────

export interface FixtureInputs {
  competitors: Competitor[];
  fleets: Fleet[];
  races: Race[];
  finishes: Finish[];
  raceStarts: RaceStart[];
  ratingOverrides: RaceRatingOverride[];
  discardThresholds: DiscardThreshold[];
  dnfScoring: 'seriesEntries' | 'startingArea' | 'startingAreaInclDnc';
  sailToId: Map<string, string>;
  /** Sub-series named by races' `subSeries:` fields, in race order; empty
   *  when the fixture has none. */
  subSeriesList: SubSeries[];
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
    fleets = [{
      id: 'fl-0',
      seriesId: 's1',
      name: 'Fleet',
      displayOrder: 0,
      scoringSystem: topFleet.scoringSystem,
      ...(topFleet.scoringSystem === 'echo' && topFleet.alpha != null
        ? { echoAlpha: topFleet.alpha }
        : {}),
      ...(topFleet.scoringSystem === 'nhc' && topFleet.nhcProfile != null
        ? { nhcProfile: topFleet.nhcProfile }
        : {}),
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
      ...(c.vprsTcc != null ? { vprsTcc: c.vprsTcc } : {}),
      ...(c.pyNumber != null ? { pyNumber: c.pyNumber } : {}),
      ...(c.nhcStartingTcf != null ? { nhcStartingTcf: c.nhcStartingTcf } : {}),
      ...(c.echoStartingTcf != null ? { echoStartingTcf: c.echoStartingTcf } : {}),
    };
  });

  const subSeriesIdByName = new Map<string, string>();
  for (const r of fixture.races) {
    if (r.subSeries && !subSeriesIdByName.has(r.subSeries)) {
      subSeriesIdByName.set(r.subSeries, `ss-${subSeriesIdByName.size}`);
    }
  }

  const races: Race[] = fixture.races.map((r, i) => ({
    id: `r-${i}`,
    seriesId: 's1',
    raceNumber: r.number ?? i + 1,
    name: null,
    date: '2025-01-01',
    createdAt: 0,
  }));

  // Fixtures address redress pools by race number (human-readable in the
  // YAML); the engine works in race ids. Map number → id for translation.
  const raceIdByNumber = new Map(races.map((r) => [r.raceNumber, r.id]));
  const redressToIds = (numbers: number[] | null | undefined): string[] | null => {
    const ids = (numbers ?? [])
      .map((n) => raceIdByNumber.get(n))
      .filter((id): id is string => id != null);
    return ids.length > 0 ? ids : null;
  };

  const raceIdsBySubSeries = new Map<string, string[]>(
    [...subSeriesIdByName.values()].map((id) => [id, []]),
  );
  fixture.races.forEach((r, i) => {
    if (r.subSeries) raceIdsBySubSeries.get(subSeriesIdByName.get(r.subSeries)!)!.push(races[i].id);
  });
  const subSeriesList: SubSeries[] = [...subSeriesIdByName.entries()].map(([name, id], i, arr) => ({
    id,
    seriesId: 's1',
    name,
    displayOrder: i,
    raceIds: raceIdsBySubSeries.get(id) ?? [],
    ...(fixture.subSeriesCarryChain && i > 0
      ? { startingHandicapSource: 'continue' as const, continueFromSubSeriesId: arr[i - 1][1] }
      : {}),
  }));

  const raceStarts: RaceStart[] = [];
  const finishes: Finish[] = [];
  const ratingOverrides: RaceRatingOverride[] = [];
  for (let ri = 0; ri < fixture.races.length; ri++) {
    const fr = fixture.races[ri];
    const raceId = races[ri].id;
    for (const o of fr.ratingOverrides ?? []) {
      const competitorId = sailToId.get(o.sailor);
      if (!competitorId) {
        throw new Error(`Fixture "${fixture.description}": unknown sailor "${o.sailor}" in ratingOverrides`);
      }
      ratingOverrides.push({ id: `ro-${ri}-${o.sailor}-${o.field}`, raceId, competitorId, field: o.field, value: o.value });
    }
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
        redressExcludeRaceIds: redressToIds(f.redressExcludeRaces),
        redressIncludeRaceIds: redressToIds(f.redressIncludeRaces),
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
    ratingOverrides,
    discardThresholds: fixture.series.discardThresholds,
    dnfScoring: fixture.series.dnfScoring ?? 'seriesEntries',
    sailToId,
    subSeriesList,
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
