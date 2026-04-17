/**
 * Declarative test runner for NHC handicap scoring fixtures.
 *
 * Each YAML file in tests/fixtures/scoring/nhc/ describes one or more
 * NHC1-scored races: fleet config (with α), starting TCFs, finish times,
 * and per-race expected per-boat results plus fleet-race aggregates.
 *
 * Multi-race fixtures verify the running TCF map (race N+1 uses race N's
 * newTcf as its tcfApplied).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import { calculateNhcRaceScores } from '@/lib/scoring';
import type { Competitor, Fleet, Finish, RaceStart } from '@/lib/types';

// ─── Fixture schema ───────────────────────────────────────────────────────────

interface FixtureFleet {
  scoringSystem: 'nhc';
  alpha: number;
}

interface FixtureCompetitor {
  sailNumber: string;
  name: string;
  nhcStartingTcf?: number;
}

interface FixtureFinish {
  sailor: string;
  finishTime?: string;
  code?: string;
}

interface FixtureExpectedNhc {
  sailor: string;
  rank: number | null;
  points: number;
  elapsedTime: number | null;
  correctedTime: number | null;
  tcfApplied: number | null;
  newTcf: number | null;
  code?: string;
  ctRatio?: number;
  fairTcf?: number;
  adjustment?: number;
}

interface FixtureAggregates {
  alpha: number;
  finisherCount: number;
  ctAvg: number;
  meanTcf: number;
}

interface FixtureRejected {
  sailor: string;
  reason: string;
}

interface FixtureRace {
  startTime: string;
  finishes: FixtureFinish[];
  expected: FixtureExpectedNhc[];
  aggregates: FixtureAggregates;
  rejected?: FixtureRejected[];
}

interface NhcFixture {
  description: string;
  notes?: string;
  fleet: FixtureFleet;
  competitors: FixtureCompetitor[];
  races: FixtureRace[];
}

// ─── Test runner ─────────────────────────────────────────────────────────────

const FIXTURE_DIR = join(__dirname, 'fixtures/scoring/nhc');

describe('NHC handicap scoring fixtures', () => {
  const yamlFiles = readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.yaml'))
    .sort();

  if (yamlFiles.length === 0) {
    it('has at least one fixture', () => {
      expect(yamlFiles.length).toBeGreaterThan(0);
    });
  }

  for (const file of yamlFiles) {
    const yamlPath = join(FIXTURE_DIR, file);
    const yamlSource = readFileSync(yamlPath, 'utf-8');
    let fixture: NhcFixture;
    try {
      fixture = parseYaml(yamlSource) as NhcFixture;
    } catch (e) {
      it(`${file} — parses without error`, () => { throw e; });
      continue;
    }

    it(fixture.description, () => {
      const fleet: Fleet = {
        id: 'fl-0',
        seriesId: 's1',
        name: 'NHC',
        displayOrder: 0,
        scoringSystem: 'nhc',
        nhcAlpha: fixture.fleet.alpha,
      };

      const sailToId = new Map(fixture.competitors.map((c, i) => [c.sailNumber, `c-${i}`]));

      const competitors: Competitor[] = fixture.competitors.map((c, i) => ({
        id: `c-${i}`,
        seriesId: 's1',
        fleetIds: ['fl-0'],
        sailNumber: c.sailNumber,
        name: c.name,
        club: '',
        gender: '',
        age: null,
        createdAt: 0,
        ...(c.nhcStartingTcf != null ? { nhcStartingTcf: c.nhcStartingTcf } : {}),
      }));

      // Running TCF map: starts from each competitor's nhcStartingTcf
      const tcfMap = new Map<string, number>();
      for (const c of competitors) {
        if (c.nhcStartingTcf != null) tcfMap.set(c.id, c.nhcStartingTcf);
      }

      for (let raceIdx = 0; raceIdx < fixture.races.length; raceIdx++) {
        const race = fixture.races[raceIdx];
        const raceLabel = `race ${raceIdx + 1}`;
        const raceStart: RaceStart = {
          id: `rs-${raceIdx}`,
          raceId: `r-${raceIdx}`,
          fleetIds: ['fl-0'],
          startTime: race.startTime,
        };
        const finishes: Finish[] = race.finishes.map((f, i) => ({
          id: `fin-${raceIdx}-${i}`,
          raceId: `r-${raceIdx}`,
          competitorId: sailToId.get(f.sailor) ?? null,
          sortOrder: null,
          ...(f.finishTime ? { finishTime: f.finishTime } : {}),
          resultCode: (f.code as Finish['resultCode']) ?? null,
          startPresent: null,
          penaltyCode: null,
          penaltyOverride: null,
          redressMethod: null,
          redressExcludeRaces: null,
          redressIncludeRaces: null,
          redressIncludeAllLater: false,
          redressPoints: null,
        }));

        const { scores, rejections, nhcAggregates, newTcfByCompetitorId } =
          calculateNhcRaceScores(finishes, competitors, raceStart, fleet, tcfMap);

        // Aggregates
        expect(nhcAggregates.alpha, `${raceLabel} alpha`).toBeCloseTo(race.aggregates.alpha, 6);
        expect(nhcAggregates.finisherCount, `${raceLabel} finisherCount`).toBe(race.aggregates.finisherCount);
        expect(nhcAggregates.ctAvg, `${raceLabel} ctAvg`).toBeCloseTo(race.aggregates.ctAvg, 4);
        expect(nhcAggregates.meanTcf, `${raceLabel} meanTcf`).toBeCloseTo(race.aggregates.meanTcf, 6);

        // Per-boat expected
        for (const exp of race.expected) {
          const cid = sailToId.get(exp.sailor);
          if (!cid) throw new Error(`${file}: unknown sailor "${exp.sailor}" in expected`);
          const score = scores.get(cid);
          expect(score, `${raceLabel} sailor ${exp.sailor} score`).toBeDefined();
          if (!score) continue;

          expect(score.rank, `${raceLabel} ${exp.sailor} rank`).toBe(exp.rank);
          expect(score.points, `${raceLabel} ${exp.sailor} points`).toBeCloseTo(exp.points, 6);
          expect(score.elapsedTime, `${raceLabel} ${exp.sailor} elapsedTime`).toBe(exp.elapsedTime);
          if (exp.correctedTime !== null && score.correctedTime !== null) {
            expect(score.correctedTime, `${raceLabel} ${exp.sailor} correctedTime`).toBeCloseTo(exp.correctedTime, 4);
          } else {
            expect(score.correctedTime, `${raceLabel} ${exp.sailor} correctedTime`).toBe(exp.correctedTime);
          }
          if (exp.tcfApplied !== null && score.tcfApplied !== null) {
            expect(score.tcfApplied, `${raceLabel} ${exp.sailor} tcfApplied`).toBeCloseTo(exp.tcfApplied, 6);
          } else {
            expect(score.tcfApplied, `${raceLabel} ${exp.sailor} tcfApplied`).toBe(exp.tcfApplied);
          }
          if (exp.newTcf !== null && score.newTcf !== null) {
            expect(score.newTcf, `${raceLabel} ${exp.sailor} newTcf`).toBeCloseTo(exp.newTcf, 6);
          } else {
            expect(score.newTcf, `${raceLabel} ${exp.sailor} newTcf`).toBe(exp.newTcf);
          }
          if (exp.code) {
            expect(score.resultCode, `${raceLabel} ${exp.sailor} resultCode`).toBe(exp.code);
          }
          if (exp.ctRatio != null) {
            expect(score.nhc?.ctRatio, `${raceLabel} ${exp.sailor} ctRatio`).toBeCloseTo(exp.ctRatio, 6);
          }
          if (exp.fairTcf != null) {
            expect(score.nhc?.fairTcf, `${raceLabel} ${exp.sailor} fairTcf`).toBeCloseTo(exp.fairTcf, 6);
          }
          if (exp.adjustment != null) {
            expect(score.nhc?.adjustment, `${raceLabel} ${exp.sailor} adjustment`).toBeCloseTo(exp.adjustment, 6);
          }
        }

        // Rejections
        const expectedRejections = race.rejected ?? [];
        expect(rejections.length, `${raceLabel} rejection count`).toBe(expectedRejections.length);
        for (const rej of expectedRejections) {
          const cid = sailToId.get(rej.sailor);
          if (!cid) throw new Error(`${file}: unknown sailor "${rej.sailor}" in rejected`);
          const found = rejections.find((r) => r.competitorId === cid);
          expect(found, `${raceLabel} rejection for ${rej.sailor}`).toBeDefined();
          expect(found?.reason, `${raceLabel} ${rej.sailor} rejection reason`).toBe(rej.reason);
          expect(scores.has(cid), `${raceLabel} ${rej.sailor} should not be in scores`).toBe(false);
        }

        // Update running TCF map for next race
        for (const [cid, newTcf] of newTcfByCompetitorId) {
          tcfMap.set(cid, newTcf);
        }
      }
    });
  }
});
