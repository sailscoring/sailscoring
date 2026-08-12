/**
 * The archive-kit toolkit (ADR-010, #283): capture parsers (Sailwave HTML,
 * HalSail HTML), the document builders with their deterministic ids, the
 * `.blw` PII scrub, and the canonical document hash. Fixtures are synthetic
 * but byte-shaped like the real captures in iodai-archive / dbsc-archive.
 */
import { describe, expect, test } from 'vitest';

import { scrubBlwText, isPiiKey } from '@/lib/archive-kit/blw-scrub';
import { decodeCapture } from '@/lib/archive-kit/capture-encoding';
import { archiveDocHash, stableStringify } from '@/lib/archive-kit/format';
import { buildHalsailArchiveDoc } from '@/lib/archive-kit/halsail-doc';
import { parseHalsailHtml } from '@/lib/archive-kit/halsail-html';
import { buildSailwaveArchiveDoc } from '@/lib/archive-kit/sailwave-doc';
import { parseSailwaveHtml, parseRankLabel } from '@/lib/archive-kit/sailwave-html';

const SAILWAVE_HTML = `<!doctype html>
<html><head><title>Sailwave results</title></head><body>
<h1>Leinsters 2019 Optimists</h1>
<h2>MYC 15-16 June 2019</h2>
<h3 class="summarytitle" id="summarysenior">Senior Division</h3>
<div class="caption summarycaption">Sailed: 3, Discards: 1, To count: 2, Entries: 2, Scoring system: Appendix A</div>
<table class="summarytable" cellspacing="0" cellpadding="0" border="0">
<colgroup span="10">
<col class="rank" />
<col class="sailno" />
<col class="club" />
<col class="helmname" />
<col class="nat" />
<col class="helmagegroup" />
<col class="helmsex" />
<col class="race" />
<col class="race" />
<col class="race" />
</colgroup>
<thead>
<tr class="titlerow">
<th>Rank</th><th>Sail No</th><th>Club</th><th>Helm</th><th>Country</th><th>HelmAgeGroup</th><th>HelmSex</th><th>R1</th><th>R2</th><th>R3</th>
</tr>
</thead>
<tbody>
<tr class="odd summaryrow">
<td>1st</td><td>1622</td><td>HYC</td><td>Rocco Wright</td><td>IRL</td><td>13</td><td>M</td><td class="rank1">1.0</td><td>4.0</td><td>(11.0)</td>
</tr>
<tr class="even summaryrow">
<td>2nd</td><td>1627</td><td>RCYC/ KYC</td><td>James Dwyer Matthews</td><td>IRL</td><td>15</td><td>M</td><td>4.0</td><td class="rank3">3.0</td><td>(10.0)</td>
</tr>
</tbody>
</table>
<h3 class="summarytitle" id="summaryjunior">Junior Division</h3>
<div class="caption summarycaption">Sailed: 3, Discards: 1, To count: 2, Entries: 1, Scoring system: Appendix A</div>
<table class="summarytable" cellspacing="0" cellpadding="0" border="0">
<colgroup span="9">
<col class="rank" />
<col class="sailno" />
<col class="club" />
<col class="helmname" />
<col class="race" />
<col class="race" />
<col class="race" />
<col class="total" />
<col class="nett" />
</colgroup>
<thead>
<tr class="titlerow">
<th>Rank</th><th>Sail No</th><th>Club</th><th>Helm</th><th>R1</th><th>R2</th><th>R3</th><th>Total</th><th>Nett</th>
</tr>
</thead>
<tbody>
<tr class="odd summaryrow">
<td>1st</td><td>1500</td><td>TBSC</td><td>Aoife Byrne</td><td>1.0</td><td>1.0</td><td>(2.0)</td><td>4.0</td><td>2.0</td>
</tr>
</tbody>
</table>
</body></html>`;

const HALSAIL_HTML = `<!doctype html>
<html><body>
<table class="table table-condensed table-hover">
<caption>
  <a id="pageTop" href="#pageBottom">Go to last race</a>
  <span class="badge"><span class="hidden-xs">Class 'Cruisers 3', series '2024 Summer Series', </span>Overall Results</span>
</caption>
<thead><tr>
<th>Rank</th><th>Sail Number</th><th class="hidden-xxxs">Name</th><th>Owner</th><th>Club</th>
<th class="text-center"><a href="#race1193" class="halscroll">R3</a></th>
<th class="text-center"><a href="#race1194" class="halscroll">R6</a></th>
<th class="text-right">Net Pts</th>
</tr></thead>
<tbody>
<tr class="hidden-xxs">
<td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>
<td class="text-center">27 Apr</td><td class="text-center">4 May</td><td>&nbsp;</td>
</tr>
<tr>
<td class="text-left"><b>1</b></td><td class="text-left">1792</td><td>Papytoo</td><td>Mary Murphy</td><td>DMYC</td>
<td>(6/DNC)</td><td>1</td><td class="text-right">7</td>
</tr>
<tr>
<td class="text-left"><b>2</b></td><td class="text-left">246</td><td>Saki</td><td></td><td>RIYC</td>
<td>2</td><td>(3)</td><td class="text-right">9</td>
</tr>
</tbody>
</table>
<table id="race1193" class="table table-condensed table-hover">
<caption><span class="badge"><span class="hidden-xs">Race 3 (provisional) 27/04/2024 14:25:00, race officer was , wind was unknown</span></span></caption>
<thead><tr>
<th>Place</th><th>Sail number</th><th>Name</th><th>Owner</th><th>Club</th><th>Hcap</th><th>Finish</th><th>Elapsed</th><th>Corrected</th><th>Points</th>
</tr></thead>
<tbody>
<tr><td><b>1</b></td><td>246</td><td>Saki</td><td></td><td>RIYC</td><td>0.855</td><td>15:42:10</td><td>01:17:10</td><td>01:05:59</td><td>1</td></tr>
</tbody>
</table>
</body></html>`;

