/**
 * Declarative scoring-fixture tests for scratch / fleets / codes / sub-series
 * fixtures.
 *
 * Each YAML in the scratch/, fleets/, codes/, and sub-series/ subdirectories
 * describes a complete scoring scenario: series config, competitors, races,
 * finishes, and expected standings. This runner drives them through
 * calculateFleetStandings (whole-series `expected.standings`) and
 * calculateSubSeriesFleetStandings (per-block `expected.subSeries`).
 *
 * Adding a new .yaml file in those directories is enough to add a new test.
 */

import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { calculateFleetStandings, calculateSubSeriesFleetStandings, type FleetStandingsEntry } from '@/lib/scoring';
import { buildFixtureInputs, loadFixturesFromDir, type FixtureStanding } from './fixtures/scoring/types';
import type { Standing } from '@/lib/types';

const fixtureDir = join(__dirname, 'fixtures/scoring');
const SUBDIRS = ['scratch', 'fleets', 'codes', 'sub-series'];

function assertExpectedStandings(
  expectedStandings: FixtureStanding[],
  fleetStandings: FleetStandingsEntry[],
  context: string,
) {
  // Flatten to a map keyed by sailNumber (plus an optional per-sailor fleet
  // name, needed for multi-fleet fixtures where two competitors can share
  // a sail number across fleets).
  const standingsBySail = new Map<string, Standing>();
  const fleetNameBySail = new Map<string, string>();
  for (const { fleet, standings } of fleetStandings) {
    for (const s of standings) {
      standingsBySail.set(s.competitor.sailNumber, s);
      fleetNameBySail.set(s.competitor.sailNumber, fleet.name);
    }
  }

  const expectedSailors = new Set(expectedStandings.map((e) => e.sailor));
  for (const sail of standingsBySail.keys()) {
    expect(expectedSailors.has(sail), `${context}: unexpected sailor ${sail} in standings`).toBe(true);
  }

  for (const expected of expectedStandings) {
    const standing = standingsBySail.get(expected.sailor);
    expect(standing, `${context}: no standing for sailor ${expected.sailor}`).toBeDefined();
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
    if (expected.racePenaltyCodes !== undefined) {
      expect(standing.racePenaltyCodes, `${label}: racePenaltyCodes`).toEqual(expected.racePenaltyCodes);
    }
    if (expected.raceRedressFlags !== undefined) {
      expect(standing.raceRedressFlags, `${label}: raceRedressFlags`).toEqual(expected.raceRedressFlags);
    }
    expect(standing.totalPoints, `${label}: totalPoints`).toBe(expected.totalPoints);
    expect(standing.netPoints, `${label}: netPoints`).toBe(expected.netPoints);

    if (expected.fleet !== undefined) {
      expect(fleetNameBySail.get(expected.sailor), `${label}: fleet`).toBe(expected.fleet);
    }
  }
}

describe('scoring fixtures', () => {
  for (const subdir of SUBDIRS) {
    const loaded = loadFixturesFromDir(join(fixtureDir, subdir));
    for (const { yamlPath, fixture } of loaded) {
      it(`${subdir}/${yamlPath.split('/').pop()} — ${fixture.description}`, () => {
        const { competitors, fleets, races, finishes, raceStarts, discardThresholds, dnfScoring, subSeriesList } =
          buildFixtureInputs(fixture);

        if (fixture.expected.standings) {
          const { fleetStandings } = calculateFleetStandings(
            fleets,
            competitors,
            races,
            finishes,
            discardThresholds,
            dnfScoring,
            raceStarts,
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
            dnfScoring,
            raceStarts,
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
