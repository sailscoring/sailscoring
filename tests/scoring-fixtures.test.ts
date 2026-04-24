/**
 * Declarative scoring-fixture tests for scratch / fleets / codes fixtures.
 *
 * Each YAML in the scratch/, fleets/, and codes/ subdirectories describes a
 * complete scoring scenario: series config, competitors, races, finishes,
 * and expected series standings. This runner drives them through
 * calculateFleetStandings and asserts the standings block.
 *
 * Adding a new .yaml file in those directories is enough to add a new test.
 */

import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { calculateFleetStandings } from '@/lib/scoring';
import { buildFixtureInputs, loadFixturesFromDir } from './fixtures/scoring/types';
import type { Standing } from '@/lib/types';

const fixtureDir = join(__dirname, 'fixtures/scoring');
const SUBDIRS = ['scratch', 'fleets', 'codes'];

describe('scoring fixtures', () => {
  for (const subdir of SUBDIRS) {
    const loaded = loadFixturesFromDir(join(fixtureDir, subdir));
    for (const { yamlPath, fixture } of loaded) {
      it(`${subdir}/${yamlPath.split('/').pop()} — ${fixture.description}`, () => {
        const { competitors, fleets, races, finishes, raceStarts, discardThresholds, dnfScoring } =
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

        for (const expected of fixture.expected.standings) {
          const standing = standingsBySail.get(expected.sailor);
          expect(standing, `No standing for sailor ${expected.sailor}`).toBeDefined();
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

          if (expected.fleet !== undefined) {
            expect(fleetNameBySail.get(expected.sailor), `${label}: fleet`).toBe(expected.fleet);
          }
        }
      });
    }
  }
});