describe('sailwave-html parser', () => {
  test('parses sections, columns, discards, and ranks', () => {
    const page = parseSailwaveHtml(SAILWAVE_HTML);
    expect(page.title).toBe('Leinsters 2019 Optimists');
    expect(page.subtitle).toBe('MYC 15-16 June 2019');
    expect(page.summaries).toHaveLength(2);

    const senior = page.summaries[0];
    expect(senior.title).toBe('Senior Division');
    expect(senior.caption).toContain('Sailed: 3');
    expect(senior.leadColumns.map((c) => c.key)).toEqual([
      'sailno',
      'club',
      'helmname',
      'nat',
      'helmagegroup',
      'helmsex',
    ]);
    expect(senior.raceHeaders).toEqual(['R1', 'R2', 'R3']);
    // No total/nett columns in this section — everything after races is empty.
    expect(senior.summaryColumns).toEqual([]);
    expect(senior.rows[0].rank).toBe(1);
    expect(senior.rows[0].rankLabel).toBe('1st');
    expect(senior.rows[0].raceCells[2]).toEqual({
      text: '(11.0)',
      discard: true,
      podium: 0,
    });
    // The source's rank1 cell class — the published podium colouring.
    expect(senior.rows[0].raceCells[0]).toEqual({
      text: '1.0',
      discard: false,
      podium: 1,
    });

    const junior = page.summaries[1];
    expect(junior.title).toBe('Junior Division');
    expect(junior.summaryColumns.map((c) => c.label)).toEqual(['Total', 'Nett']);
    expect(junior.rows[0].summaryCells).toEqual(['4.0', '2.0']);
  });

  test('rank labels: ordinals, bare numbers, ties, and junk', () => {
    expect(parseRankLabel('1st')).toBe(1);
    expect(parseRankLabel('22nd')).toBe(22);
    expect(parseRankLabel('3')).toBe(3);
    expect(parseRankLabel('2=')).toBe(2);
    expect(parseRankLabel('DNQ')).toBeNull();
    expect(parseRankLabel('')).toBeNull();
  });
});

