/**
 * The archive-kit toolkit (ADR-010, #283): capture parsers (Sailwave HTML,
 * HalSail HTML), the document builders with their deterministic ids, the
 * `.blw` PII scrub, and the canonical document hash. Fixtures are synthetic
 * but byte-shaped like the real captures in iodai-archive / dbsc-archive.
 */
import { describe, expect, test } from 'vitest';

import { scrubBlwText, isPiiKey } from '@/lib/archive-kit/blw-scrub';
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
    expect(senior.rows[0].raceCells[2]).toEqual({ text: '(11.0)', discard: true });
    expect(senior.rows[0].raceCells[0]).toEqual({ text: '1.0', discard: false });

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
      name: 'Cruisers 3 — 2024 Summer Series',
      publishedSlug: 'dbsc-2024-summer-cruisers-3',
      fleetName: 'Cruisers 3',
      subPath: 'cruisers-3',
      page,
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
    // Race headers pick up the dates row.
    expect(doc.fleets[0].results.raceHeaders[0].label).toBe('R3 27 Apr');
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
