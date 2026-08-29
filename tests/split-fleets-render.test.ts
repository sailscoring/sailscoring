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
  renderSplitFleetRaceResultsPage,
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

  it('says so when the boats either side of the cut line are tied', () => {
    // Fixture 08's Yellow/Blue pairs share ranks, and the Gold/Silver cut
    // falls inside one of them: the line must not silently resolve the tie.
    const tied = renderSplitFleetStandingsPage(
      renderInputFor('08-d8-incomplete-qualifying-race.yaml'),
    );
    expect(tied).toContain(
      'provisional split if qualifying ended now — the boats either side are tied; the ranking does not decide this cut',
    );

    // Fixture 19's cut lines fall between settled ranks: no tie note.
    const settled = renderSplitFleetStandingsPage(
      renderInputFor('19-tie-a8-cannot-break.yaml'),
    );
    expect(settled).toContain('provisional split');
    expect(settled).not.toContain('either side are tied');
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

  it('tints the medal fleet and lists it in the legend', () => {
    // The medal fleet is named by the series' vocabulary, so it appears in
    // neither config fleet list: its colour has to reach the page from the
    // fleet itself, or from the medal stage's own palette.
    const html = renderSplitFleetStandingsPage(
      renderInputFor('03-f2-ilca-medal-race.yaml'),
    );
    const legend = html.match(/<p class="sfnote sflegend">[\s\S]*?<\/p>/)?.[0] ?? '';
    expect(legend).toContain('Medal');
    // Both the M1 cells and the legend entry carry the medal shade, not the
    // untinted white a fleet with no colour falls back to.
    expect(html).toMatch(/<td style="background:#f59e0b2e[^"]*" title="Medal fleet"/);
    expect(legend).toContain('<span class="sfdot" style="background:#f59e0b"></span>Medal');
  });

  it('draws a fleet in its own recorded colour, over the config\'s', () => {
    const input = renderInputFor('03-f2-ilca-medal-race.yaml');
    input.fleets = input.fleets.map((f) =>
      f.name === 'Gold' || f.name === 'Medal' ? { ...f, color: '#010203' } : f,
    );
    const html = renderSplitFleetStandingsPage(input);
    // Gold's colour is #ca8a04 in the config and the medal fleet's is in no
    // config list at all; the fleet's own colour answers for both.
    expect(html).toMatch(/<td style="background:#0102032e[^"]*" title="Gold fleet"/);
    expect(html).toMatch(/<td style="background:#0102032e[^"]*" title="Medal fleet"/);
    expect(html).not.toContain('#ca8a04');
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

describe('the championship links to the per-race results page', () => {
  const FIXTURE = '01-f1-ilca-continuous-carry.yaml';

  it('deep-links each race column header when the page location is known', () => {
    const html = renderSplitFleetStandingsPage(renderInputFor(FIXTURE), {
      raceResultsHref: 'race-results',
    });
    expect(html).toContain('<th><a href="race-results#q1">Q1</a></th>');
    expect(html).toContain('<th><a href="race-results#f2">F2</a></th>');
    // And says so in prose too, above the tables.
    expect(html).toMatch(/<a href="race-results">Race results<\/a>/);
  });

  it('leaves a carried-score column unlinked — it is a score, not a race', () => {
    // Rank-seed carry mints a stage-race-0 column; no race section exists
    // for it, so a link would 404 into the page.
    const html = renderSplitFleetStandingsPage(renderInputFor('14-f6-rank-seed-carry.yaml'), {
      raceResultsHref: 'race-results',
    });
    expect(html).not.toContain('#f0');
    expect(html).not.toContain('#m0');
    expect(html).toContain('<th><a href="race-results#q1">Q1</a></th>');
  });

  it('renders plain headers when the location is unknown (preview, download, FTP)', () => {
    const html = renderSplitFleetStandingsPage(renderInputFor(FIXTURE));
    expect(html).toContain('<th>Q1</th>');
    expect(html).not.toContain('Race results</a>');
  });
});

describe('renderSplitFleetRaceResultsPage', () => {
  const FIXTURE = '01-f1-ilca-continuous-carry.yaml';

  /** One stage race's slice of the page: its anchored heading up to the next. */
  function section(html: string, anchor: string): string {
    const start = html.indexOf(`<h2 id="${anchor}">`);
    expect(start).toBeGreaterThan(-1);
    const next = html.indexOf('<h2 id=', start + 1);
    return next === -1 ? html.slice(start) : html.slice(start, next);
  }

  /** The data rows of a slice, in order: rank, sail, code, points. */
  function tableRows(slice: string): { rank: string; sail: string; code: string; points: string }[] {
    return [
      ...slice.matchAll(
        /<tr class="(?:odd|even)">\s*<td style="text-align:center">([^<]*)<\/td>\s*<td style="font-family:monospace">([^<]+)<\/td>\s*<td>[\s\S]*?<\/td>\s*<td style="text-align:center">([^<]*)<\/td>\s*<td style="text-align:right">([^<]+)<\/td>/g,
      ),
    ].map((m) => ({ rank: m[1], sail: m[2], code: m[3], points: m[4] }));
  }

  it('renders one section per stage race with a table per fleet, ranked within it', () => {
    const html = renderSplitFleetRaceResultsPage(renderInputFor(FIXTURE))!;
    expect(html).toContain('<title>');
    for (const anchor of ['q1', 'q2', 'f1', 'f2']) {
      expect(html).toContain(`<h2 id="${anchor}">`);
    }
    // The heading is the notice-board label, from the vocabulary.
    expect(section(html, 'q1')).toContain('>Q1</h2>');

    // Q1: Yellow's table before Blue's (round fleet order), each fleet ranked
    // 1..n on its own — the start sequence's interleaving pulled apart.
    const q1 = section(html, 'q1');
    expect(q1.indexOf('Yellow fleet')).toBeGreaterThan(-1);
    expect(q1.indexOf('Yellow fleet')).toBeLessThan(q1.indexOf('Blue fleet'));
    const q1Rows = tableRows(q1);
    expect(q1Rows.map((r) => r.sail)).toEqual(['s1', 's4', 's5', 's2', 's3', 's6']);
    expect(q1Rows.map((r) => r.rank)).toEqual(['1', '2', '3', '1', '2', '3']);

    // Each race ranks its own sheet: Q2's Yellow order differs from Q1's.
    expect(tableRows(section(html, 'q2')).map((r) => r.sail).slice(0, 3)).toEqual([
      's4', 's1', 's5',
    ]);

    // After the split, the tables are the final fleets'.
    const f1 = section(html, 'f1');
    expect(f1.indexOf('Gold fleet')).toBeLessThan(f1.indexOf('Silver fleet'));
    expect(tableRows(f1).map((r) => r.sail)).toEqual(['s1', 's2', 's4', 's3', 's5', 's6']);
  });

  it('shows penalties, codes and the medal multiplier as scored', () => {
    const html = renderSplitFleetRaceResultsPage(
      renderInputFor('11-penalties-and-medal-codes.yaml'),
    )!;
    // Q1 Yellow: y2's SCP rides on her finish points; y3's is capped at the
    // race's DNF score. Both keep their crossing-order rank.
    const q1 = tableRows(section(html, 'q1'));
    expect(q1.find((r) => r.sail === 'y2')).toMatchObject({ rank: '2', code: 'SCP', points: '3.2' });
    expect(q1.find((r) => r.sail === 'y3')).toMatchObject({ rank: '3', code: 'SCP', points: '4' });
    // F2 is the one-more-race for the boats outside the medal fleet: first
    // place scores medal size + 1, and the medal boats are absent, not DNC.
    expect(tableRows(section(html, 'f2'))).toEqual([
      { rank: '1', sail: 'b2', code: '', points: '3' },
    ]);
    // M1: finish points doubled; the coded boat at the base, undoubled,
    // unranked, after the finishers.
    expect(tableRows(section(html, 'm1'))).toEqual([
      { rank: '1', sail: 'b1', code: '', points: '2' },
      { rank: '', sail: 'y1', code: 'BFD', points: '3' },
    ]);
  });

  it('leaves implicit DNCs off the race table', () => {
    const input = renderInputFor(FIXTURE);
    const q1RaceIds = new Set(
      input.raceStarts
        .filter((s) => s.stage === 'qualifying' && s.stageRaceNumber === 1)
        .map((s) => s.raceId),
    );
    // s5 has no row on Q1's sheet: she scores DNC in the standings, but the
    // race's own page lists only the boats on the sheet (a crossing or a code).
    const html = renderSplitFleetRaceResultsPage({
      ...input,
      finishes: input.finishes.filter(
        (f) => !(q1RaceIds.has(f.raceId) && f.competitorId === 's5'),
      ),
    })!;
    expect(tableRows(section(html, 'q1')).map((r) => r.sail)).not.toContain('s5');
    expect(tableRows(section(html, 'q2')).map((r) => r.sail)).toContain('s5');
  });

  it('treats a carried score as a score, not a race', () => {
    // Rank-seed carry mints stage race 0 cells; they are positions, not races,
    // and get no section — while the superseded qualifying races keep theirs.
    const html = renderSplitFleetRaceResultsPage(renderInputFor('14-f6-rank-seed-carry.yaml'))!;
    expect(html).not.toContain('id="f0"');
    expect(html).not.toContain('id="m0"');
    expect(html).toContain('id="q1"');
  });

  it('notes a race the championship score cannot yet use', () => {
    // Fixture 08's Q2 was sailed by Yellow alone: the results stand on the
    // page, flagged rather than hidden.
    const html = renderSplitFleetRaceResultsPage(
      renderInputFor('08-d8-incomplete-qualifying-race.yaml'),
    )!;
    expect(section(html, 'q2')).toContain('Does not yet count — race incomplete across fleets.');
    expect(section(html, 'q1')).not.toContain('Does not yet count');
    expect(tableRows(section(html, 'q2')).length).toBeGreaterThan(0);
  });

  it('returns null while no race has sheet rows', () => {
    const input = renderInputFor(FIXTURE);
    expect(renderSplitFleetRaceResultsPage({ ...input, finishes: [] })).toBeNull();
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
    ['race results', (i: SplitFleetRenderInput, c?: Parameters<typeof renderSplitFleetRaceResultsPage>[1]) => renderSplitFleetRaceResultsPage(i, c)!],
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

  it('lays a round out as one table per fleet, in country order', () => {
    // The shape the ILCA 7 Men's Worlds organising authority posts on the
    // official notice board: the fleets side by side, each block in its
    // fleet's colour with the fleet named in a header band, rows sorted by
    // country code then sail number.
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

    // One table per fleet under a tinted band naming the fleet and its size —
    // not one combined table with a Fleet column. The name is in text, so the
    // page survives mono printing and readers who cannot separate the tints.
    expect(html).not.toContain('<th>Fleet</th>');
    expect(html).toMatch(
      /<th colspan="3" class="sffleethead" style="background:#[0-9a-f]{8}">(Yellow|Blue) \(\d+\)<\/th>/,
    );

    // Country order within a fleet's block, not across the round.
    const from = html.indexOf('class="sffleets"');
    const firstBlock = html.slice(html.indexOf('<tbody>', from), html.indexOf('</tbody>', from));
    const order = [...firstBlock.matchAll(/<td class="nat"[^>]*>.*?>([A-Z]{3})</g)].map((m) => m[1]);
    expect(order.length).toBeGreaterThan(1);
    expect(order).toEqual([...order].sort());

    // Rows carry the fleet tint at low alpha; the header band sits stronger.
    const rowTints = new Set(
      [...html.matchAll(/<tr style="background:(#[0-9a-f]{8})"/g)].map((m) => m[1]),
    );
    expect(rowTints.size).toBeGreaterThan(1);
    for (const t of rowTints) expect(t.endsWith('1f')).toBe(true);
    expect(html).toContain('background:#eab30855');
  });

  it('widens a short fleet colour before adding the tint alpha', () => {
    // `#abc` + alpha is seven characters, which a browser discards — the row
    // would silently lose its colour.
    const base = renderInputFor(FIXTURE);
    const html = renderSplitFleetAssignmentsPage(base, chrome);
    expect(html).not.toMatch(/background:#[0-9a-f]{5}"/);
    expect(html).toContain('background:#0000001f');
  });

  it('marks hand-placed boats with a footnoted asterisk, only when there are any', () => {
    // The narrow side-by-side blocks have no room for a provenance column: a
    // moved boat carries a marker on her row, explained once per round.
    const input = renderInputFor(FIXTURE);
    const plain = renderSplitFleetAssignmentsPage(input, chrome);
    expect(plain).not.toContain('placed by the committee');
    expect(plain).not.toContain('title="Placed by the committee"');

    // With one boat moved by hand, the marker and the footnote appear.
    const moved = input.rounds[0];
    const member = input.competitors.find((c) =>
      c.fleetIds.some((fid) => moved.fleetIds.includes(fid)),
    )!;
    const fid = member.fleetIds.find((f) => moved.fleetIds.includes(f))!;
    const html = renderSplitFleetAssignmentsPage(
      { ...input, rounds: [{ ...moved, overrides: { [member.id]: fid } }] },
      chrome,
    );
    expect(html).toContain('<span class="override-marker" title="Placed by the committee">*</span>');
    expect(html).toContain('<p class="sfnote">* placed by the committee</p>');
  });

  it('says so when no fleets have been assigned yet', () => {
    const html = renderSplitFleetAssignmentsPage({ ...renderInputFor(FIXTURE), rounds: [] }, chrome);
    expect(html).toContain('No fleets have been assigned yet.');
  });
});

describe('track data columns on the per-race page', () => {
  const FIXTURE = '01-f1-ilca-continuous-carry.yaml';

  /** Every finisher gets the same plausible capture; coded rows get none.
   *  Elapsed rides on the finish row, the rest in `trackData`. */
  function withTrack(
    input: SplitFleetRenderInput,
    data: { elapsedSecs?: number } & NonNullable<SplitFleetRenderInput['finishes'][number]['trackData']> = {
      distanceKm: 2.73, elapsedSecs: 3600, maxSpeedKts: 14.6, dtlAtStartM: 8.45,
    },
  ): SplitFleetRenderInput {
    const { elapsedSecs, ...trackData } = data;
    return {
      ...input,
      showTrackData: true,
      finishes: input.finishes.map((f) =>
        f.sortOrder !== null
          ? {
              ...f,
              finishTime: '11:45:20',
              ...(elapsedSecs != null ? { elapsedSecs } : {}),
              trackData,
            }
          : f,
      ),
    };
  }

  const TRACK_HEADERS = [
    'Finish time', 'Elapsed', 'Distance (km)', 'Avg speed (kn)', 'Max speed (kn)', 'DTL (m)',
  ];

  it('appends the columns when the opt-in is resolved and the data exists', () => {
    const html = renderSplitFleetRaceResultsPage(withTrack(renderInputFor(FIXTURE)))!;
    for (const header of TRACK_HEADERS) {
      expect(html).toContain(`>${header}</th>`);
    }
    // Values as stored; the average is the one derived figure —
    // 2.73 km in an hour is 1.47 kn — and elapsed reads as a duration.
    expect(html).toContain('>2.73</td>');
    expect(html).toContain('>1.47</td>');
    expect(html).toContain('>1:00:00</td>');
    expect(html).toContain('>11:45:20</td>');
  });

  it('renders no columns without the resolved opt-in, data or not', () => {
    const html = renderSplitFleetRaceResultsPage(
      { ...withTrack(renderInputFor(FIXTURE)), showTrackData: false },
    )!;
    for (const header of TRACK_HEADERS) {
      expect(html).not.toContain(`>${header}</th>`);
    }
  });

  it('renders no columns when no boat carries the data', () => {
    const html = renderSplitFleetRaceResultsPage(
      { ...renderInputFor(FIXTURE), showTrackData: true },
    )!;
    for (const header of TRACK_HEADERS) {
      expect(html).not.toContain(`>${header}</th>`);
    }
  });

  it('drops a column no boat has a value for', () => {
    const html = renderSplitFleetRaceResultsPage(
      withTrack(renderInputFor(FIXTURE), { distanceKm: 2.73, elapsedSecs: 3600 }),
    )!;
    expect(html).toContain('>Distance (km)</th>');
    expect(html).toContain('>Avg speed (kn)</th>');
    expect(html).not.toContain('>Max speed (kn)</th>');
    expect(html).not.toContain('>DTL (m)</th>');
  });
});