describe('sailwave doc builder', () => {
  const seriesId = '11111111-2222-4333-8444-555555555555';

  function build() {
    const page = parseSailwaveHtml(SAILWAVE_HTML);
    return buildSailwaveArchiveDoc({
      seriesId,
      name: 'Leinsters 2019 Optimists (Main Fleet)',
      venue: 'MYC',
      startDate: '2019-06-15',
      publishedSlug: 'iodai-leinsters-2019',
      fleets: [
        { name: 'Senior Fleet', subPath: 'senior-fleet', summary: page.summaries[0] },
        { name: 'Junior Fleet', subPath: 'junior-fleet', summary: page.summaries[1] },
      ],
    });
  }

  test('builds a valid document with extracted competitors', () => {
    const doc = build();
    expect(doc.fleets).toHaveLength(2);
    expect(doc.competitors).toHaveLength(3);
    const rocco = doc.competitors.find((c) => c.name === 'Rocco Wright')!;
    expect(rocco.sailNumber).toBe('1622');
    expect(rocco.club).toBe('HYC');
    expect(rocco.nationality).toBe('IRL');
    expect(rocco.age).toBe(13);
    expect(rocco.gender).toBe('M');
    // Rows keep the published cells verbatim.
    const senior = doc.fleets[0];
    expect(senior.results.rows[0].leadCells).toEqual([
      '1622',
      'HYC',
      'Rocco Wright',
      'IRL',
      '13',
      'M',
    ]);
    expect(senior.results.rows[0].raceCells[2]).toEqual({
      text: '(11.0)',
      discard: true,
    });
    expect(senior.results.rows[0].raceCells[0]).toEqual({
      text: '1.0',
      rank: 1,
    });
  });

  test('a second presentation joins to the same competitors (#363)', () => {
    // The Gold/Silver/Bronze split of a result also published as one overall
    // standing: same boats, second set of tables.
    const page = parseSailwaveHtml(SAILWAVE_HTML);
    const doc = buildSailwaveArchiveDoc({
      seriesId,
      name: 'GP14 Munsters 2024',
      publishedSlug: 'ksc-2024',
      fleets: [
        { name: 'Overall', subPath: 'overall', summary: page.summaries[0] },
        {
          name: 'Gold Fleet',
          subPath: 'gold-fleet',
          summary: page.summaries[0],
          displayOnly: true,
        },
      ],
    });
    // Two tables, but two sailors — not four.
    expect(doc.fleets).toHaveLength(2);
    expect(doc.competitors).toHaveLength(2);
    expect(doc.fleets[1].displayOnly).toBe(true);
    // The second presentation's rows point at the structural competitors…
    expect(doc.fleets[1].results.rows.map((r) => r.competitorId)).toEqual(
      doc.fleets[0].results.rows.map((r) => r.competitorId),
    );
    // …and each sailor belongs to both fleets.
    expect(doc.competitors[0].fleetIds).toEqual([
      doc.fleets[0].id,
      doc.fleets[1].id,
    ]);
  });

  test('a second presentation sharing no one fails generation, not ingest', () => {
    const page = parseSailwaveHtml(SAILWAVE_HTML);
    expect(() =>
      buildSailwaveArchiveDoc({
        seriesId,
        name: 'GP14 Munsters 2024',
        publishedSlug: 'ksc-2024',
        fleets: [
          { name: 'Overall', subPath: 'overall', summary: page.summaries[0] },
          // A different section entirely: nobody in it is in the structural
          // table, which is what a forgotten join looks like.
          {
            name: 'Gold Fleet',
            subPath: 'gold-fleet',
            summary: page.summaries[1],
            displayOnly: true,
          },
        ],
      }),
    ).toThrow(/shares no competitor/);
  });

  test('regeneration is deterministic — same ids, same hash', async () => {
    const a = build();
    const b = build();
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(await archiveDocHash(a)).toBe(await archiveDocHash(b));
    // Ids derive from stable inputs, not randomness.
    expect(a.fleets[0].id).toBe(b.fleets[0].id);
    expect(a.competitors[0].id).toBe(b.competitors[0].id);
  });
});

describe('halsail-html parser + doc builder', () => {
  test('parses the overall table, dates row, and race detail', () => {
    const page = parseHalsailHtml(HALSAIL_HTML);
    expect(page.overall).not.toBeNull();
    const overall = page.overall!;
    expect(overall.caption).toContain("Class 'Cruisers 3'");
    expect(overall.leadColumns.map((c) => c.label)).toEqual([
      'Sail Number',
      'Name',
      'Owner',
      'Club',
    ]);
    expect(overall.raceHeaders).toEqual(['R3', 'R6']);
    expect(overall.raceDates).toEqual(['27 Apr', '4 May']);
    expect(overall.summaryColumns.map((c) => c.label)).toEqual(['Net Pts']);
    expect(overall.rows).toHaveLength(2);
    expect(overall.rows[0].rank).toBe(1);
    expect(overall.rows[0].raceCells[0]).toEqual({ text: '(6/DNC)', discard: true });

    expect(page.races).toHaveLength(1);
    expect(page.races[0].label).toBe('Race 3');
    expect(page.races[0].date).toBe('2024-04-27');
    expect(page.races[0].columns.map((c) => c.label)).toContain('Corrected');
    expect(page.races[0].rows[0]).toContain('01:05:59');
  });

  test('builds a valid document; owner is the primary name, boat kept', () => {
    const page = parseHalsailHtml(HALSAIL_HTML);
    const doc = buildHalsailArchiveDoc({
      seriesId: '99999999-8888-4777-8666-555555555555',
      name: 'Cruisers 3 — DBSC Summer Series 2024',
      publishedSlug: 'dbsc-2024-cruisers-3',
      fleets: [
        { name: '2024 Summer Series', subPath: '2024-summer-series', page },
      ],
    });
    expect(doc.fleets).toHaveLength(1);
    const mary = doc.competitors.find((c) => c.owner === 'Mary Murphy')!;
    expect(mary.name).toBe('Mary Murphy');
    expect(mary.boatName).toBe('Papytoo');
    // No owner recorded → the boat name carries the row.
    const saki = doc.competitors.find((c) => c.boatName === 'Saki')!;
    expect(saki.name).toBe('Saki');
    // Race detail is preserved as display strings.
    expect(doc.fleets[0].results.raceTables).toHaveLength(1);
    expect(doc.fleets[0].results.raceTables![0].label).toBe('Race 3');
    expect(doc.fleets[0].results.raceTables![0].rows[0].cells).toContain('01:05:59');
    // The leading Place column yields structured ranks for podium colouring.
    expect(doc.fleets[0].results.raceTables![0].rows[0].rank).toBe(1);
    // Race headers pick up the dates row.
    expect(doc.fleets[0].results.raceHeaders[0].label).toBe('R3 27 Apr');
  });
});

