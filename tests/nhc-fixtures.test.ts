/**
 * Declarative test runner for NHC handicap scoring fixtures.
 *
 * Each YAML in tests/fixtures/scoring/nhc/ describes one or more NHC1-scored
 * races: fleet config (with α), starting TCFs, finish times, per-race expected
 * per-boat results, per-race aggregates, and the series-level standings block.
 *
 * Multi-race fixtures verify the running TCF map: race N+1 uses race N's
 * newTcf as its tcfApplied.
 */

import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { calculateFleetStandings } from '@/lib/scoring';
import { buildFixtureInputs, loadFixturesFromDir } from './fixtures/scoring/types';

const FIXTURE_DIR = join(__dirname, 'fixtures/scoring/nhc');

describe('NHC handicap scoring fixtures', () => {
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

      const { fleetStandings } = calculateFleetStandings(
        fleets,
        competitors,
        races,
        finishes,
        discardThresholds,
        dnfScoring,
        raceStarts,
      );
      const result = fleetStandings[0];
      const { standings, rejections } = result;
      const nhcRaceScoresByRaceId = result.nhcRaceScoresByRaceId!;
      const nhcAggregatesByRaceId = result.nhcAggregatesByRaceId!;

      // ─── Per-race arithmetic, aggregates, rejections ────────────────────
      for (let ri = 0; ri < fixture.races.length; ri++) {
        const fixtureRace = fixture.races[ri];
        const raceId = races[ri].id;
        const raceLabel = `race ${ri + 1}`;

        if (fixtureRace.aggregates) {
          const aggs = nhcAggregatesByRaceId.get(raceId);
          expect(aggs, `${raceLabel} aggregates`).toBeDefined();
          if (aggs) {
            expect(aggs.finisherCount, `${raceLabel} finisherCount`).toBe(fixtureRace.aggregates.finisherCount);
            if (fixtureRace.aggregates.ctAvg != null) {
              expect(aggs.ctAvg, `${raceLabel} ctAvg`).toBeCloseTo(fixtureRace.aggregates.ctAvg, 4);
            }
            if (fixtureRace.aggregates.meanTcf != null) {
              expect(aggs.meanTcf, `${raceLabel} meanTcf`).toBeCloseTo(fixtureRace.aggregates.meanTcf, 6);
            }
            if (fixtureRace.aggregates.p50 != null) {
              expect(aggs.p50, `${raceLabel} p50`).toBeCloseTo(fixtureRace.aggregates.p50, 6);
            }
            if (fixtureRace.aggregates.w51 !== undefined) {
              if (fixtureRace.aggregates.w51 === null) {
                expect(aggs.w51, `${raceLabel} w51`).toBeNull();
              } else {
                expect(aggs.w51, `${raceLabel} w51`).toBeCloseTo(fixtureRace.aggregates.w51, 6);
              }
            }
            if (fixtureRace.aggregates.sMean != null) {
              expect(aggs.sMean, `${raceLabel} sMean`).toBeCloseTo(fixtureRace.aggregates.sMean, 6);
            }
            if (fixtureRace.aggregates.sStdev != null) {
              expect(aggs.sStdev, `${raceLabel} sStdev`).toBeCloseTo(fixtureRace.aggregates.sStdev, 6);
            }
            if (fixtureRace.aggregates.extremeCount != null) {
              expect(aggs.extremeCount, `${raceLabel} extremeCount`).toBe(fixtureRace.aggregates.extremeCount);
            }
            if (fixtureRace.aggregates.realignmentFactor != null) {
              expect(aggs.realignmentFactor, `${raceLabel} realignmentFactor`).toBeCloseTo(fixtureRace.aggregates.realignmentFactor, 6);
            }
            if (fixtureRace.aggregates.updateSuppressed != null) {
              expect(aggs.updateSuppressed, `${raceLabel} updateSuppressed`).toBe(fixtureRace.aggregates.updateSuppressed);
            }
          }
        }

        if (fixtureRace.expected) {
          const scores = nhcRaceScoresByRaceId.get(raceId);
          expect(scores, `${raceLabel} scores`).toBeDefined();
          if (!scores) continue;

          for (const exp of fixtureRace.expected) {
            const cid = sailToId.get(exp.sailor);
            if (!cid) throw new Error(`${yamlPath}: unknown sailor "${exp.sailor}" in ${raceLabel}.expected`);
            const score = scores.get(cid);
            expect(score, `${raceLabel} sailor ${exp.sailor} score`).toBeDefined();
            if (!score) continue;

            expect(score.rank, `${raceLabel} ${exp.sailor} rank`).toBe(exp.rank);
            expect(score.points, `${raceLabel} ${exp.sailor} points`).toBeCloseTo(exp.points, 6);
            if (exp.elapsedTime !== undefined) {
              expect(score.elapsedTime, `${raceLabel} ${exp.sailor} elapsedTime`).toBe(exp.elapsedTime);
            }
            if (exp.correctedTime !== undefined) {
              if (exp.correctedTime !== null && score.correctedTime !== null) {
                expect(score.correctedTime, `${raceLabel} ${exp.sailor} correctedTime`).toBeCloseTo(exp.correctedTime, 4);
              } else {
                expect(score.correctedTime, `${raceLabel} ${exp.sailor} correctedTime`).toBe(exp.correctedTime);
              }
            }
            if (exp.tcfApplied !== undefined) {
              if (exp.tcfApplied !== null && score.tcfApplied !== null) {
                expect(score.tcfApplied, `${raceLabel} ${exp.sailor} tcfApplied`).toBeCloseTo(exp.tcfApplied, 6);
              } else {
                expect(score.tcfApplied, `${raceLabel} ${exp.sailor} tcfApplied`).toBe(exp.tcfApplied);
              }
            }
            if (exp.newTcf !== undefined) {
              if (exp.newTcf !== null && score.newTcf !== null) {
                expect(score.newTcf, `${raceLabel} ${exp.sailor} newTcf`).toBeCloseTo(exp.newTcf, 6);
              } else {
                expect(score.newTcf, `${raceLabel} ${exp.sailor} newTcf`).toBe(exp.newTcf);
              }
            }
            if (exp.code) {
              expect(score.resultCode, `${raceLabel} ${exp.sailor} resultCode`).toBe(exp.code);
            }
            if (exp.fairTcf != null) {
              expect(score.nhc?.fairTcf, `${raceLabel} ${exp.sailor} fairTcf`).toBeCloseTo(exp.fairTcf, 6);
            }
            if (exp.compScore != null) {
              expect(score.nhc?.compScore, `${raceLabel} ${exp.sailor} compScore`).toBeCloseTo(exp.compScore, 6);
            }
            if (exp.isExtreme != null) {
              expect(score.nhc?.isExtreme, `${raceLabel} ${exp.sailor} isExtreme`).toBe(exp.isExtreme);
            }
            if (exp.alphaApplied != null) {
              expect(score.nhc?.alphaApplied, `${raceLabel} ${exp.sailor} alphaApplied`).toBeCloseTo(exp.alphaApplied, 6);
            }
            if (exp.provisionalTcf != null) {
              expect(score.nhc?.provisionalTcf, `${raceLabel} ${exp.sailor} provisionalTcf`).toBeCloseTo(exp.provisionalTcf, 6);
            }
            if (exp.adjustment != null) {
              expect(score.nhc?.adjustment, `${raceLabel} ${exp.sailor} adjustment`).toBeCloseTo(exp.adjustment, 6);
            }
          }
        }

        // Per-race `rejected` — NHC rejections are fleet-level (reported once,
        // not per race). Verify the rejected competitor is absent from per-race
        // scores; the canonical rejection list is asserted at series level below.
        for (const rej of fixtureRace.rejected ?? []) {
          const cid = sailToId.get(rej.sailor);
          if (!cid) throw new Error(`${yamlPath}: unknown sailor "${rej.sailor}" in rejected`);
          const scores = nhcRaceScoresByRaceId.get(raceId);
          expect(scores?.has(cid) ?? false, `${raceLabel} ${rej.sailor} should not be in scores`).toBe(false);
        }
      }

      // ─── Series-level rejections (union across races) ───────────────────
      const allFixtureRejections = new Map<string, string>();
      for (const race of fixture.races) {
        for (const r of race.rejected ?? []) {
          allFixtureRejections.set(r.sailor, r.reason);
        }
      }
      expect(rejections.length, 'series rejection count').toBe(allFixtureRejections.size);
      for (const [sailor, reason] of allFixtureRejections) {
        const cid = sailToId.get(sailor);
        if (!cid) throw new Error(`${yamlPath}: unknown sailor "${sailor}" in rejected`);
        const rejection = rejections.find((r) => r.competitorId === cid);
        expect(rejection, `rejection for ${sailor}`).toBeDefined();
        expect(rejection?.reason, `rejection reason for ${sailor}`).toBe(reason);
      }

      // ─── Series standings ───────────────────────────────────────────────
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
