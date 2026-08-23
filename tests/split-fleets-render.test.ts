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
  return {
    seriesName: fx.fixture.description,
    config: data.config,
    rounds: data.rounds,
    fleets: data.fleets,
    competitors: data.competitors,
    races: data.races,
    raceStarts: data.raceStarts,
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
      input.raceStarts.filter((s) => s.stage === 'qualifying').map((s) => s.raceId),
    );
    const mid: SplitFleetRenderInput = {
      ...input,
      rounds: input.rounds.filter((r) => r.stage === 'qualifying'),
      races: input.races.filter((r) => qualRaceIds.has(r.id)),
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

  it('renders the Nat column with inline flags when nationality is enabled', () => {
    const input = renderInputFor('01-f1-ilca-continuous-carry.yaml');
    input.competitors.forEach((c, i) => {
      c.nationality = i % 2 === 0 ? 'IRL' : 'GBR';
    });
    input.enabledCompetitorFields = ['nationality'];
    input.flagSvgByCode = {
      IRL: { viewBox: '0 0 3 2', inner: '<rect width="3" height="2" fill="#169b62"/>' },
      GBR: { viewBox: '0 0 3 2', inner: '<rect width="3" height="2" fill="#012169"/>' },
    };
    const html = renderSplitFleetStandingsPage(input);
    expect(html).toContain('<th>Nat</th>');
    expect(html).toContain('id="flag-IRL"');
    expect(html).toContain('href="#flag-GBR"');

    const assignments = renderSplitFleetAssignmentsPage(input);
    expect(assignments).toContain('<th>Nat</th>');
    expect(assignments).toContain('id="flag-IRL"');

    // Without the field enabled, no Nat column and no flag defs.
    const off = renderSplitFleetStandingsPage({ ...input, enabledCompetitorFields: [] });
    expect(off).not.toContain('<th>Nat</th>');
    expect(off).not.toContain('id="flag-IRL"');
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

  it('says where a round assigned from the entry list got its fleets', () => {
    const input = renderInputFor('01-f1-ilca-continuous-carry.yaml');
    // The committee's own assignment, committed as `manual` — it must not
    // publish a blank provenance line where a seeded round explains itself.
    const rounds = input.rounds.map((r) =>
      r.method === 'seeded' ? { ...r, method: 'manual' } : r,
    );
    const html = renderSplitFleetAssignmentsPage({ ...input, rounds });
    expect(html).toContain('as supplied by the organising authority');
    expect(html).not.toContain('Initial seeding');
  });
});

// ---- The shared published-page shell (#428) ----

describe('split-fleet pages use the standard published-page look', () => {
  const FIXTURE = '01-f1-ilca-continuous-carry.yaml';
  const chrome = {
    venue: 'Dun Laoghaire',
    leftLogoUrl: 'https://example.test/venue.png',
    rightLogoUrl: 'https://example.test/event.png',
    seriesIndexUrl: '/p/ws/2026/worlds',
    generatedAt: new Date('2026-08-23T10:00:00Z'),
  };

  for (const [label, render] of [
    ['championship', renderSplitFleetStandingsPage],
    ['fleet assignments', renderSplitFleetAssignmentsPage],
  ] as const) {
    it(`gives the ${label} page the house chrome`, () => {
      const html = render(renderInputFor(FIXTURE), chrome);
      // The shell, not a hand-rolled document: house font, the logos, the
      // breadcrumb up to the event, and the credit line.
      expect(html).toContain('Poppins');
      expect(html).toContain('https://example.test/venue.png');
      expect(html).toContain('https://example.test/event.png');
      expect(html).toContain('/p/ws/2026/worlds');
      expect(html).toContain('sailscoring.ie');
      // And not the shell-less body rule these pages used to carry.
      expect(html).not.toContain('font: 100% arial');
    });

    it(`renders the ${label} page without chrome too`, () => {
      // Preview and download pass no `/p/` parent.
      expect(render(renderInputFor(FIXTURE), {})).toContain('<!doctype html>');
    });
  }

  it('stripes its rows like every other published table', () => {
    // The shell paints `.odd`/`.even`; without those classes the tables came
    // out flat white beside the competitor list and the standings.
    for (const render of [renderSplitFleetStandingsPage, renderSplitFleetAssignmentsPage]) {
      const html = render(renderInputFor(FIXTURE), chrome);
      expect(html).toContain('<tr class="odd summaryrow"');
      expect(html).toContain('<tr class="even summaryrow"');
    }
  });

  it('leaves out the provenance column when nobody was hand-placed', () => {
    // It was rendered unconditionally, so an ordinary assignment carried a
    // few pixels of empty cells after Helm.
    const input = renderInputFor(FIXTURE);
    const plain = renderSplitFleetAssignmentsPage(input, chrome);
    expect(plain).not.toContain('placed by the committee');
    expect(plain).not.toContain('<th>Helm</th><th></th>');

    // With one boat moved by hand, the column is back and says so.
    const moved = input.rounds[0];
    const member = input.competitors.find((c) =>
      c.fleetIds.some((fid) => moved.fleetIds.includes(fid)),
    )!;
    const fid = member.fleetIds.find((f) => moved.fleetIds.includes(f))!;
    const html = renderSplitFleetAssignmentsPage(
      { ...input, rounds: [{ ...moved, overrides: { [member.id]: fid } }] },
      chrome,
    );
    expect(html).toContain('placed by the committee');
    expect(html).toContain('<th>Helm</th><th></th>');
  });

  it('says so when no fleets have been assigned yet', () => {
    const html = renderSplitFleetAssignmentsPage({ ...renderInputFor(FIXTURE), rounds: [] }, chrome);
    expect(html).toContain('No fleets have been assigned yet.');
  });
});
