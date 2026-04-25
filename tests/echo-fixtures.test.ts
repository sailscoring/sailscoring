/**
 * Declarative test runner for ECHO handicap scoring fixtures.
 *
 * Each YAML in tests/fixtures/scoring/echo/ describes one or more ECHO-scored
 * races: fleet config (with α), starting handicaps (Irish Sailing 2022 ECHO
 * Guide notation), finish times, per-race expected per-boat results, per-race
 * aggregates (including ΣH_S and Σ(1/T_E)), and the series-level standings.
 *
 * Multi-race fixtures verify the running handicap map: race N+1 uses race N's
 * new_H as its tcfApplied. The ≤2-finisher gate (sample SI 12) is exercised
 * by a dedicated fixture.
 */

import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { calculateFleetStandings } from '@/lib/scoring';
import { buildFixtureInputs, loadFixturesFromDir } from './fixtures/scoring/types';

const FIXTURE_DIR = join(__dirname, 'fixtures/scoring/echo');

describe('ECHO handicap scoring fixtures', () => {
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
      const echoRaceScoresByRaceId = result.echoRaceScoresByRaceId!;
      const echoAggregatesByRaceId = result.echoAggregatesByRaceId!;

      // ─── Per-race arithmetic, aggregates, rejections ────────────────────
      for (let ri = 0; ri < fixture.races.length; ri++) {
        const fixtureRace = fixture.races[ri];
        const raceId = races[ri].id;
        const raceLabel = `race ${ri + 1}`;

        if (fixtureRace.aggregates) {
          const aggs = echoAggregatesByRaceId.get(raceId);
          expect(aggs, `${raceLabel} aggregates`).toBeDefined();
          if (aggs) {
            expect(aggs.alpha, `${raceLabel} alpha`).toBeCloseTo(fixtureRace.aggregates.alpha, 6);
            expect(aggs.finisherCount, `${raceLabel} finisherCount`).toBe(fixtureRace.aggregates.finisherCount);
            // ctAvg / meanTcf are optional in ECHO fixtures — they're a NHC
            // legacy and the IS notation prefers ΣH_S / Σ(1/T_E).
            if (fixtureRace.aggregates.ctAvg != null) {
              expect(aggs.ctAvg, `${raceLabel} ctAvg`).toBeCloseTo(fixtureRace.aggregates.ctAvg, 4);
            }
            if (fixtureRace.aggregates.meanTcf != null) {
              expect(aggs.meanTcf, `${raceLabel} meanTcf`).toBeCloseTo(fixtureRace.aggregates.meanTcf, 6);
            }
            if (fixtureRace.aggregates.sumH != null) {
              expect(aggs.sumH, `${raceLabel} sumH`).toBeCloseTo(fixtureRace.aggregates.sumH, 6);
            }
            if (fixtureRace.aggregates.sumReciprocalEt != null) {
              expect(aggs.sumReciprocalEt, `${raceLabel} sumReciprocalEt`).toBeCloseTo(fixtureRace.aggregates.sumReciprocalEt, 8);
            }
            if (fixtureRace.aggregates.updateSuppressed != null) {
              expect(aggs.updateSuppressed, `${raceLabel} updateSuppressed`).toBe(fixtureRace.aggregates.updateSuppressed);
            }
          }
        }

        if (fixtureRace.expected) {
          const scores = echoRaceScoresByRaceId.get(raceId);
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
            // ECHO fixtures may use either `newTcf` or `newH` (alias) — check both.
            // 4 dp precision suffices: user-visible precision is 3 dp; the
            // verification contract is "engine output rounds to the same 3 dp
            // as the formula" rather than "engine output equals the formula
            // to all double-precision digits."
            const expectedNew = exp.newTcf ?? exp.newH;
            if (expectedNew !== undefined) {
              if (expectedNew !== null && score.newTcf !== null) {
                expect(score.newTcf, `${raceLabel} ${exp.sailor} newTcf`).toBeCloseTo(expectedNew, 4);
              } else {
                expect(score.newTcf, `${raceLabel} ${exp.sailor} newTcf`).toBe(expectedNew);
              }
            }
            if (exp.code) {
              expect(score.resultCode, `${raceLabel} ${exp.sailor} resultCode`).toBe(exp.code);
            }
            // ECHO fixtures use `pi` (Performance Index in IS notation) which
            // maps to score.echo.fairTcf. They may also still use `fairTcf`.
            const expectedPi = exp.pi ?? exp.fairTcf;
            if (expectedPi != null) {
              expect(score.echo?.fairTcf, `${raceLabel} ${exp.sailor} pi`).toBeCloseTo(expectedPi, 4);
            }
            if (exp.adjustment != null) {
              expect(score.echo?.adjustment, `${raceLabel} ${exp.sailor} adjustment`).toBeCloseTo(exp.adjustment, 4);
            }
          }
        }

        // Per-race `rejected` — ECHO rejections are fleet-level. Verify
        // rejected competitors are absent from per-race scores.
        for (const rej of fixtureRace.rejected ?? []) {
          const cid = sailToId.get(rej.sailor);
          if (!cid) throw new Error(`${yamlPath}: unknown sailor "${rej.sailor}" in rejected`);
          const scores = echoRaceScoresByRaceId.get(raceId);
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
