/**
 * Declarative split-fleet (qualifying/final series) fixture tests.
 *
 * Each YAML under tests/fixtures/split-fleets/ captures a real championship
 * scoring case (see that dir's codes.md / README.md). Runnable fixtures are
 * driven through the prototype engine `splitFleetStandings` and their expected
 * standings asserted; spec-only fixtures (constructs the prototype does not yet
 * implement — redress, most-recent-exclusion equalisation) are marked pending
 * with their reason, but still validated structurally so the specification
 * stays loadable.
 *
 * Adding a .yaml file here is enough to add a test.
 */

import { describe, it, expect } from 'vitest';
import { join } from 'node:path';

import { splitFleetStandings } from '@/lib/split-fleets';
import {
  buildSplitFleetData,
  loadSplitFleetFixtures,
  type SplitFleetFixture,
} from './fixtures/scoring/split-fleets/loader';

const dir = join(__dirname, 'fixtures/scoring/split-fleets');
const fixtures = loadSplitFleetFixtures(dir);

function assertStandings(fx: SplitFleetFixture, file: string) {
  const data = buildSplitFleetData(fx);
  const rows = splitFleetStandings(data);
  const fleetName = new Map(data.fleets.map((f) => [f.id, f.name]));
  const bySail = new Map(rows.map((r) => [r.competitor.sailNumber, r]));

  // Every expected row is present and correct.
  for (const exp of fx.expected.standings) {
    const row = bySail.get(exp.sail);
    expect(row, `${file}: expected sailor ${exp.sail} missing from standings`).toBeDefined();
    if (!row) continue;
    expect(row.rank, `${file}: ${exp.sail} rank`).toBe(exp.rank);
    expect(row.total, `${file}: ${exp.sail} total`).toBe(exp.total);
    expect(row.net, `${file}: ${exp.sail} net`).toBe(exp.net);
    if (exp.fleet !== undefined) {
      expect(
        row.finalFleetId ? fleetName.get(row.finalFleetId) : undefined,
        `${file}: ${exp.sail} final fleet`,
      ).toBe(exp.fleet);
    }
    if (exp.medal !== undefined) {
      expect(row.medal, `${file}: ${exp.sail} medal flag`).toBe(exp.medal);
    }
  }

  // Expected order is the actual order (over the covered sailors).
  const expectedOrder = [...fx.expected.standings].sort((a, b) => a.rank - b.rank).map((e) => e.sail);
  const actualOrder = rows.map((r) => r.competitor.sailNumber).filter((s) => expectedOrder.includes(s));
  expect(actualOrder, `${file}: standings order`).toEqual(expectedOrder);
}

describe('split-fleet fixtures', () => {
  it('every fixture file loads and declares its provenance', () => {
    expect(fixtures.length).toBeGreaterThan(0);
    for (const { file, fixture } of fixtures) {
      expect(fixture.description, `${file}: description`).toBeTruthy();
      expect(fixture.provenance?.code, `${file}: provenance.code`).toBeTruthy();
      expect(fixture.expected?.standings?.length, `${file}: expected.standings`).toBeGreaterThan(0);
      if (!fixture.runnable) {
        expect(fixture.reason, `${file}: spec-only fixtures must give a reason`).toBeTruthy();
      }
    }
  });

  for (const { file, fixture } of fixtures) {
    const scenarios = fixture.provenance.scenarios?.length
      ? ` [${fixture.provenance.scenarios.join(',')}]`
      : '';
    const name = `${file} — ${fixture.provenance.code}${scenarios}: ${fixture.description}`;
    if (fixture.runnable) {
      it(name, () => assertStandings(fixture, file));
    } else {
      it.skip(`${name} (spec-only: ${fixture.reason})`, () => {});
    }
  }
});
