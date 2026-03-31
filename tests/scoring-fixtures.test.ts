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
import { calculateStandings } from '@/lib/scoring';
import type { Competitor, Race, Finish, DiscardThreshold, ResultCode } from '@/lib/types';

// ─── Fixture schema types ─────────────────────────────────────────────────────

interface FixtureFinish {
  sailor: string;           // references competitor sailNumber
  position?: number;        // clean finish
  code?: ResultCode;        // DNC | DNF | OCS
  startPresent?: boolean;   // true if marked present in starting area
}

interface FixtureRace {
  number: number;
  finishes: FixtureFinish[];
}

interface FixtureStanding {
  rank: number;
  sailor: string;           // references competitor sailNumber
  racePoints: number[];
  raceCodes: (ResultCode | null)[];
  raceDiscards: boolean[];
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
  competitors: Array<{ sailNumber: string; name: string }>;
  races: FixtureRace[];
  expected: {
    standings: FixtureStanding[];
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildInputs(fixture: ScoringFixture): {
  competitors: Competitor[];
  races: Race[];
  finishes: Finish[];
  discardThresholds: DiscardThreshold[];
  dnfScoring: 'seriesEntries' | 'startingArea';
} {
  const competitors: Competitor[] = fixture.competitors.map((c, i) => ({
    id: `c-${i}`,
    seriesId: 's1',
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
      });
    }
  }

  return { competitors, races, finishes, discardThresholds: fixture.series.discardThresholds, dnfScoring: fixture.series.dnfScoring ?? 'seriesEntries' };
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
      const { competitors, races, finishes, discardThresholds, dnfScoring } = buildInputs(fixture);
      const standings = calculateStandings(competitors, races, finishes, discardThresholds, dnfScoring);

      const sailNumberById = new Map(competitors.map((c) => [c.id, c.sailNumber]));

      for (const expected of fixture.expected.standings) {
        const standing = standings.find(
          (s) => sailNumberById.get(s.competitor.id) === expected.sailor,
        );

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
        expect(standing.totalPoints, `${label}: totalPoints`).toBe(expected.totalPoints);
        expect(standing.netPoints, `${label}: netPoints`).toBe(expected.netPoints);
      }
    });
  }
});
