/**
 * The live-HalSail capture parser (ADR-010): the `/Result/_Boat/{seriesId}`
 * fragment halsail.com loads into its results page, and the HalSail document
 * builder fed from it. Fixtures are synthetic but shaped like the real
 * captures in bray-archive: the page repeated per breakpoint frame, hidden
 * columns marked `d-none`, races captioned with their officer and wind.
 */
import { describe, expect, test } from 'vitest';

import { buildHalsailArchiveDoc } from '@/lib/archive-kit/halsail-doc';
import { parseHalsailLiveHtml } from '@/lib/archive-kit/halsail-live-html';

const th = (label: string, cls = 'text-start') => `<th class='${cls}'>${label}</th>`;
const td = (text: string, cls = 'text-start') => `<td class='${cls}'>${text}</td>`;

/** Lead columns as HalSail emits them, with the club's hidden ones. */
const LEAD_HEAD = [
  th('Sail'),
  th('Sel', 'd-none'),
  th('Type'),
  th('Name'),
  th('Owner'),
  th('Helm', 'd-none'),
  th('Club', 'd-none'),
].join('');

function leadCells(sail: string, type: string, boat: string, owner: string): string {
  return [
    td(`<div class="sailtext">${sail}</div>`),
    td('', 'd-none'),
    td(type),
    td(boat),
    td(owner),
    td('', 'd-none'),
    td('Bray SC', 'd-none'),
  ].join('');
}

function overallTable(caption: string, extraLead = ''): string {
  return `
<div id="divOverall" class="row"><div class="col text-center">
<table class="table">
  <caption><span class="badge"><span class="lead" title="Database last queried">${caption}</span>
    ${extraLead}
    <span><a class="btn" href="/Result/EchoAnalysis/1">ECHO Analysis</a></span></span></caption>
  <thead><tr>
    <th class="text-start rank">Rank</th>${LEAD_HEAD}
    <th class='text-center'><button type="button">Race 2</button></th>
    <th class='text-center'><button type="button">Race 3</button></th>
    <th class="text-end">Score</th>
  </tr></thead>
  <tbody>
    <tr data-flags=""><td class="text-start rank">1</td>${leadCells('2008', 'Jaguar 25', 'Sea Fox', 'J Honner')}
      ${td('(10/DNC)', 'text-center')}${td('1', 'text-center')}<td class="text-end"><b>1</b></td></tr>
    <tr data-flags=""><td class="text-start rank">2=</td>${leadCells('50', 'Westerly M', 'Samara', 'H Esmonde')}
      ${td('3', 'text-center')}${td('(6)', 'text-center')}<td class="text-end"><b>3</b></td></tr>
  </tbody>
</table></div></div>`;
}

function raceDiv(id: number, captionText: string, body: boolean): string {
  const head = `
  <caption><span class="badge">
    <span class="scrolltop float-start"><i class="bi-arrow-up-circle-fill"></i></span>
    <a class="btn" href="/Result/EchoAnalysisRace/${id}">ECHO Analysis</a> ${captionText}
    <a href="/Result/PdfRaceByBoat/${id}" class="float-end pdf"><i class="bi-filetype-pdf"></i></a>
  </span></caption>`;
  const table = body
    ? `${head}
  <thead><tr>
    <th class="text-start place">Place</th>${LEAD_HEAD}
    <th class='text-start'>Hcap</th>
    <th class='d-none'>Laps</th>
    <th class='text-center'>Finish</th>
    <th class='text-center d-none d-md-table-cell'>Elapsed</th>
    <th class='text-center'>Corr-<br />ected</th>
    <th class='text-center'>Points</th>
    <th class='text-end'>Next<br />Hcap</th>
  </tr></thead>
  <tbody>
    <tr><td class="text-start place">1</td>${leadCells('2008', 'Jaguar 25', 'Sea Fox', 'J Honner')}
      ${td('0.690')}${td('1', 'd-none')}${td('11:28:12', 'text-center')}${td('1:23:12', 'text-center d-none d-md-table-cell')}
      ${td('0:57:24', 'text-center')}${td('1', 'text-center')}${td('0.706', 'text-end')}</tr>
  </tbody>`
    : head;
  return `<div id="${id}" class="row" data-raceid="${id}"><div class="col">
<table class="R${id} table">${table}</table></div></div>`;
}

const FRAME_XL = `<div class="sizeframe d-none d-xl-block">
${overallTable('Cruisers, Cruisers Overall 2026')}
${raceDiv(1, 'Sat01 (Race 1), 9 May 2026 16:35:00 <span class="text-danger">Cancelled</span>', false)}
${raceDiv(3, "Sat02 (Race 3), 16 May 2026 10:05:00 <span>, race officer was Philip O'Reilly, wind was 5 to 10 kn W </span>", true)}
</div>`;

// A narrower frame of the same page — never read.
const FRAME_SM = `<div class="sizeframe d-block d-sm-none">
${overallTable('Narrow frame')}
</div>`;

const LIVE_HTML = `\n${FRAME_XL}\n${FRAME_SM}\n<script>var frame = 1;</script>`;

