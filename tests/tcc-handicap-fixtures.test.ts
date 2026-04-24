/**
 * Declarative test runner for TCC handicap scoring fixtures.
 *
 * Each YAML in tests/fixtures/scoring/tcc-handicap/ describes a handicap
 * race: fleet config, start time, competitor ratings, finish times, per-race
 * expected arithmetic (ET, CT, TCF, rank, points), and the series-level
 * standings block. This runner drives them through both calculateFleetStandings
 * (for standings) and calculateHandicapRaceScores (for per-race arithmetic).
 */

import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { calculateFleetStandings, calculateHandicapRaceScores } from '@/lib/scoring';
import { buildFixtureInputs, loadFixturesFromDir } from './fixtures/scoring/types';
import type { Finish } from '@/lib/types';

const FIXTURE_DIR = join(__dirname, 'fixtures/scoring/tcc-handicap');

describe('TCC handicap scoring fixtures', () => {
  const loaded = loadFixturesFromDir(FIXTURE_DIR);

  if (loaded.length === 0) {
    it('has at least one fixture', () => {
      expect(loaded.length).toBeGreaterThan(0);
    });
    return;
  }

  for (const { yamlPath, fixture } of loaded) {
    it(fixture.description, () => {
      const { competitors, fleets, races, finishes, raceStarts, discardThresholds, dnfScoring, sailToId } =
        buildFixtureInputs(fixture);
      const fleet = fleets[0];

      // ─── Per-race arithmetic (CT, TCF, rank) ────────────────────────────
      for (let ri = 0; ri < fixture.races.length; ri++) {
        const fixtureRace = fixture.races[ri];
        if (!fixtureRace.expected) continue;

        const raceId = races[ri].id;
        const raceStart = raceStarts.find((rs) => rs.raceId === raceId);
        if (!raceStart) throw new Error(`${yamlPath}: race ${ri + 1} has no startTime`);
        const raceFinishes: Finish[] = finishes.filter((f) => f.raceId === raceId);

        const { scores, rejections } = calculateHandicapRaceScores(raceFinishes, competitors, raceStart, fleet);

        for (const exp of fixtureRace.expected) {
          const cid = sailToId.get(exp.sailor);
          if (!cid) throw new Error(`${yamlPath}: unknown sailor "${exp.sailor}" in race.expected`);
          const score = scores.get(cid);
          expect(score, `sailor ${exp.sailor} score`).toBeDefined();
          if (!score) continue;

          expect(score.rank, `sailor ${exp.sailor} rank`).toBe(exp.rank);
          expect(score.points, `sailor ${exp.sailor} points`).toBe(exp.points);
          if (exp.elapsedTime !== undefined) {
            expect(score.elapsedTime, `sailor ${exp.sailor} elapsedTime`).toBe(exp.elapsedTime);
          }
          if (exp.tcfApplied !== undefined) {
            expect(score.tcfApplied, `sailor ${exp.sailor} tcfApplied`).toBe(exp.tcfApplied);
          }
          if (exp.correctedTime !== undefined) {
            if (exp.correctedTime !== null && score.correctedTime !== null) {
              expect(score.correctedTime, `sailor ${exp.sailor} correctedTime`).toBeCloseTo(exp.correctedTime, 2);
            } else {
              expect(score.correctedTime, `sailor ${exp.sailor} correctedTime`).toBe(exp.correctedTime);
            }
          }
        }

        // Per-race rejections
        const expectedRejections = fixtureRace.rejected ?? [];
        expect(rejections.length, 'rejection count').toBe(expectedRejections.length);
        for (const exp of expectedRejections) {
          const cid = sailToId.get(exp.sailor);
          if (!cid) throw new Error(`${yamlPath}: unknown sailor "${exp.sailor}" in rejected`);
          const rejection = rejections.find((r) => r.competitorId === cid);
          expect(rejection, `rejection for sailor ${exp.sailor}`).toBeDefined();
          expect(rejection?.reason, `rejection reason for ${exp.sailor}`).toBe(exp.reason);
          expect(scores.has(cid), `sailor ${exp.sailor} should not be in scores`).toBe(false);
        }
      }

      // ─── Series standings ───────────────────────────────────────────────
      const { fleetStandings } = calculateFleetStandings(
        fleets,
        competitors,
        races,
        finishes,
        discardThresholds,
        dnfScoring,
        raceStarts,
      );
      const standings = fleetStandings[0].standings;
      const standingsBySail = new Map(standings.map((s) => [s.competitor.sailNumber, s]));

      for (const exp of fixture.expected.standings) {
        const standing = standingsBySail.get(exp.sailor);
        expect(standing, `No standing for sailor ${exp.sailor}`).toBeDefined();
        if (!standing) continue;
        const label = `sailor ${exp.sailor}`;

        expect(standing.rank, `${label}: rank`).toBe(exp.rank);
        expect(standing.racePoints, `${label}: racePoints`).toEqual(exp.racePoints);
        expect(standing.raceCodes, `${label}: raceCodes`).toEqual(exp.raceCodes);
        expect(standing.raceDiscards, `${label}: raceDiscards`).toEqual(exp.raceDiscards);
        expect(standing.totalPoints, `${label}: totalPoints`).toBe(exp.totalPoints);
        expect(standing.netPoints, `${label}: netPoints`).toBe(exp.netPoints);
      }
    });
  }
});