describe('as-published rendering fidelity', () => {
  test('podium classes and nationality flags render like a full-fidelity page', async () => {
    const { renderAsPublishedFleetHtml } = await import('@/lib/archive-kit/render');
    const page = parseSailwaveHtml(SAILWAVE_HTML);
    const doc = buildSailwaveArchiveDoc({
      seriesId: '33333333-4444-4555-8666-777777777777',
      name: 'Fidelity Test',
      publishedSlug: 'fidelity-test',
      fleets: [
        { name: 'Senior', subPath: 'senior', summary: page.summaries[0] },
      ],
    });
    const html = renderAsPublishedFleetHtml(
      {
        seriesName: 'Fidelity Test',
        flagSvgByCode: { IRL: { viewBox: '0 0 3 2', inner: '<rect/>' } },
      },
      doc.fleets[0].results,
    );
    // Podium colouring survives from the source's cell classes…
    expect(html).toContain('class="rank1"');
    // …and composes with discards.
    expect(html).toContain('class="discard"');
    // Nationality cells carry the flag symbol + text code.
    expect(html).toContain('symbol id="flag-IRL"');
    expect(html).toContain('<use href="#flag-IRL"');
    expect(html).toContain('<span class="nattext">IRL</span>');
  });

  test('per-race detail tables colour their podium places', async () => {
    const { renderAsPublishedRaceTable } = await import('@/lib/archive-kit/render');
    const page = parseHalsailHtml(HALSAIL_HTML);
    const doc = buildHalsailArchiveDoc({
      seriesId: '99999999-8888-4777-8666-555555555555',
      name: 'Cruisers 3 — DBSC Summer Series 2024',
      publishedSlug: 'dbsc-2024-cruisers-3',
      fleets: [
        { name: '2024 Summer Series', subPath: '2024-summer-series', page },
      ],
    });
    const html = renderAsPublishedRaceTable(
      doc.fleets[0].results.raceTables![0],
    );
    // The winner's Place cell gets the podium class the summary table uses.
    expect(html).toContain('<td class="rank1">1</td>');
  });
});

describe('document schema', () => {
  test('fleet sub-paths may be two-level (season-slug grouping)', async () => {
    const { archiveSeriesDocSchema } = await import('@/lib/archive-kit/format');
    const fleet = {
      id: '11111111-2222-4333-8444-555555555555',
      name: 'Saturday Overall',
      subPath: 'saturday-overall/beneteau-211-echo',
      results: {
        leadColumns: [{ key: 'helmname', label: 'Helm' }],
        raceHeaders: [{ label: 'R1' }],
        summaryColumns: [{ key: 'nett', label: 'Nett' }],
        rows: [],
      },
    };
    const doc = {
      formatVersion: 1,
      series: {
        id: '99999999-8888-4777-8666-555555555554',
        name: 'Two-level Test',
        publishedSlug: '2022',
      },
      fleets: [fleet],
      competitors: [],
    };
    expect(archiveSeriesDocSchema.safeParse(doc).success).toBe(true);
    const bad = {
      ...doc,
      fleets: [{ ...fleet, subPath: 'a/b/c' }],
    };
    expect(archiveSeriesDocSchema.safeParse(bad).success).toBe(false);
  });

  test('a display-only fleet needs a structural one to account for it (#363)', async () => {
    const { archiveSeriesDocSchema } = await import('@/lib/archive-kit/format');
    const competitorId = '33333333-2222-4333-8444-555555555555';
    const row = {
      competitorId,
      rank: 1,
      rankLabel: '1',
      leadCells: ['Helm'],
      raceCells: [{ text: '1' }],
      summaryCells: ['1'],
    };
    const results = {
      leadColumns: [{ key: 'helmname', label: 'Helm' }],
      raceHeaders: [{ label: 'R1' }],
      summaryColumns: [{ key: 'nett', label: 'Nett' }],
      rows: [row],
    };
    const overall = {
      id: '11111111-2222-4333-8444-555555555555',
      name: 'Overall',
      subPath: 'overall',
      results,
    };
    const gold = {
      id: '22222222-2222-4333-8444-555555555555',
      name: 'Gold Fleet',
      subPath: 'gold-fleet',
      displayOnly: true as const,
      results,
    };
    const doc = {
      formatVersion: 1,
      series: {
        id: '99999999-8888-4777-8666-555555555554',
        name: 'One result, two presentations',
        publishedSlug: '2024',
      },
      fleets: [overall, gold],
      competitors: [
        {
          id: competitorId,
          fleetIds: [overall.id, gold.id],
          sailNumber: '14256',
          name: 'Ger Owens',
        },
      ],
    };
    expect(archiveSeriesDocSchema.safeParse(doc).success).toBe(true);

    // Nothing structural: the series would account for no one.
    const allDisplay = {
      ...doc,
      fleets: [{ ...overall, displayOnly: true as const }, gold],
    };
    expect(archiveSeriesDocSchema.safeParse(allDisplay).success).toBe(false);

    // Structural, but the second presentation shares none of its rows — the
    // signature of a generator that minted a second competitor per sailor.
    const otherId = '44444444-2222-4333-8444-555555555555';
    const unjoined = {
      ...doc,
      fleets: [
        overall,
        { ...gold, results: { ...results, rows: [{ ...row, competitorId: otherId }] } },
      ],
      competitors: [
        ...doc.competitors,
        {
          id: otherId,
          fleetIds: [gold.id],
          sailNumber: '14256',
          name: 'Ger Owens',
        },
      ],
    };
    expect(archiveSeriesDocSchema.safeParse(unjoined).success).toBe(false);
  });

  test('folder labels must name a published segment, once each (ADR-011)', async () => {
    const { archiveSeriesDocSchema } = await import('@/lib/archive-kit/format');
    const fleet = {
      id: '11111111-2222-4333-8444-555555555555',
      name: 'Class 1 IRC',
      subPath: 'autumn-league/class-1-irc',
      results: {
        leadColumns: [{ key: 'helmname', label: 'Helm' }],
        raceHeaders: [{ label: 'R1' }],
        summaryColumns: [{ key: 'nett', label: 'Nett' }],
        rows: [],
      },
    };
    const doc = (folders: Array<{ path: string; label: string }>) => ({
      formatVersion: 1,
      series: {
        id: '99999999-8888-4777-8666-555555555554',
        name: 'Folder Label Test',
        publishedSlug: '2025',
        folders,
      },
      fleets: [fleet],
      competitors: [],
    });
    expect(
      archiveSeriesDocSchema.safeParse(
        doc([{ path: 'autumn-league', label: "Autumn League '25" }]),
      ).success,
    ).toBe(true);
    // A label for a segment no page publishes under is a typo, not a pin.
    expect(
      archiveSeriesDocSchema.safeParse(
        doc([{ path: 'spring-league', label: 'Spring League' }]),
      ).success,
    ).toBe(false);
    expect(
      archiveSeriesDocSchema.safeParse(
        doc([
          { path: 'autumn-league', label: 'A' },
          { path: 'autumn-league', label: 'B' },
        ]),
      ).success,
    ).toBe(false);
  });
});

