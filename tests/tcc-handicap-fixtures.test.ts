/**
 * Declarative test runner for TCC handicap scoring fixtures.
 *
 * Each YAML file in tests/fixtures/scoring/tcc-handicap/ describes a single
 * handicap race: fleet config, start time, competitor ratings, finish times,
 * and expected per-boat results (ET, CT, TCF, rank, points).
 *
 * Adding a new .yaml file is enough to add a new test.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import { calculateHandicapRaceScores } from '@/lib/scoring';
import type { Competitor, Fleet, Finish, RaceStart } from '@/lib/types';

// ─── Fixture schema ───────────────────────────────────────────────────────────

interface FixtureFleet {
  scoringSystem: 'irc' | 'py';
}

interface FixtureCompetitor {
  sailNumber: string;
  name: string;
  ircTcc?: number;
  pyNumber?: number;
}

interface FixtureFinish {
  sailor: string;
  finishTime?: string;
  code?: string;
}

interface FixtureExpected {
  sailor: string;
  rank: number | null;
  points: number;
  elapsedTime: number | null;
  correctedTime: number | null;
  tcfApplied: number | null;
}

interface HandicapFixture {
  description: string;
  rrs_notes?: string;
  fleet: FixtureFleet;
  startTime: string;
  competitors: FixtureCompetitor[];
  finishes: FixtureFinish[];
  expected: FixtureExpected[];
}

// ─── Test runner ─────────────────────────────────────────────────────────────

const FIXTURE_DIR = join(__dirname, 'fixtures/scoring/tcc-handicap');

describe('TCC handicap scoring fixtures', () => {
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
    let fixture: HandicapFixture;
    try {
      fixture = parseYaml(yamlSource) as HandicapFixture;
    } catch (e) {
      it(`${file} — parses without error`, () => { throw e; });
      continue;
    }

    it(fixture.description, () => {
      const fleet: Fleet = {
        id: 'fl-0',
        seriesId: 's1',
        name: 'Fleet',
        displayOrder: 0,
        scoringSystem: fixture.fleet.scoringSystem,
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
        ...(c.ircTcc != null ? { ircTcc: c.ircTcc } : {}),
        ...(c.pyNumber != null ? { pyNumber: c.pyNumber } : {}),
      }));

      const raceStart: RaceStart = {
        id: 'rs-0',
        raceId: 'r-0',
        fleetIds: ['fl-0'],
        startTime: fixture.startTime,
      };

      const finishes: Finish[] = fixture.finishes.map((f, i) => ({
        id: `fin-${i}`,
        raceId: 'r-0',
        competitorId: sailToId.get(f.sailor) ?? null,
        finishPosition: null,
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

      const scores = calculateHandicapRaceScores(finishes, competitors, raceStart, fleet);

      for (const exp of fixture.expected) {
        const competitorId = sailToId.get(exp.sailor);
        if (!competitorId) {
          throw new Error(`Fixture "${fixture.description}": unknown sailor "${exp.sailor}" in expected`);
        }
        const score = scores.get(competitorId);
        expect(score, `score for sailor ${exp.sailor}`).toBeDefined();
        if (!score) continue;

        expect(score.rank, `sailor ${exp.sailor} rank`).toBe(exp.rank);
        expect(score.points, `sailor ${exp.sailor} points`).toBe(exp.points);
        expect(score.elapsedTime, `sailor ${exp.sailor} elapsedTime`).toBe(exp.elapsedTime);
        expect(score.tcfApplied, `sailor ${exp.sailor} tcfApplied`).toBe(exp.tcfApplied);
        if (exp.correctedTime !== null && score.correctedTime !== null) {
          expect(score.correctedTime, `sailor ${exp.sailor} correctedTime`).toBeCloseTo(exp.correctedTime, 2);
        } else {
          expect(score.correctedTime, `sailor ${exp.sailor} correctedTime`).toBe(exp.correctedTime);
        }
      }
    });
  }
});
