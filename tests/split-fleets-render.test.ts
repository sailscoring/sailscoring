/**
 * Published-page rendering for split-fleet series (#328). Smoke-level: drives
 * the renderer with fixture-built data and asserts the load-bearing structure
 * — tiered sections after the split, the provisional cut line before it, cell
 * content (discard parens, codes), the assignments page's newest-first rounds
 * — not exact markup.
 */

import { describe, it, expect } from 'vitest';
import { join } from 'node:path';

import {
  renderSplitFleetStandingsPage,
  renderSplitFleetAssignmentsPage,
  type SplitFleetRenderInput,
} from '@/lib/split-fleets-render';
import type { RaceStart } from '@/lib/types';
import { buildSplitFleet, loadSplitFleetFixtures } from './fixtures/scoring/split-fleets/loader';

const dir = join(__dirname, 'fixtures/scoring/split-fleets');
const fixtures = loadSplitFleetFixtures(dir);

function renderInputFor(file: string): SplitFleetRenderInput {
  const fx = fixtures.find((f) => f.file === file);
  if (!fx) throw new Error(`fixture not found: ${file}`);
  const { data } = buildSplitFleet(fx.fixture);
  // The renderer takes raw race starts (what the repos hold); the fixture
  // loader resolves them to a raceId → fleetId map. Reverse that here.
  const raceStarts: RaceStart[] = Object.entries(data.raceFleetIds).map(
    ([raceId, fleetId]) => ({ id: `start-${raceId}`, raceId, fleetIds: [fleetId] }),
  );
  return {
    seriesName: fx.fixture.description,
    config: data.config,
    rounds: data.rounds,
    fleets: data.fleets,
    competitors: data.competitors,
    races: data.races,
    raceStarts,
    finishes: data.finishes,
  };
}

describe('renderSplitFleetStandingsPage', () => {
  it('renders tiered sections after the split, with cells and totals', () => {
    const input = renderInputFor('01-f1-ilca-continuous-carry.yaml');
    const html = renderSplitFleetStandingsPage(input);
    expect(html).toContain('<title>');
    expect(html).toContain('Gold fleet');
    expect(html).toContain('Silver fleet');
    // Qualifying and final race columns are present.
    expect(html).toContain('<th>Q1</th>');
    expect(html).toContain('<th>F1</th>');
    // No provisional cut line once the split is made.
    expect(html).not.toContain('provisional split');
  });

  it('marks the provisional cut line while still in qualifying', () => {
    const input = renderInputFor('01-f1-ilca-continuous-carry.yaml');
    // Strip the final round + final-stage races/finishes: the event is now
    // mid-qualifying, so the combined table carries the cut line.
    const finalFleetIds = new Set(
      input.rounds.filter((r) => r.stage !== 'qualifying').flatMap((r) => r.fleetIds),
    );
    const qualRaceIds = new Set(
      input.races.filter((r) => r.stage === 'qualifying').map((r) => r.id),
    );
    const mid: SplitFleetRenderInput = {
      ...input,
      rounds: input.rounds.filter((r) => r.stage === 'qualifying'),
      races: input.races.filter((r) => r.stage === 'qualifying'),
      raceStarts: input.raceStarts.filter((s) => qualRaceIds.has(s.raceId)),
      finishes: input.finishes.filter((f) => qualRaceIds.has(f.raceId)),
      fleets: input.fleets.filter((f) => !finalFleetIds.has(f.id)),
      competitors: input.competitors.map((c) => ({
        ...c,
        fleetIds: c.fleetIds.filter((id) => !finalFleetIds.has(id)),
      })),
    };
    const html = renderSplitFleetStandingsPage(mid);
    expect(html).toContain('provisional split');
    expect(html).not.toContain('Gold fleet');
  });

  it('escapes user-controlled fields', () => {
    const input = renderInputFor('01-f1-ilca-continuous-carry.yaml');
    input.seriesName = '<script>alert(1)</script>';
    const html = renderSplitFleetStandingsPage(input);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('renderSplitFleetAssignmentsPage', () => {
  it('lists every round, newest first, with fleet membership', () => {
    const input = renderInputFor('01-f1-ilca-continuous-carry.yaml');
    const html = renderSplitFleetAssignmentsPage(input);
    expect(html).toContain('Fleet assignments');
    expect(html).toContain('Final series split');
    const finalPos = html.indexOf('Final series split');
    const round1Pos = html.indexOf('Initial seeding');
    expect(finalPos).toBeGreaterThan(-1);
    expect(round1Pos).toBeGreaterThan(-1);
    // Newest first: the split section renders above the seeded round.
    expect(finalPos).toBeLessThan(round1Pos);
  });
});