describe("as-published race-results detail (#347)", () => {
  const RACE_TABLE = {
    label: 'Lambay Race',
    columns: [
      { key: 'rank', label: 'Rank' },
      { key: 'boat', label: 'Boat' },
      { key: 'points', label: 'Points' },
    ],
    rows: [
      { rank: 1, cells: ['1', 'Aurelia', '1.0'] },
      { rank: 2, cells: ['2', 'Bandit', '2.0'] },
    ],
  };
  const RESULTS = {
    detail: 'races' as const,
    leadColumns: [{ key: 'helmname', label: 'Helm' }],
    raceHeaders: [{ label: 'R1' }],
    summaryColumns: [{ key: 'nett', label: 'Nett' }],
    // Structural, not display: the identity spine reads these rows even
    // though the page shows only the race table.
    rows: [
      {
        competitorId: '11111111-2222-4333-8444-5555555555aa',
        rank: 1,
        rankLabel: '1st',
        leadCells: ['Aurelia'],
        raceCells: [{ text: '1' }],
        summaryCells: ['1.0'],
      },
    ],
    raceTables: [RACE_TABLE],
  };

  test('a fleet page renders the race table alone', async () => {
    const { renderAsPublishedFleetHtml } = await import('@/lib/archive-kit/render');
    const html = renderAsPublishedFleetHtml({ seriesName: 'Lambay Race' }, RESULTS);
    expect(html).toContain('class="racetable"');
    expect(html).not.toContain('class="summarytable"');
    expect(html).not.toContain('>Nett<');
    expect(html).toContain('Aurelia');
  });

  test('a combined page drops only the race-results sections\' standings', async () => {
    const { renderAsPublishedCombinedHtml } = await import('@/lib/archive-kit/render');
    const withStandings = { ...RESULTS, detail: undefined };
    const html = renderAsPublishedCombinedHtml({ seriesName: 'Mixed' }, [
      { name: 'Class 1', results: RESULTS },
      { name: 'Class 2', results: withStandings },
    ]);
    // Only the full-detail section contributes a standings heading…
    expect(html).not.toContain('<h3 class="summarytitle">Class 1</h3>');
    expect(html).toContain('<h3 class="summarytitle">Class 2</h3>');
    // …and both sections' race tables are there.
    expect(html.match(/class="racetable"/g)).toHaveLength(2);
  });

  test('a doc builder carries the detail onto each fleet', () => {
    const page = parseHalsailHtml(HALSAIL_HTML);
    const doc = buildHalsailArchiveDoc({
      seriesId: '99999999-8888-4777-8666-555555555551',
      name: 'Gibney Classic',
      publishedSlug: 'gibney-classic',
      fleets: [
        { name: 'Class 1', subPath: 'class-1', page, detail: 'races' },
      ],
    });
    expect(doc.fleets[0].results.detail).toBe('races');
    // The summary rows survive — they are what the identity spine reads.
    expect(doc.fleets[0].results.rows.length).toBeGreaterThan(0);
    expect(doc.competitors.length).toBeGreaterThan(0);
  });

  test('the ingest format rejects race-results detail with no race table', async () => {
    const { archiveSeriesDocSchema } = await import('@/lib/archive-kit/format');
    const doc = (results: unknown) => ({
      formatVersion: 1,
      series: {
        id: '99999999-8888-4777-8666-555555555554',
        name: 'Lambay Race',
        publishedSlug: '2026',
      },
      fleets: [
        {
          id: '11111111-2222-4333-8444-555555555555',
          name: 'Class 1',
          subPath: 'lambay-race/class-1',
          results,
        },
      ],
      competitors: [
        {
          id: '11111111-2222-4333-8444-5555555555aa',
          name: 'Aurelia',
          sailNumber: '1234',
          fleetIds: ['11111111-2222-4333-8444-555555555555'],
        },
      ],
    });
    expect(archiveSeriesDocSchema.safeParse(doc(RESULTS)).success).toBe(true);
    const noRaceTable = { ...RESULTS, raceTables: undefined };
    expect(archiveSeriesDocSchema.safeParse(doc(noRaceTable)).success).toBe(false);
  });
});

