/**
 * The Sail100 capture parser (ADR-010): standings whose race columns are
 * linked to the race's own page, the race pages themselves, and the
 * Sailwave-shaped document built from them. Fixtures are synthetic but shaped
 * like Bray Sailing Club's captures: race columns headed by a code and a date
 * rather than "Race N", and boats listed by owner with no helm.
 */
import { describe, expect, test } from 'vitest';

import { parseSail100Html, parseSail100RaceHtml } from '@/lib/archive-kit/sail100-html';
import { buildSailwaveArchiveDoc, summaryFromRaceTables } from '@/lib/archive-kit/sailwave-doc';

const STANDINGS = `<html><body><center>
<h1>Saturday series 2023</h1>
<h2>Entries: 2&nbsp; Races Sailed: 2&nbsp; Discard: 0</h2>
<table border="1">
<tr>
<td class="q">Series Place</td><td class="o">Sail No</td>
<td class="o">Boat</td>
<td class="o">Type of Boat</td>
<td class="o">Owner</td>
<td class="q"><a href="saturdayseries2023hp.html">Handicap</a></td>
<td class="q">Series Points</td>
<td class="q"><a href="saturdayseries202302.html">S2 270523</a></td>
<td class="q"><a href="saturdayseries202305.html">S3 100623</a></td>
</tr>
<tr><td class="i">1</td><td>H265047</td><td class="c">Dalliance</td><td>Sigma 33</td><td>M Whelan</td>
<td class="n">0.6439</td><td class="i">3</td><td class="n">1</td><td class="j">2</td></tr>
<tr><td class="i">2</td><td>1655</td><td class="c">Paloma</td><td>Sigma 33</td><td>P Miley</td>
<td class="n">0.6708</td><td class="i">3</td><td class="n">2</td><td class="n">1</td></tr>
</table>
</center></body></html>`;

const RACE = `<html><body><center>
<h1>Saturday series 2023</h1>
<h1>S2 270523</h1>
<h2>Start: Sat 27 May 23 16:35:00</h2>
<table border="1">
<tr>
<td class="q">Points</td><td class="o">Sail No</td>
<td class="o">Boat</td>
<td class="o">Owner</td><td class="o">Finish Time</td>
<td class="q">Corrected</td>
<td class="q">Finishing<br/>Place</td>
<td class="q">Points</td>
</tr>
<tr><td class="i">1</td><td>H265047</td><td class="c">Dalliance</td><td>M Whelan</td><td>0:59:49</td>
<td class="n">0:38:31</td><td class="n">1</td><td class="i">1</td></tr>
<tr><td class="i">2</td><td>1655</td><td class="c">Paloma</td><td>P Miley</td><td>1:02:26</td>
<td class="n">0:41:53</td><td class="n">2</td><td class="i">2</td></tr>
</table>
</center></body></html>`;

/** An older Sail100 page, shaped like Cork Week 2004's: no classes, no
 *  `<h1>` — the heading is bold text in a layout table — and discards shaded
 *  grey. */
