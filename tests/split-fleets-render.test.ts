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
  stageRaceAnchor,
  type SplitFleetRenderInput,
} from '@/lib/split-fleets-render';
import { describeSplitFleetConfig } from '@/lib/split-fleets-si';
import type { RaceConditions, RaceOfficial, RaceStart } from '@/lib/types';
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

/** The column headings of one fleet's table on the standings page, in order.
 *  `fleet` names the section heading; omit it for a page rendered as one
 *  combined table. */
function headerRow(html: string, fleet?: string): string[] {
  const from = fleet ? html.indexOf(`<h2>${fleet} fleet</h2>`) : 0;
  expect(from).toBeGreaterThanOrEqual(0);
  const head = html.slice(from).match(/<thead>([\s\S]*?)<\/thead>/)?.[1] ?? '';
  return [...head.matchAll(/<th[^>]*>(.*?)<\/th>/g)].map((m) =>
    m[1].replace(/<[^>]*>/g, ''),
  );
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

  it('gives each fleet table only the columns its boats sail', () => {
    // The medal race is the medal fleet's alone: its table is the only one
    // carrying M1, and with the medal boats in their own section Gold's
    // table never shows a column no boat left in it can hold a cell in.
    const html = renderSplitFleetStandingsPage(renderInputFor('03-f2-ilca-medal-race.yaml'));
    // No F2 either: the medal boats were selected before it and are absent
    // from it, not DNC in it.
    expect(headerRow(html, 'Medal')).toEqual(
      ['Rank', 'Sail', 'Helm', 'Q1', 'Q2', 'F1', 'M1', 'Total', 'Nett'],
    );
    expect(headerRow(html, 'Gold')).toEqual(
      ['Rank', 'Sail', 'Helm', 'Q1', 'Q2', 'F1', 'F2', 'Total', 'Nett'],
    );
    expect(headerRow(html, 'Silver')).toEqual(
      ['Rank', 'Sail', 'Helm', 'Q1', 'Q2', 'F1', 'F2', 'Total', 'Nett'],
    );
  });

  it('shows a held carried score from fleet selection, marked as not yet counting', () => {
    // `appliesFrom: first-medal-race` with no medal race sailed: the Carried
    // column is on the page — the qualified boats can see the scores the
    // medal races will add to — but its cells say they count nothing yet,
    // and the race scores stay undimmed.
    const html = renderSplitFleetStandingsPage(
      renderInputFor('21-abandoned-finale-undivided.yaml'),
    );
    expect(headerRow(html, 'Medal')).toContain('Carried');
    expect(html).toContain('counts once a medal race is completed');
    expect(html).not.toContain('replaced by the carried score');
  });

  it('gives the medal fleet its own section, headed in the series\' own words', () => {
    const input = renderInputFor('03-f2-ilca-medal-race.yaml');
    const html = renderSplitFleetStandingsPage(input);
    // A section of its own, first on the page — and with it the per-row
    // badge goes: a heading and a badge saying the same thing twice.
    expect(html.indexOf('<h2>Medal fleet</h2>')).toBeGreaterThanOrEqual(0);
    expect(html.indexOf('<h2>Medal fleet</h2>')).toBeLessThan(html.indexOf('<h2>Gold fleet</h2>'));
    expect(html).not.toMatch(/<span style="font-size:0\.8em/);
    // The rule under it, stated as a rule; and the fleet the boats came from
    // says they are still assigned to it.
    expect(html).toContain('ranked ahead of every other boat in the event');
    expect(html).toContain('remain assigned to this fleet');

    // The heading follows the vocabulary, not the fleet's name: the medal
    // fleet is named "Final series" under the ILCA vocabulary, and
    // "Final series fleet" is the fleetNoun — "{name} fleet" would only be
    // right by luck.
    const ilca: SplitFleetRenderInput = {
      ...input,
      config: { ...input.config, vocabulary: 'qualification-final' },
      fleets: input.fleets.map((f) =>
        f.name === 'Medal' ? { ...f, name: 'Final series' } : f,
      ),
    };
    expect(renderSplitFleetStandingsPage(ilca)).toContain('<h2>Final series fleet</h2>');
  });

  it('marks the provisional cut line while still in qualifying', () => {
    const mid = midQualifying(renderInputFor('01-f1-ilca-continuous-carry.yaml'));
    const html = renderSplitFleetStandingsPage(mid);
    expect(html).toContain('provisional split');
    expect(html).not.toMatch(/<h[23][^>]*>Gold fleet</);
    // The line spans the table, so its colspan has to follow the table's own
    // column set rather than the page's.
    expect(Number(html.match(/<td colspan="(\d+)"/)?.[1])).toBe(headerRow(html).length);
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

  it('carries crew under the helm name, plus Class and Club columns, when those fields are on', () => {
    const input = renderInputFor('01-f1-ilca-continuous-carry.yaml');
    input.competitors[0].crewNames = ['Jo Crew'];
    input.competitors[0].clubs = ['Howth Yacht Club'];
    input.competitors[0].boatClass = 'ILCA 7';
    input.enabledCompetitorFields = ['crewName', 'club', 'boatClass'];

    const html = renderSplitFleetStandingsPage(input);
    expect(html).toContain('<th>Helm / Crew</th>');
    expect(html).toContain('<th>Club</th>');
    expect(html).toContain('<th>Class</th>');
    expect(html).toContain('Jo Crew');
    expect(html).toContain('Howth Yacht Club');
    expect(html).toContain('ILCA 7');

    // Off: no column, and the values are nowhere on the page.
    const off = renderSplitFleetStandingsPage({ ...input, enabledCompetitorFields: [] });
    expect(off).toContain('<th>Helm</th>');
    expect(off).not.toContain('<th>Club</th>');
    expect(off).not.toContain('<th>Class</th>');
    expect(off).not.toContain('Jo Crew');
    expect(off).not.toContain('ILCA 7');
  });

  it('suppresses the Crew, Club and Class columns when no boat has a value', () => {
    const input = renderInputFor('01-f1-ilca-continuous-carry.yaml');
    input.enabledCompetitorFields = ['crewName', 'club', 'boatClass'];
    const html = renderSplitFleetStandingsPage(input);
    expect(html).toContain('<th>Helm</th>');
    expect(html).not.toContain('<th>Club</th>');
    expect(html).not.toContain('<th>Class</th>');
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
    // The tooltip keeps the scoring note when the cell has one — a halved
    // carry supersedes the opening scores, so those cells carry both.
    const carried = renderSplitFleetStandingsPage(
      renderInputFor('15-f3-compressed-carry.yaml'),
    );
    expect(carried).toMatch(/title="[^"]+ fleet — replaced by the carried score"/);
  });

  it('keys the dots with a legend naming every fleet that appears', () => {
    const html = renderSplitFleetStandingsPage(renderInputFor(FIXTURE));
    const legend = html.match(/<p class="sfnote sflegend">[\s\S]*?<\/p>/)?.[0] ?? '';
    expect(legend).toContain('Race cells are marked with the fleet the race was sailed in');
    for (const label of ['Yellow', 'Blue', 'Gold', 'Silver']) {
      expect(legend).toContain(label);
    }
  });

  it('marks the medal fleet in its own shade and lists it in the legend', () => {
    // The medal fleet is named by the series' vocabulary, so it appears in
    // neither config fleet list: its colour has to reach the page from the
    // fleet itself, or from the medal stage's own palette.
    const html = renderSplitFleetStandingsPage(
      renderInputFor('03-f2-ilca-medal-race.yaml'),
    );
    const legend = html.match(/<p class="sfnote sflegend">[\s\S]*?<\/p>/)?.[0] ?? '';
    expect(legend).toContain('Medal');
    // Both the M1 cells and the legend entry carry the medal shade, not the
    // untinted white a fleet with no colour falls back to. The dot is what
    // is asserted on: the fleets here are three boats deep, so every cell is
    // a podium place and the tint has given the background over to it.
    expect(html).toMatch(
      /<td[^>]*title="Medal fleet"[^>]*><span class="sfdot" style="background:#f59e0b">/,
    );
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
    expect(html).toMatch(
      /<td[^>]*title="Gold fleet"[^>]*><span class="sfdot" style="background:#010203">/,
    );
    expect(html).toMatch(
      /<td[^>]*title="Medal fleet"[^>]*><span class="sfdot" style="background:#010203">/,
    );
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

describe('race podiums on the championship standings', () => {
  const FIXTURE = '01-f1-ilca-continuous-carry.yaml';

  it("marks the first three in each fleet's race, over the fleet tint", () => {
    const html = renderSplitFleetStandingsPage(renderInputFor(FIXTURE));
    // Gold and Silver sailing the same stage race are two races, each with
    // its own first three \u2014 the same unit the per-race page ranks within.
    expect(html).toMatch(/<td class="rank1" [^>]*title="Gold fleet"/);
    expect(html).toMatch(/<td class="rank1" [^>]*title="Silver fleet"/);
    expect(html).toMatch(/<td class="rank3" [^>]*title="Yellow fleet"/);
    // The medal colour takes the background outright, so a marked cell
    // carries no fleet tint \u2014 the dot inside it still names the fleet.
    const marked = [...html.matchAll(/<td class="rank[123]"[^>]*>/g)].map((m) => m[0]);
    expect(marked.length).toBeGreaterThan(0);
    for (const cell of marked) expect(cell).not.toContain('background:');
    expect(html).toMatch(/<td class="rank[123]"[^>]*><span class="sfdot"/);
  });

  it('leaves a discarded place on its fleet tint \u2014 a discard loses the medal', () => {
    const html = renderSplitFleetStandingsPage(renderInputFor(FIXTURE));
    const discarded = [...html.matchAll(/<td([^>]*)>(?:<span[^>]*><\/span>)?\([^)]*\)<\/td>/g)];
    expect(discarded.length).toBeGreaterThan(0);
    for (const [, attrs] of discarded) {
      expect(attrs).not.toContain('rank');
      expect(attrs).toContain('background:');
    }
  });

  it('keys the medal colours in the legend', () => {
    const html = renderSplitFleetStandingsPage(renderInputFor(FIXTURE));
    const legend = html.match(/<p class="sfnote sflegend">[\s\S]*?<\/p>/)?.[0] ?? '';
    expect(legend).toContain("The first three places in each fleet's race");
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
    // A halved carry mints a stage-race-0 column; no race section exists for
    // it, so a link would 404 into the page.
    const html = renderSplitFleetStandingsPage(renderInputFor('15-f3-compressed-carry.yaml'), {
      raceResultsHref: 'race-results',
    });
    // Matched against the href rather than the bare fragment: a stylesheet
    // colour is free to be #f0something, and one now is.
    expect(html).not.toContain('race-results#f0');
    expect(html).not.toContain('race-results#m0');
    expect(html).toContain('<th><a href="race-results#q1">Q1</a></th>');
  });

  it('renders plain headers when the location is unknown (preview, download, FTP)', () => {
    const html = renderSplitFleetStandingsPage(renderInputFor(FIXTURE));
    expect(html).toContain('<th>Q1</th>');
    expect(html).not.toContain('Race results</a>');
  });
});

/**
 * A reader who has read the table has one obvious next question — how is this
 * event scored? — and the app can already write the answer, in the language a
 * sailing instruction's scoring section uses (#498).
 */
describe('the championship states the format it was scored under', () => {
  const FIXTURE = '01-f1-ilca-continuous-carry.yaml';

  it('folds the sailing-instruction prose away under the standings', () => {
    const input = renderInputFor(FIXTURE);
    const html = renderSplitFleetStandingsPage(input);
    expect(html).toContain('<summary>How this championship is scored</summary>');

    // Every sentence, in order, and no others.
    const details = html.slice(html.indexOf('<details class="sfformat"'));
    const rendered = [...details.matchAll(/<li>(.*?)<\/li>/g)].map((m) => m[1]);
    const expected = describeSplitFleetConfig(input.config).map((line) =>
      line.text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;'),
    );
    expect(rendered).toEqual(expected);
    expect(rendered.length).toBeGreaterThan(4);

    // Closed by default: it is the follow-up question, not the one the reader
    // arrived with, and the standings stay the page.
    expect(details).not.toContain('<details class="sfformat" open');
  });

  it('says it on the page the publication points at, not on every page', () => {
    const input = renderInputFor(FIXTURE);
    // The shared stylesheet carries the rule on every page; only the
    // championship carries the block.
    expect(renderSplitFleetRaceResultsPage(input, {})).not.toContain('<details class="sfformat"');
    expect(renderSplitFleetAssignmentsPage(input, {})).not.toContain('<details class="sfformat"');
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
    // M1: the doubling reaches the code score too — the medal-fleet base of
    // 3 is scored 6. The coded boat is unranked, after the finishers.
    expect(tableRows(section(html, 'm1'))).toEqual([
      { rank: '1', sail: 'b1', code: '', points: '2' },
      { rank: '', sail: 'y1', code: 'BFD', points: '6' },
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
    // A halved carry mints stage race 0 cells; they are scores, not races,
    // and get no section — while the superseded opening races keep theirs.
    const html = renderSplitFleetRaceResultsPage(renderInputFor('15-f3-compressed-carry.yaml'))!;
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

  it('withholds the device\u2019s record, times included, without the resolved opt-in', () => {
    const html = renderSplitFleetRaceResultsPage(
      { ...withTrack(renderInputFor(FIXTURE)), showTrackData: false },
    )!;
    for (const header of TRACK_HEADERS) {
      expect(html).not.toContain(`>${header}</th>`);
    }
    expect(html).not.toContain('11:45:20');
  });

  it('publishes a hand-recorded time without the opt-in, which is not the device\u2019s to withhold', () => {
    const input = renderInputFor(FIXTURE);
    const html = renderSplitFleetRaceResultsPage({
      ...input,
      showTrackData: false,
      finishes: input.finishes.map((f) =>
        f.sortOrder !== null ? { ...f, finishTime: '11:45:20' } : f,
      ),
    })!;
    expect(html).toContain('>Finish time</th>');
    expect(html).toContain('>11:45:20</td>');
    expect(html).not.toContain('>Distance (km)</th>');
  });

  it('decides per boat, so a half-imported race publishes the times it may', () => {
    const input = renderInputFor(FIXTURE);
    const finishers = input.finishes.filter((f) => f.sortOrder !== null);
    const [measured, handTimed] = finishers;
    const html = renderSplitFleetRaceResultsPage({
      ...input,
      showTrackData: false,
      finishes: input.finishes.map((f) => {
        if (f.id === measured.id) {
          return { ...f, finishTime: '11:45:20', trackData: { distanceKm: 2.73 } };
        }
        if (f.id === handTimed.id) return { ...f, finishTime: '11:46:20' };
        return f;
      }),
    })!;
    expect(html).not.toContain('11:45:20');
    expect(html).toContain('>11:46:20</td>');
  });

  it('works the elapsed times out from each fleet\u2019s own gun', () => {
    const input = renderInputFor(FIXTURE);
    const gunByRace = new Map(input.raceStarts.map((s) => [s.raceId, '11:00:00']));
    const html = renderSplitFleetRaceResultsPage({
      ...input,
      raceStarts: input.raceStarts.map((s) => ({ ...s, startTime: gunByRace.get(s.raceId) })),
      finishes: input.finishes.map((f) =>
        f.sortOrder !== null ? { ...f, finishTime: '11:45:20' } : f,
      ),
    })!;
    expect(html).toContain('>Elapsed</th>');
    expect(html).toContain('>45:20</td>');
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

/**
 * The race record on a championship's pages (#338/#339). These three pages
 * build their own chrome rather than going through the per-fleet assembler,
 * and the record was simply missing from it: a series that had opted in
 * published its officials in the data file beside the page and nowhere on it.
 */
describe('the race record on a championship’s pages', () => {
  const FIXTURE = '01-f1-ilca-continuous-carry.yaml';
  const MEDAL = '03-f2-ilca-medal-race.yaml';
  const TEAM: RaceOfficial[] = [
    { id: 'o1', role: 'raceOfficer', name: 'Jane Smith' },
    { id: 'o2', role: 'other', name: 'Sam Doyle', customRole: 'Beach Master' },
  ];
  const RACE_TEAM: RaceOfficial[] = [{ id: 'o3', role: 'recorder', name: 'Tom Byrne' }];
  const CONDITIONS: RaceConditions = {
    windSpeedMin: 8,
    windSpeedMax: 14,
    windDirection: 'SW',
    notes: 'Windward-leeward',
  };

  /** The same slice helper the page tests use: one stage race's heading up to the next. */
  function section(html: string, anchor: string): string {
    const start = html.indexOf(`<h2 id="${anchor}">`);
    expect(start).toBeGreaterThan(-1);
    const next = html.indexOf('<h2 id=', start + 1);
    return next === -1 ? html.slice(start) : html.slice(start, next);
  }

  function onRace(
    input: SplitFleetRenderInput,
    raceId: string,
    patch: Partial<{ conditions: RaceConditions; officials: RaceOfficial[] }>,
  ): SplitFleetRenderInput {
    return {
      ...input,
      races: input.races.map((r) => (r.id === raceId ? { ...r, ...patch } : r)),
    };
  }

  const count = (html: string, needle: string) => html.split(needle).length - 1;

  it('names the standing team on all three pages', () => {
    const input = renderInputFor(FIXTURE);
    const pages = [
      renderSplitFleetStandingsPage(input, { officials: TEAM }),
      renderSplitFleetRaceResultsPage(input, { officials: TEAM })!,
      renderSplitFleetAssignmentsPage(input, { officials: TEAM }),
    ];
    for (const html of pages) {
      expect(html).toContain('class="seriesofficials"');
      expect(html).toContain('Race Officer: Jane Smith · Beach Master: Sam Doyle');
    }
  });

  it('names nobody when the caller withholds the team', () => {
    // The opt-in is the caller's to apply — these pages never decide it.
    const input = renderInputFor(FIXTURE);
    const pages = [
      renderSplitFleetStandingsPage(input, {}),
      renderSplitFleetRaceResultsPage(input, {})!,
      renderSplitFleetAssignmentsPage(input, {}),
    ];
    for (const html of pages) {
      expect(html).not.toContain('seriesofficials');
      expect(html).not.toContain('Jane Smith');
    }
  });

  it('states a race’s conditions and team under that fleet’s own heading', () => {
    // Each fleet sails its own race here, so the record belongs to the fleet
    // that sailed it — Blue's table is under the same heading and says nothing.
    const input = onRace(
      { ...renderInputFor(FIXTURE), publishOfficials: true },
      'qualifying1:Yellow',
      { conditions: CONDITIONS, officials: RACE_TEAM },
    );
    const q1 = section(renderSplitFleetRaceResultsPage(input)!, stageRaceAnchor('qualifying', 1));
    expect(count(q1, 'class="raceconditions"')).toBe(1);
    expect(count(q1, 'class="raceofficials"')).toBe(1);
    expect(q1).toContain('Wind 8–14 kt SW · Windward-leeward');
    expect(q1).toContain('Recorder: Tom Byrne');
    // The lines sit inside the Yellow block: after its heading, before Blue's.
    const yellow = q1.indexOf('Yellow fleet</h3>');
    const blue = q1.indexOf('Blue fleet</h3>');
    const conditions = q1.indexOf('class="raceconditions"');
    expect(yellow).toBeLessThan(conditions);
    expect(conditions).toBeLessThan(blue);
  });

  it('states it once under the race heading when one fleet sailed it', () => {
    const input = onRace(
      { ...renderInputFor(MEDAL), publishOfficials: true },
      'medal1:Medal',
      { conditions: CONDITIONS, officials: RACE_TEAM },
    );
    const medal = section(renderSplitFleetRaceResultsPage(input)!, stageRaceAnchor('medal', 1));
    expect(count(medal, 'class="raceconditions"')).toBe(1);
    expect(medal.indexOf('class="raceconditions"')).toBeLessThan(medal.indexOf('<h3'));
  });

  it('publishes the conditions without the opt-in, but not the team', () => {
    // Conditions describe the racing rather than a person, as everywhere else.
    const input = onRace(renderInputFor(FIXTURE), 'qualifying1:Yellow', {
      conditions: CONDITIONS,
      officials: RACE_TEAM,
    });
    const html = renderSplitFleetRaceResultsPage(input)!;
    expect(html).toContain('class="raceconditions"');
    expect(html).not.toContain('raceofficials');
    expect(html).not.toContain('Tom Byrne');
  });

  it('says nothing for a race with no record', () => {
    const html = renderSplitFleetRaceResultsPage({
      ...renderInputFor(FIXTURE),
      publishOfficials: true,
    })!;
    expect(html).not.toContain('raceconditions');
    expect(html).not.toContain('raceofficials');
  });
});