describe('combined pages (#321)', () => {
  const FLEET_A = '11111111-2222-4333-8444-555555555555';
  const FLEET_B = '11111111-2222-4333-8444-555555555556';

  function fleet(id: string, subPath: string | undefined) {
    return {
      id,
      name: id === FLEET_A ? 'HPH' : 'Scratch',
      ...(subPath ? { subPath } : {}),
      results: {
        leadColumns: [{ key: 'helmname', label: 'Helm' }],
        raceHeaders: [{ label: 'R1' }],
        summaryColumns: [{ key: 'nett', label: 'Nett' }],
        rows: [],
      },
    };
  }

  function doc(overrides: Record<string, unknown>) {
    return {
      formatVersion: 1,
      series: {
        id: '99999999-8888-4777-8666-555555555554',
        name: 'Combined Test',
        publishedSlug: '2025',
      },
      fleets: [fleet(FLEET_A, undefined), fleet(FLEET_B, undefined)],
      combinedPages: [
        { subPath: 'puppeteer-22', name: 'Puppeteer 22', fleetIds: [FLEET_A, FLEET_B] },
      ],
      competitors: [],
      ...overrides,
    };
  }

  test('accepts two section-only fleets grouped under one combined page', async () => {
    const { archiveSeriesDocSchema } = await import('@/lib/archive-kit/format');
    expect(archiveSeriesDocSchema.safeParse(doc({})).success).toBe(true);
  });

  test('rejects a fleet that is both standalone and a combined-page member', async () => {
    const { archiveSeriesDocSchema } = await import('@/lib/archive-kit/format');
    const bad = doc({ fleets: [fleet(FLEET_A, 'hph'), fleet(FLEET_B, undefined)] });
    expect(archiveSeriesDocSchema.safeParse(bad).success).toBe(false);
  });

  test('rejects a fleet that is neither standalone nor grouped', async () => {
    const { archiveSeriesDocSchema } = await import('@/lib/archive-kit/format');
    const bad = doc({ combinedPages: [{ subPath: 'puppeteer-22', name: 'Puppeteer 22', fleetIds: [FLEET_A] }] });
    expect(archiveSeriesDocSchema.safeParse(bad).success).toBe(false);
  });

  test('rejects a combined page referencing an unknown fleet', async () => {
    const { archiveSeriesDocSchema } = await import('@/lib/archive-kit/format');
    const bad = doc({
      combinedPages: [
        { subPath: 'puppeteer-22', name: 'Puppeteer 22', fleetIds: [FLEET_A, FLEET_B, '00000000-0000-4000-8000-000000000009'] },
      ],
    });
    expect(archiveSeriesDocSchema.safeParse(bad).success).toBe(false);
  });

  test('rejects a combined subPath colliding with a standalone fleet', async () => {
    const { archiveSeriesDocSchema } = await import('@/lib/archive-kit/format');
    const other = fleet('11111111-2222-4333-8444-555555555557', 'puppeteer-22');
    const bad = doc({ fleets: [fleet(FLEET_A, undefined), fleet(FLEET_B, undefined), other] });
    expect(archiveSeriesDocSchema.safeParse(bad).success).toBe(false);
  });

  test('doc builder resolves member fleet ids and omits their subPaths', async () => {
    const { archiveSeriesDocSchema } = await import('@/lib/archive-kit/format');
    const { fleetIdFor } = await import('@/lib/archive-kit/ids');
    const seriesId = '44444444-5555-4666-8777-888888888888';
    const page = parseSailwaveHtml(SAILWAVE_HTML);
    const built = buildSailwaveArchiveDoc({
      seriesId,
      name: 'Combined Builder Test',
      publishedSlug: 'combined-builder',
      fleets: [
        { name: 'Senior Division', summary: page.summaries[0] },
        { name: 'Junior Division', summary: page.summaries[1] },
      ],
      combinedPages: [
        {
          subPath: 'optimists',
          name: 'Optimists',
          fleetNames: ['Senior Division', 'Junior Division'],
        },
      ],
    });
    // Members carry no standalone subPath; the combined page owns the URL.
    expect(built.fleets.every((f) => f.subPath === undefined)).toBe(true);
    expect(built.combinedPages).toEqual([
      {
        subPath: 'optimists',
        name: 'Optimists',
        fleetIds: [
          fleetIdFor(seriesId, 'Senior Division'),
          fleetIdFor(seriesId, 'Junior Division'),
        ],
      },
    ]);
    // And the whole document satisfies the publication invariant.
    expect(archiveSeriesDocSchema.safeParse(built).success).toBe(true);
  });

  test('groups every standings table first, then all race tables (Sailwave layout)', async () => {
    const { renderAsPublishedCombinedHtml } = await import('@/lib/archive-kit/render');
    const section = (helm: string, raceLabel: string) => ({
      name: `${helm} Fleet`,
      results: {
        leadColumns: [{ key: 'helmname', label: 'Helm' }],
        raceHeaders: [{ label: 'R1' }],
        summaryColumns: [{ key: 'nett', label: 'Nett' }],
        rows: [
          {
            competitorId: '00000000-0000-4000-8000-000000000001',
            rank: 1,
            rankLabel: '1',
            leadCells: [helm],
            raceCells: [{ text: '1' }],
            summaryCells: ['1'],
          },
        ],
        raceTables: [
          {
            label: raceLabel,
            columns: [{ key: 'rank', label: 'Place' }],
            rows: [{ cells: ['1'] }],
          },
        ],
      },
    });
    const html = renderAsPublishedCombinedHtml({ seriesName: 'X' }, [
      section('HPH', 'R1 - HPH Fleet'),
      section('Scratch', 'R1 - Scratch Fleet'),
    ]);
    // Both standings tables precede the first race table.
    expect(html.lastIndexOf('class="summarytable"')).toBeLessThan(
      html.indexOf('class="racetable"'),
    );
    // Race tables keep their own fleet-named titles, in section order.
    expect(html.indexOf('R1 - HPH Fleet')).toBeLessThan(
      html.indexOf('R1 - Scratch Fleet'),
    );
  });

  test('renders each member fleet as a titled section of one document', async () => {
    const { renderAsPublishedCombinedHtml } = await import('@/lib/archive-kit/render');
    const page = parseSailwaveHtml(SAILWAVE_HTML);
    const senior = buildSailwaveArchiveDoc({
      seriesId: '33333333-4444-4555-8666-777777777777',
      name: 'Combined Render Test',
      publishedSlug: 'combined-render',
      fleets: [{ name: 'Senior', subPath: 'senior', summary: page.summaries[0] }],
    });
    const junior = buildSailwaveArchiveDoc({
      seriesId: '33333333-4444-4555-8666-777777777778',
      name: 'Combined Render Test',
      publishedSlug: 'combined-render',
      fleets: [{ name: 'Junior', subPath: 'junior', summary: page.summaries[1] }],
    });
    const html = renderAsPublishedCombinedHtml(
      { seriesName: 'Combined Render Test' },
      [
        { name: 'Senior Division', results: senior.fleets[0].results },
        { name: 'Junior Division', results: junior.fleets[0].results },
      ],
    );
    expect(html).toContain('<h3 class="summarytitle">Senior Division</h3>');
    expect(html).toContain('<h3 class="summarytitle">Junior Division</h3>');
    // Both sections' rows are present in the one document.
    expect(html).toContain('Rocco Wright');
    expect(html).toContain('Aoife Byrne');
    // Two standings tables, one per section.
    expect(html.match(/class="summarytable"/g)).toHaveLength(2);
  });
});