const OLDER_STANDINGS = `<HTML><BODY BGCOLOR="#FFFFFF"><Font Face=helvetica,arial>
<Table border="0" Width="100%"><TR><TD Align="center"><Table border="0">
<TR><TD Align="center"><Font Size="+1"><B>
Cork Week IRC1</B></Font></TD></TR>
<TR><TD Align="center"><Font Size="+1"><B>
Provisional Results</B></Font></TD></TR>
</Table></TD></TR></Table>
<BR><center>
<Table border="1">
<TR>
<TD ALIGN="right" BGCOLOR="#CCFFFF">Series Place</TD><TD>Sail No</TD>
<TD BGCOLOR="#CCFFFF">Boat</TD><TD>Owner</TD>
<TD ALIGN="right" BGCOLOR="#CCFFFF">Series Points</TD>
<TD ALIGN="right"><A HREF="cwirc101.html">Race 1</A></TD>
<TD ALIGN="right"><A HREF="cwirc102.html">Race 2</A></TD>
</TR>
<TR><TD ALIGN="right" BGCOLOR="#CCFFFF">1</TD><TD>IRL9779</TD><TD BGCOLOR="#CCFFFF">Wow</TD><TD>George Sisk</TD>
<TD ALIGN="right" BGCOLOR="#CCFFFF"> 7 </TD><TD BGCOLOR="#999999" ALIGN="right"> 9 </TD><TD ALIGN="right"> 7 </TD></TR>
<TR><TD ALIGN="right" BGCOLOR="#CCFFFF">2</TD><TD>GBR1776L</TD><TD BGCOLOR="#CCFFFF">Smile</TD><TD>Mr &amp; Mrs Smith</TD>
<TD ALIGN="right" BGCOLOR="#CCFFFF"> 5.6 </TD><TD ALIGN="right"> APS5.6 </TD><TD BGCOLOR="#999999" ALIGN="right"> 13 </TD></TR>
</Table></center></BODY></HTML>`;