describe('halsail live parser', () => {
  test('reads the widest frame, dropping the columns the page hides', () => {
    const page = parseHalsailLiveHtml(LIVE_HTML);
    const overall = page.overall!;
    expect(overall.caption).toBe('Cruisers, Cruisers Overall 2026');
    expect(overall.leadColumns.map((c) => c.label)).toEqual(['Sail', 'Type', 'Name', 'Owner']);
    expect(overall.raceHeaders).toEqual(['Race 2', 'Race 3']);
    expect(overall.summaryColumns.map((c) => c.label)).toEqual(['Score']);
    expect(overall.rows).toHaveLength(2);
    expect(overall.rows[0].leadCells).toEqual(['2008', 'Jaguar 25', 'Sea Fox', 'J Honner']);
    expect(overall.rows[0].raceCells[0]).toEqual({ text: '(10/DNC)', discard: true });
    expect(overall.rows[1]).toMatchObject({ rankLabel: '2=', rank: 2 });
    expect(page.highPoint).toBeUndefined();
  });

  test('skips a cancelled race and reads the caption without its links', () => {
    const page = parseHalsailLiveHtml(LIVE_HTML);
    expect(page.races).toHaveLength(1);
    const race = page.races[0];
    expect(race.label).toBe('Sat02 (Race 3)');
    expect(race.date).toBe('2026-05-16');
    expect(race.caption).toBe(
      "Sat02 (Race 3), 16 May 2026 10:05:00, race officer was Philip O'Reilly, wind was 5 to 10 kn W",
    );
    // A breakpoint class brings Elapsed back; a <br> splits two header words
    // but joins a hyphenated one.
    expect(race.columns.map((c) => c.label)).toEqual([
      'Place', 'Sail', 'Type', 'Name', 'Owner', 'Hcap', 'Finish', 'Elapsed', 'Corrected', 'Points', 'Next Hcap',
    ]);
    expect(race.columns.at(-1)!.key).toBe('next-hcap');
    expect(race.rows[0]).toEqual([
      '1', '2008', 'Jaguar 25', 'Sea Fox', 'J Honner', '0.690', '11:28:12', '1:23:12', '0:57:24', '1', '0.706',
    ]);
  });

  test('a high-point series is flagged, and its scores never read as places', () => {
    const html = `<div class="sizeframe d-none d-xl-block">${overallTable(
      'F15Plus, Summer Dinghy Series 2026',
      '<span class="float-end lead">HP scoring</span>',
    )}</div>`;
    const page = parseHalsailLiveHtml(html);
    expect(page.highPoint).toBe(true);
    expect(page.overall!.caption).toBe('F15Plus, Summer Dinghy Series 2026 · HP scoring');

    const doc = buildHalsailArchiveDoc({
      seriesId: '11111111-2222-4333-8444-555555555555',
      name: 'Summer Dinghy Series 2026',
      publishedSlug: '2026',
      fleets: [{ name: 'Overall', subPath: 'summer-dinghy-series', page }],
    });
    const cells = doc.fleets[0].results.rows.flatMap((r) => r.raceCells);
    expect(cells.some((c) => c.text === '1')).toBe(true);
    expect(cells.every((c) => c.rank === undefined)).toBe(true);
  });

  test('a single-race series reads its rows off the race table', () => {
    const html = `<div class="sizeframe d-none d-xl-block">${raceDiv(
      9,
      'Race 1, 20 Sep 2026 17:35:00 <span>, race officer was N/A, wind was - </span>',
      true,
    )}</div>`;
    const page = parseHalsailLiveHtml(html);
    expect(page.raceOnly).toBe(true);
    expect(page.overall!.leadColumns.map((c) => c.label)).toEqual([
      'Sail', 'Type', 'Name', 'Owner', 'Hcap',
    ]);
    expect(page.overall!.rows[0]).toMatchObject({ rank: 1, leadCells: ['2008', 'Jaguar 25', 'Sea Fox', 'J Honner', '0.690'] });

    const doc = buildHalsailArchiveDoc({
      seriesId: '11111111-2222-4333-8444-666666666666',
      name: 'Single Handed Race 2026',
      publishedSlug: '2026',
      fleets: [{ name: 'Overall', subPath: 'single-handed', page, detail: 'races' }],
    });
    expect(doc.fleets[0].results.detail).toBe('races');
    expect(doc.competitors[0]).toMatchObject({ name: 'J Honner', boatName: 'Sea Fox', sailNumber: '2008' });
  });

  test('a dinghy page names the helm when no owner is shown', () => {
    const html = `<div class="sizeframe d-none d-xl-block">
<div id="divOverall"><table><caption><span class="lead">Murdoch Regatta 2026 - ILCA</span></caption>
<thead><tr><th class="rank">Rank</th>${th('Sail')}${th('Owner', 'd-none')}${th('Helm')}
  <th class='text-center'><button>Race 1</button></th><th class="text-end">Score</th></tr></thead>
<tbody><tr><td class="rank">1</td>${td('161439')}${td('', 'd-none')}${td('Frank Daly')}${td('1', 'text-center')}<td><b>1</b></td></tr></tbody>
</table></div></div>`;
    const doc = buildHalsailArchiveDoc({
      seriesId: '11111111-2222-4333-8444-777777777777',
      name: 'Murdoch Regatta 2026',
      publishedSlug: '2026',
      helmNames: true,
      fleets: [{ name: 'ILCA', subPath: 'murdoch-regatta', page: parseHalsailLiveHtml(html) }],
    });
    expect(doc.competitors[0]).toMatchObject({ name: 'Frank Daly', sailNumber: '161439' });
  });
});
