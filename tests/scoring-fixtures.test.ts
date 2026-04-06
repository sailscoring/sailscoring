/**
 * Declarative scoring fixture tests.
 *
 * Each YAML file in tests/fixtures/scoring/ describes a complete scoring scenario:
 * series config, competitors, races, finishes, and expected standings. This runner
 * parses the files and asserts that calculateStandings() produces the expected output.
 *
 * Adding a new .yaml file to the fixtures directory is enough to add a new test.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import { calculateStandings, calculateFleetStandings } from '@/lib/scoring';
import type { Competitor, Fleet, Race, Finish, DiscardThreshold, ResultCode, PenaltyCode } from '@/lib/types';

// ─── Fixture schema types ─────────────────────────────────────────────────────

interface FixtureFinish {
  sailor: string;           // references competitor sailNumber
  position?: number;        // clean finish
  code?: ResultCode;        // DNC | DNF | OCS | RDG | …
  startPresent?: boolean;   // true if marked present in starting area
  penaltyCode?: PenaltyCode; // additive penalty (ZFP | SCP | DPI)
  penaltyOverride?: number;  // SCP: percentage; DPI: stated points
  // Redress (RDG)
  redressMethod?: 'all_races' | 'races_before' | 'stated';
  redressExcludeRaces?: number[];
  redressIncludeRaces?: number[];
  redressIncludeAllLater?: boolean;
  redressPoints?: number;
}

interface FixtureRace {
  number: number;
  finishes: FixtureFinish[];
}

interface FixtureStanding {
  rank: number;
  sailor: string;           // references competitor sailNumber
  fleet?: string;           // required when fixture has multiple fleets
  racePoints: number[];
  raceCodes: (ResultCode | null)[];
  raceDiscards: boolean[];
  raceNonDiscardable?: boolean[];         // optional; assert only when present in fixture
  racePenaltyCodes?: (PenaltyCode | null)[];  // optional; assert only when present in fixture
  raceRedressFlags?: boolean[];           // optional; assert only when present in fixture
  totalPoints: number;
  netPoints: number;
}

interface ScoringFixture {
  description: string;
  rrs_notes?: string;
  series: {
    discardThresholds: DiscardThreshold[];
    dnfScoring?: 'seriesEntries' | 'startingArea';
  };
  competitors: Array<{ sailNumber: string; name: string; fleet?: string }>;
  races: FixtureRace[];
  expected: {
    standings: FixtureStanding[];
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildInputs(fixture: ScoringFixture): {
  competitors: Competitor[];
  fleets: Fleet[];
  races: Race[];
  finishes: Finish[];
  discardThresholds: DiscardThreshold[];
  dnfScoring: 'seriesEntries' | 'startingArea';
} {
  // Build fleets from unique fleet names in competitor list
  const fleetNames = [...new Set(fixture.competitors.map((c) => c.fleet ?? 'Default'))];
  const fleets: Fleet[] = fleetNames.map((name, i) => ({
    id: `fl-${i}`,
    seriesId: 's1',
    name,
    displayOrder: i,
  }));
  const fleetIdByName = new Map(fleets.map((f) => [f.name, f.id]));

  const competitors: Competitor[] = fixture.competitors.map((c, i) => ({
    id: `c-${i}`,
    seriesId: 's1',
    fleetId: fleetIdByName.get(c.fleet ?? 'Default') ?? 'f1',
    sailNumber: c.sailNumber,
    name: c.name,
    club: '',
    gender: '',
    age: null,
    createdAt: 0,
  }));

  const sailNumberToId = new Map(competitors.map((c) => [c.sailNumber, c.id]));

  const races: Race[] = fixture.races.map((r, i) => ({
    id: `r-${i}`,
    seriesId: 's1',
    raceNumber: r.number,
    date: '2025-01-01',
    createdAt: 0,
  }));

  const finishes: Finish[] = [];
  for (let ri = 0; ri < fixture.races.length; ri++) {
    const fixtureRace = fixture.races[ri];
    const race = races[ri];
    for (const f of fixtureRace.finishes) {
      const competitorId = sailNumberToId.get(f.sailor);
      if (!competitorId) {
        throw new Error(`Fixture "${fixture.description}": unknown sailor "${f.sailor}" in race ${fixtureRace.number}`);
      }
      finishes.push({
        id: `f-${ri}-${f.sailor}`,
        raceId: race.id,
        competitorId,
        finishPosition: f.position ?? null,
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

  return { competitors, fleets, races, finishes, discardThresholds: fixture.series.discardThresholds, dnfScoring: fixture.series.dnfScoring ?? 'seriesEntries' };
}

// ─── Load and run fixture files ───────────────────────────────────────────────

const fixtureDir = join(__dirname, 'fixtures/scoring');
const fixtureFiles = readdirSync(fixtureDir, { recursive: true, encoding: 'utf-8' })
  .filter((f) => f.endsWith('.yaml'))
  .map((f) => join(fixtureDir, f));

if (fixtureFiles.length === 0) {
  throw new Error(`No fixture files found in ${fixtureDir}`);
}

describe('scoring fixtures', () => {
  for (const filePath of fixtureFiles.sort()) {
    const raw = readFileSync(filePath, 'utf-8');
    const fixture = parseYaml(raw) as ScoringFixture;

    it(fixture.description, () => {
      const { competitors, fleets, races, finishes, discardThresholds, dnfScoring } = buildInputs(fixture);
      const isMultiFleet = fleets.length > 1;

      // For multi-fleet fixtures, build a flat map of sailNumber → standing across all fleets
      let standingsBySailNumber: Map<string, import('@/lib/types').Standing>;
      let fleetNameBySailNumber: Map<string, string> | undefined;
      if (isMultiFleet) {
        const { fleetStandings } = calculateFleetStandings(fleets, competitors, races, finishes, discardThresholds, dnfScoring);
        standingsBySailNumber = new Map();
        fleetNameBySailNumber = new Map();
        for (const { fleet, standings } of fleetStandings) {
          for (const s of standings) {
            standingsBySailNumber.set(s.competitor.sailNumber, s);
            fleetNameBySailNumber.set(s.competitor.sailNumber, fleet.name);
          }
        }
      } else {
        const { standings } = calculateStandings(competitors, races, finishes, discardThresholds, dnfScoring);
        standingsBySailNumber = new Map(standings.map((s) => [s.competitor.sailNumber, s]));
      }

      for (const expected of fixture.expected.standings) {
        const standing = standingsBySailNumber.get(expected.sailor);

        expect(
          standing,
          `No standing found for sailor ${expected.sailor}`,
        ).toBeDefined();

        if (!standing) continue;

        const label = `sailor ${expected.sailor}`;

        expect(standing.rank, `${label}: rank`).toBe(expected.rank);
        expect(standing.racePoints, `${label}: racePoints`).toEqual(expected.racePoints);
        expect(standing.raceCodes, `${label}: raceCodes`).toEqual(expected.raceCodes);
        expect(standing.raceDiscards, `${label}: raceDiscards`).toEqual(expected.raceDiscards);
        if (expected.raceNonDiscardable !== undefined) {
          expect(standing.raceNonDiscardable, `${label}: raceNonDiscardable`).toEqual(expected.raceNonDiscardable);
        }
        if (expected.racePenaltyCodes !== undefined) {
          expect(standing.racePenaltyCodes, `${label}: racePenaltyCodes`).toEqual(expected.racePenaltyCodes);
        }
        if (expected.raceRedressFlags !== undefined) {
          expect(standing.raceRedressFlags, `${label}: raceRedressFlags`).toEqual(expected.raceRedressFlags);
        }
        expect(standing.totalPoints, `${label}: totalPoints`).toBe(expected.totalPoints);
        expect(standing.netPoints, `${label}: netPoints`).toBe(expected.netPoints);
      }
    });
  }
});
