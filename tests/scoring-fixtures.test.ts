/**
 * Declarative scoring-fixture tests for scratch / fleets / codes / discards /
 * high-point / race-options / sub-series / entries fixtures.
 *
 * Each YAML in those subdirectories describes a complete scoring scenario:
 * series config, competitors, races, finishes, and expected standings. This
 * runner drives them through calculateFleetStandings (whole-series
 * `expected.standings`) and calculateSubSeriesFleetStandings (per-block
 * `expected.subSeries`).
 *
 * Adding a new .yaml file in those directories is enough to add a new test.
 */

import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { calculateFleetStandings, calculateSubSeriesFleetStandings, type FleetStandingsEntry } from '@/lib/scoring';
import { buildFixtureInputs, loadFixturesFromDir, type FixtureStanding } from './fixtures/scoring/types';
import type { Standing } from '@/lib/types';

const fixtureDir = join(__dirname, 'fixtures/scoring');
const SUBDIRS = ['scratch', 'fleets', 'codes', 'discards', 'high-point', 'race-options', 'sub-series', 'entries'];

function assertExpectedStandings(
  expectedStandings: FixtureStanding[],
  fleetStandings: FleetStandingsEntry[],
  context: string,
) {
  // Every standing, with its fleet's name. A boat in two fleets has a row in
  // each, so an expected row that names its fleet is matched on both; one
  // that doesn't is matched on the sail number alone.
  const rows = fleetStandings.flatMap(({ fleet, standings }) => standings.map((s) => ({ fleet: fleet.name, s })));
  const matches = (e: FixtureStanding, r: (typeof rows)[number]) =>
    r.s.competitor.sailNumber === e.sailor && (e.fleet === undefined || e.fleet === r.fleet);

  for (const r of rows) {
    expect(
      expectedStandings.some((e) => matches(e, r)),
      `${context}: unexpected sailor ${r.s.competitor.sailNumber} in ${r.fleet} standings`,
    ).toBe(true);
  }

  for (const expected of expectedStandings) {
    const found = rows.filter((r) => matches(expected, r));
    expect(found.length, `${context}: standings for sailor ${expected.sailor}${expected.fleet ? ` in ${expected.fleet}` : ''}`).toBe(1);
    const standing = found[0]?.s;
    if (!standing) continue;
    const label = `${context}: sailor ${expected.sailor}`;

    expect(standing.rank, `${label}: rank`).toBe(expected.rank);
    expect(standing.racePoints, `${label}: racePoints`).toEqual(expected.racePoints);
    expect(standing.raceCodes, `${label}: raceCodes`).toEqual(expected.raceCodes);
    expect(standing.raceDiscards, `${label}: raceDiscards`).toEqual(expected.raceDiscards);
    if (expected.raceNonDiscardable !== undefined) {
      expect(standing.raceNonDiscardable, `${label}: raceNonDiscardable`).toEqual(expected.raceNonDiscardable);
    }
    if (expected.raceExcluded !== undefined) {
      expect(standing.raceExcluded, `${label}: raceExcluded`).toEqual(expected.raceExcluded);
    }
    if (expected.raceNotScored !== undefined) {
      expect(standing.raceNotScored, `${label}: raceNotScored`).toEqual(expected.raceNotScored);
    }
    if (expected.raceNotInFleet !== undefined) {
      expect(standing.raceNotInFleet, `${label}: raceNotInFleet`).toEqual(expected.raceNotInFleet);
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
}

describe('scoring fixtures', () => {
  for (const subdir of SUBDIRS) {
    const loaded = loadFixturesFromDir(join(fixtureDir, subdir));
    for (const { yamlPath, fixture } of loaded) {
      it(`${subdir}/${yamlPath.split('/').pop()} — ${fixture.description}`, () => {
        const { competitors, fleets, races, finishes, raceStarts, ratingOverrides, discardThresholds, discardRule, codes, excludeDncOnlyCompetitors, subSeriesList } =
          buildFixtureInputs(fixture);

        if (fixture.expected.standings) {
          const { fleetStandings } = calculateFleetStandings(
            fleets,
            competitors,
            races,
            finishes,
            discardThresholds,
            codes,
            raceStarts,
            ratingOverrides,
            undefined,
            undefined,
            discardRule,
            { excludeDncOnlyCompetitors },
          );
          assertExpectedStandings(fixture.expected.standings, fleetStandings, 'series');
        }

        if (fixture.expected.subSeries) {
          const blocks = calculateSubSeriesFleetStandings(
            subSeriesList,
            fleets,
            competitors,
            races,
            finishes,
            discardThresholds,
            codes,
            raceStarts,
            ratingOverrides,
            excludeDncOnlyCompetitors,
            discardRule,
          );
          for (const expectedBlock of fixture.expected.subSeries) {
            const block = blocks.find((b) => b.subSeries.name === expectedBlock.name);
            expect(block, `No sub-series named ${expectedBlock.name}`).toBeDefined();
            if (!block) continue;
            assertExpectedStandings(expectedBlock.standings, block.fleetStandings, expectedBlock.name);
          }
        }
      });
    }
  }
});
