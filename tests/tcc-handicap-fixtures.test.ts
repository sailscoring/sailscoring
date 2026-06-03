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
      const { competitors, fleets, races, finishes, raceStarts, ratingOverrides, discardThresholds, dnfScoring, sailToId } =
        buildFixtureInputs(fixture);
      const fleet = fleets[0];

      // Build the static applied-TCF map (callers are now responsible for this).
      const tcfMap = new Map<string, number>();
      for (const c of competitors) {
        if (fleet.scoringSystem === 'irc' && c.ircTcc != null) tcfMap.set(c.id, c.ircTcc);
        else if (fleet.scoringSystem === 'py' && c.pyNumber != null) tcfMap.set(c.id, 1000 / c.pyNumber);
      }
      const ratedCompetitors = competitors.filter((c) => tcfMap.has(c.id));

      // ─── Per-race arithmetic (CT, TCF, rank) ────────────────────────────
      for (let ri = 0; ri < fixture.races.length; ri++) {
        const fixtureRace = fixture.races[ri];
        if (!fixtureRace.expected) continue;

        const raceId = races[ri].id;
        const raceStart = raceStarts.find((rs) => rs.raceId === raceId);
        if (!raceStart) throw new Error(`${yamlPath}: race ${ri + 1} has no startTime`);
        const raceFinishes: Finish[] = finishes.filter((f) => f.raceId === raceId);

        const { scores } = calculateHandicapRaceScores(raceFinishes, ratedCompetitors, raceStart, tcfMap, dnfScoring);

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
        ratingOverrides,
      );
      const fleetResult = fleetStandings[0];
      const standings = fleetResult.standings;

      // Rejection check is now orchestrator-level, applied across the whole series.
      // Fixtures may declare rejections per-race; collect them all into one set
      // because the unified semantics are "competitors with no rating are excluded".
      const expectedRejectionSailors = new Set<string>();
      for (const fr of fixture.races) {
        for (const r of fr.rejected ?? []) expectedRejectionSailors.add(r.sailor);
      }
      const expectedRejectionIds = new Set([...expectedRejectionSailors].map((s) => sailToId.get(s)!));
      expect(new Set(fleetResult.rejections.map((r) => r.competitorId))).toEqual(expectedRejectionIds);
      for (const sailor of expectedRejectionSailors) {
        const cid = sailToId.get(sailor)!;
        expect(standings.find((s) => s.competitor.id === cid), `rejected ${sailor} should not appear in standings`).toBeUndefined();
      }
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
