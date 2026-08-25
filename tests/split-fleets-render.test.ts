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

/** Strip the final round + final-stage races/finishes so the event is
 *  mid-qualifying: the combined table, cut line, and Fleet column render. */
function midQualifying(input: SplitFleetRenderInput): SplitFleetRenderInput {
  const finalFleetIds = new Set(
    input.rounds.filter((r) => r.stage !== 'qualifying').flatMap((r) => r.fleetIds),
  );
  const qualRaceIds = new Set(
    input.raceStarts.filter((s) => s.stage === 'qualifying').map((s) => s.raceId),
  );
  return {
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
    const mid = midQualifying(renderInputFor('01-f1-ilca-continuous-carry.yaml'));
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

  it('links the helm name to the World Sailing bio only while the WS ID column is off', () => {
    const input = renderInputFor('01-f1-ilca-continuous-carry.yaml');
    input.competitors[0].worldSailingId = 'IRLMM1';

    // Column off → the name carries the bio link instead.
    const noCol = renderSplitFleetStandingsPage(input);
    expect(noCol).not.toContain('<th>WS ID</th>');
    expect(noCol).toMatch(/<td><a href="[^"]*ref=IRLMM1"[^>]*>[^<]+<\/a><\/td>/);

    // Column on → the ID cell links and the name stays plain; one link per row.
    const withCol = renderSplitFleetStandingsPage({
      ...input,
      enabledCompetitorFields: ['worldSailingId'],
    });
    expect(withCol).toContain('<th>WS ID</th>');
    expect(withCol).toMatch(/<td class="wsid"[^>]*><a href="[^"]*ref=IRLMM1"/);
    expect((withCol.match(/<a href="[^"]*ref=IRLMM1"/g) ?? []).length).toBe(1);
  });
});

describe('fleet markers on the championship standings', () => {
  const FIXTURE = '01-f1-ilca-continuous-carry.yaml';

  it('marks each race cell with a fleet dot and names the fleet in the tooltip', () => {
    const html = renderSplitFleetStandingsPage(renderInputFor(FIXTURE));
    // The dot rides inside the score cell, per cell — after a reassignment a
    // row's qualifying cells can carry different fleets race by race.
    expect(html).toMatch(/<td[^>]*title="Yellow fleet"[^>]*>|title="Yellow fleet"/);
    expect(html).toContain('class="sfdot"');
    // The tooltip keeps the scoring note when the cell has one — rank-seed
    // carry supersedes the qualifying scores, so those cells carry both.
    const rankSeed = renderSplitFleetStandingsPage(
      renderInputFor('14-f6-rank-seed-carry.yaml'),
    );
    expect(rankSeed).toMatch(/title="[^"]+ fleet — replaced by the carried score"/);
  });

  it('keys the dots with a legend naming every fleet that appears', () => {
    const html = renderSplitFleetStandingsPage(renderInputFor(FIXTURE));
    const legend = html.match(/<p class="sfnote sflegend">[\s\S]*?<\/p>/)?.[0] ?? '';
    expect(legend).toContain('Race cells are marked with the fleet the race was sailed in');
    for (const label of ['Yellow', 'Blue', 'Gold', 'Silver']) {
      expect(legend).toContain(label);
    }
  });

  it('carries a Fleet column while combined, and drops it once split', () => {
    const mid = midQualifying(renderInputFor(FIXTURE));
    const combined = renderSplitFleetStandingsPage(mid);
    expect(combined).toContain('<th>Fleet</th>');
    // The column names the current round's assignment, dot first.
    expect(combined).toMatch(
      /<td style="white-space:nowrap"><span class="sfdot"[^>]*><\/span>(Yellow|Blue)<\/td>/,
    );

    // After the split the per-fleet section headings say it instead.
    const post = renderSplitFleetStandingsPage(renderInputFor(FIXTURE));
    expect(post).not.toContain('<th>Fleet</th>');
    expect(post).toContain('Gold fleet');
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

  it('stripes the championship rows like every other published table', () => {
    // The shell paints `.odd`/`.even`; without those classes the table came
    // out flat white beside the competitor list and the standings. The
    // assignments page is the exception: its rows carry the fleet tint, which
    // is its banding.
    const html = renderSplitFleetStandingsPage(renderInputFor(FIXTURE), chrome);
    expect(html).toContain('<tr class="odd summaryrow"');
    expect(html).toContain('<tr class="even summaryrow"');
  });

  it('lists a round as one nationality-ordered table, fleet first', () => {
    // The shape the ILCA 7 Men's Worlds organising authority publishes: not a
    // table per fleet, but one list a competitor can scan for their own
    // country, with the fleet named and coloured on each row.
    const base = renderInputFor(FIXTURE);
    const nats = ['NZL', 'IRL', 'AUS', 'IRL', 'AUS', 'FRA'];
    const input: SplitFleetRenderInput = {
      ...base,
      enabledCompetitorFields: ['nationality'],
      competitors: base.competitors.map((c, i) => ({ ...c, nationality: nats[i] })),
      config: {
        ...base.config,
        qualifyingFleets: [
          { label: 'Yellow', color: '#eab308' },
          { label: 'Blue', color: '#3b82f6' },
        ],
      },
    };
    const html = renderSplitFleetAssignmentsPage(input, chrome);

    // One table per round, not one per fleet: no per-fleet headings.
    expect(html).toContain('<th>Fleet</th>');
    expect(html).not.toContain('<h3>');

    // Fleet leads each row, and is named as well as coloured — the page has to
    // survive mono printing and readers who cannot separate the tints.
    expect(html).toMatch(/<tr style="background:#[0-9a-f]{8}"><td>(Yellow|Blue)<\/td>/);

    // Nationality order — within a round's table. The page carries one table
    // per round, so the concatenation of them all is not sorted.
    // Anchored on the first data table: the shell's own header is a table too,
    // and its <tbody> comes first in the document.
    const from = html.indexOf('<table class="summarytable"');
    const firstTable = html.slice(from, html.indexOf('</tbody>', from));
    const order = [...firstTable.matchAll(/<td class="nat"[^>]*>.*?>([A-Z]{3})</g)].map((m) => m[1]);
    expect(order.length).toBeGreaterThan(1);
    expect(order).toEqual([...order].sort());
    const tints = new Set([...html.matchAll(/background:(#[0-9a-f]{8})/g)].map((m) => m[1]));
    expect(tints.size).toBeGreaterThan(1);
    for (const t of tints) expect(t.endsWith('1f')).toBe(true);
  });

  it('widens a short fleet colour before adding the tint alpha', () => {
    // `#abc` + alpha is seven characters, which a browser discards — the row
    // would silently lose its colour.
    const base = renderInputFor(FIXTURE);
    const html = renderSplitFleetAssignmentsPage(base, chrome);
    expect(html).not.toMatch(/background:#[0-9a-f]{5}"/);
    expect(html).toContain('background:#0000001f');
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