describe('blank helm placeholders', () => {
  test('a blank helm becomes "Unknown Competitor (sail)"; the matcher ignores it', async () => {
    const { clusterCompetitors } = await import('@/lib/competitor-identity-cluster');
    const { isPlaceholderName } = await import('@/lib/competitor-identity-match');
    const html = SAILWAVE_HTML.replace('Aoife Byrne', '');
    const page = parseSailwaveHtml(html);
    const doc = buildSailwaveArchiveDoc({
      seriesId: '22222222-3333-4444-8555-666666666666',
      name: 'Placeholder Test',
      publishedSlug: 'placeholder-test',
      fleets: [
        { name: 'Junior Fleet', subPath: 'junior-fleet', summary: page.summaries[1] },
      ],
    });
    const unknown = doc.competitors.find((c) => c.sailNumber === '1500')!;
    expect(unknown.name).toBe('Unknown Competitor (1500)');
    expect(isPlaceholderName(unknown.name)).toBe(true);
    // The published cell stays blank — faithful display, sensible listing.
    expect(doc.fleets[0].results.rows[0].leadCells[2]).toBe('');

    // Two unknowns on the same reused sail, years apart: neither clustered
    // nor suggested — a placeholder is not identity evidence.
    const result = clusterCompetitors([
      {
        competitorId: '00000000-0000-4000-8000-000000000001',
        name: 'Unknown Competitor (1620)',
        sailNumber: '1620',
        age: null,
        raceYear: 2012,
        existingIdentityId: null,
      },
      {
        competitorId: '00000000-0000-4000-8000-000000000002',
        name: 'Unknown Competitor (1620)',
        sailNumber: '1620',
        age: null,
        raceYear: 2019,
        existingIdentityId: null,
      },
    ]);
    expect(result.clusters).toHaveLength(2);
    expect(result.suggestions).toHaveLength(0);
    expect(result.stats.withoutSurname).toBe(2);
  });
});