describe('sail100 parser', () => {
  test('an older page: its bold heading is its title, and a grey cell is a discard', () => {
    const { title, summaries, raceLinks } = parseSail100Html(OLDER_STANDINGS);
    expect(title).toBe('Cork Week IRC1');
    expect(summaries).toHaveLength(1);
    const [section] = summaries;
    expect(section.leadColumns.map((c) => c.label)).toEqual(['Sail No', 'Boat', 'Owner', 'Series Points']);
    expect(raceLinks[0]).toEqual(['cwirc101.html', 'cwirc102.html']);
    expect(section.rows.map((r) => r.raceCells)).toEqual([
      [{ text: '9', discard: true, podium: 0 }, { text: '7', discard: false, podium: 0 }],
      [{ text: 'APS5.6', discard: false, podium: 0 }, { text: '13', discard: true, podium: 0 }],
    ]);
  });

  test('a linked header after Series Points is a race column, whatever it reads', () => {
    const { title, summaries, raceLinks } = parseSail100Html(STANDINGS);
    expect(title).toBe('Saturday series 2023');
    const [section] = summaries;
    expect(section.leadColumns.map((c) => c.key)).toEqual([
      'sail-no', 'boat', 'type-of-boat', 'owner', 'handicap', 'series-points',
    ]);
    expect(section.raceHeaders).toEqual(['S2 270523', 'S3 100623']);
    expect(raceLinks[0]).toEqual(['saturdayseries202302.html', 'saturdayseries202305.html']);
    expect(section.rows[0].raceCells).toEqual([
      { text: '1', discard: false, podium: 0 },
      { text: '2', discard: true, podium: 0 },
    ]);
  });

  test('a race page inside a layout table reads its results, and its last heading is the race', () => {
    // Royal Cork's: the whole page sits in one table, the logos and headings
    // in a single row of another inside it.
    const race = parseSail100RaceHtml(`<body><center>
<table border="0"><tr><th class="m"><center>
<table border="0" width="100%"><tr>
<th class="l"><img src="UK.jpg"/></th>
<th class="m"><h1>UK Halsey</h1><h1>May League ECHO 2</h1><h1>Race 1</h1>
<h2>Start: Fri 2 May 14 19:05:00</h2></th>
<th class="n"><img src="RCYC.jpg"/></th>
</tr></table></center></th></tr><tr><td class="m"><center>
<table border="1">
<tr><td class="q">Points</td><td class="o">Sail No</td><td class="o">Boat</td><td class="q">Corrected</td></tr>
<tr><td class="i">1</td><td>GBR9896</td><td class="c">Magnet</td><td class="n">1:03:58</td></tr>
</table></center></td></tr></table></center></body>`)!;
    expect(race.title).toBe('Race 1');
    expect(race.caption).toBe('Start: Fri 2 May 14 19:05:00');
    expect(race.columns.map((c) => c.label)).toEqual(['Points', 'Sail No', 'Boat', 'Corrected']);
    expect(race.rows).toEqual([['1', 'GBR9896', 'Magnet', '1:03:58']]);
  });

  test('an older race page reads its headings from bold lines and its start from plain text', () => {
    // Cork Week 2004's: no <h1> or <h2>, the headings stacked a cell to a row.
    const race = parseSail100RaceHtml(`<BODY><Table border="0" Width="100%"><TR>
<TD><IMG SRC="2004 logo.jpg"></TD>
<TD Align="center"><Table border="0">
<TR><TD Align="center"><Font Size="+1"><B>Cork Week IRC1</B></Font></TD></TR>
<TR><TD Align="center"><Font Size="+1"><B>Race 1</B></Font></TD></TR>
<TR><TD Align="center">Start: Mon 12 Jul 04 11:10:00</TD></TR>
<TR><TD Align="center">Provisional Result</TD></TR>
</Table></TD></TR></Table>
<Center><Table border="1">
<TR><TD>Points</TD><TD>Sail No</TD><TD>Boat</TD><TD>Elapsed</TD></TR>
<TR><TD>1</TD><TD>GBR2027</TD><TD><B>Eclipse</B></TD><TD>4:25:15</TD></TR>
</Table></Center></BODY>`)!;
    expect(race.title).toBe('Race 1');
    expect(race.caption).toBe('Start: Mon 12 Jul 04 11:10:00');
    expect(race.rows).toEqual([['1', 'GBR2027', 'Eclipse', '4:25:15']]);
  });

  test('a race page reads as a race table, keeping its repeated column', () => {
    const race = parseSail100RaceHtml(RACE)!;
    expect(race.title).toBe('S2 270523');
    expect(race.caption).toBe('Start: Sat 27 May 23 16:35:00');
    expect(race.columns.map((c) => c.label)).toEqual([
      'Points', 'Sail No', 'Boat', 'Owner', 'Finish Time', 'Corrected', 'Finishing Place', 'Points',
    ]);
    expect(race.columns.map((c) => c.key).at(-1)).toBe('points-2');
    expect(race.rows[1]).toEqual(['2', '1655', 'Paloma', 'P Miley', '1:02:26', '0:41:53', '2', '2']);
  });

  test('owner names stand in for the missing helm, when asked', () => {
    const { summaries } = parseSail100Html(STANDINGS);
    const fleet = { name: 'Saturday Series', subPath: 'saturday', summary: summaries[0] };
    const base = { seriesId: '11111111-2222-4333-8444-555555555555', name: 'Cruisers 2023', publishedSlug: '2023' };

    const named = buildSailwaveArchiveDoc({ ...base, ownerNames: true, fleets: [fleet] });
    expect(named.competitors[0]).toMatchObject({
      name: 'M Whelan', owner: 'M Whelan', boatName: 'Dalliance', boatClass: 'Sigma 33', sailNumber: 'H265047',
    });

    const unnamed = buildSailwaveArchiveDoc({ ...base, fleets: [fleet] });
    expect(unnamed.competitors[0].name).toBe('Unknown Competitor (H265047)');
  });

  test("a race published on its own links its lines to the owners it names", () => {
    const race = parseSail100RaceHtml(RACE)!;
    const built = summaryFromRaceTables([race], { ownerNames: true })!;
    const doc = buildSailwaveArchiveDoc({
      seriesId: '11111111-2222-4333-8444-666666666666',
      name: 'Single Handed Race 2023',
      publishedSlug: '2023',
      ownerNames: true,
      fleets: [{
        name: 'Overall',
        subPath: 'single-handed',
        summary: built.summary,
        races: [race],
        detail: 'races',
        rowsFromRaceTables: true,
      }],
    });
    expect(doc.competitors.map((c) => c.name)).toEqual(['M Whelan', 'P Miley']);
    const lines = doc.fleets[0].results.raceTables![0].rows;
    expect(lines.map((l) => l.competitorId)).toEqual(doc.competitors.map((c) => c.id));
  });
});