describe('blw PII scrub', () => {
  test('strips DOB / email / phone rows, keeps age and names', () => {
    const blw = [
      '"sernam","Leinsters 2019"',
      '"comphelmname","Rocco Wright","1",""',
      '"comphelmagegroup","13","1",""',
      '"comphelmemail","someone@example.com","1",""',
      '"comphelmphone","+353 87 000 0000","1",""',
      '"comphelmdob","2006-01-02","1",""',
      '"compclub","HYC","1",""',
    ].join('\n');
    const { text, removed } = scrubBlwText(blw);
    expect(removed).toEqual({
      comphelmemail: 1,
      comphelmphone: 1,
      comphelmdob: 1,
    });
    expect(text).toContain('Rocco Wright');
    expect(text).toContain('comphelmagegroup');
    expect(text).not.toContain('example.com');
    expect(text).not.toContain('87 000');
    expect(text).not.toContain('2006-01-02');
    // Idempotent: a second pass removes nothing.
    expect(scrubBlwText(text).removed).toEqual({});
  });

  test('key classifier: age is not PII; birth/address cousins are', () => {
    expect(isPiiKey('comphelmagegroup')).toBe(false);
    expect(isPiiKey('comphelmname')).toBe(false);
    expect(isPiiKey('compaddress2')).toBe(true);
    expect(isPiiKey('comphelmdateofbirth')).toBe(true);
    expect(isPiiKey('compemergencycontact')).toBe(true);
  });
});

describe('capture decoding', () => {
  const page = (charset: string, body: string) =>
    `<html><head><meta http-equiv="Content-Type" content="text/html;charset=${charset}"/>` +
    `</head><body>${body}</body></html>`;

  test('an ISO-8859-1 page keeps its accented names', () => {
    const bytes = Buffer.from(page('ISO-8859-1', '<td>Aoibh\xed Ryan</td>'), 'latin1');
    const { text, encoding } = decodeCapture(bytes);
    expect(text).toContain('Aoibhí Ryan');
    expect(text).not.toContain('\uFFFD');
    expect(encoding).toBe('windows-1252');
  });

  test('windows-1252 punctuation decodes as punctuation', () => {
    const bytes = Buffer.from(page('ISO-8859-1', "<td>Craig O\x92Neill</td><td>April \x96 May</td>"), 'latin1');
    expect(decodeCapture(bytes).text).toContain('Craig O\u2019Neill');
    expect(decodeCapture(bytes).text).toContain('April \u2013 May');
  });

  test('bytes windows-1252 leaves unassigned pass through, never U+FFFD', () => {
    const bytes = Buffer.from(page('ISO-8859-1', "<td>P Cruise O'\x81\x81\x81Brien</td>"), 'latin1');
    const { text } = decodeCapture(bytes);
    expect(text).toContain("P Cruise O'\u0081\u0081\u0081Brien");
    expect(text).not.toContain('\uFFFD');
  });

  test('a UTF-8 page is read as UTF-8 even when it declares ISO-8859-1', () => {
    const bytes = Buffer.from(page('ISO-8859-1', '<td>Martin O\u2019Reilly</td>'), 'utf8');
    const { text, encoding } = decodeCapture(bytes);
    expect(text).toContain('Martin O\u2019Reilly');
    expect(encoding).toBe('utf-8');
  });

  test('a UTF-8 BOM is not carried into the text', () => {
    const bytes = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(page('UTF-8', '<td>Réaltín Boinnard</td>'), 'utf8'),
    ]);
    const { text } = decodeCapture(bytes);
    expect(text.startsWith('<html>')).toBe(true);
    expect(text).toContain('Réaltín Boinnard');
  });

  test('a declared non-Latin-1 charset is honoured when the bytes are not UTF-8', () => {
    // 0xE8 is č in windows-1250 and è in windows-1252.
    const bytes = Buffer.from(page('windows-1250', '<td>\xe8</td>'), 'latin1');
    const { text, encoding } = decodeCapture(bytes);
    expect(encoding).toBe('windows-1250');
    expect(text).toContain('<td>\u010D</td>');
  });
});
