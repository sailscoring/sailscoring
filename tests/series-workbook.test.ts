/**
 * The series as a spreadsheet: every input sheet carries what the series
 * holds, and the scored sheets carry what the published pages are built
 * from — corrected times, points, discards — whatever the series chose to
 * show on its pages.
 */
import { describe, it, expect } from 'vitest';
import readXlsxFile from 'read-excel-file/node';

import { buildSeriesWorkbook, type Cell, type WorkbookSheet } from '@/lib/series-workbook';
import { workbookToBlob } from '@/lib/series-workbook-xlsx';
import type { ExportRepos } from '@/lib/public-export';
import type { Competitor, Finish, Fleet, Race, RaceStart, Series, SubSeries } from '@/lib/types';

const SERIES: Series = {
  id: 's1', name: 'Autumn League', venue: 'Howth', startDate: '2026-09-05', endDate: '2026-09-12',
  venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '', createdAt: 0, lastSavedAt: null, lastModifiedAt: 0,
  scoringMode: 'handicap', discardThresholds: [{ minRaces: 2, discardCount: 1 }], dnfScoring: 'seriesEntries',
  ftpHost: '', ftpPath: '', ftpPaths: {}, includeJsonExport: true, enabledCompetitorFields: ['boatName'],
  primaryPersonLabel: 'helm', subdivisionAxes: [{ id: 'div', label: 'Division' }],
  customFields: [{ id: 'rig', label: 'Rig' }],
  // Publishing choices the export must see past.
  resultsColumns: [{ table: 'races', key: 'sailNumber' } as never],
  publishRatingCalculations: false,
};

const FLEETS: Fleet[] = [{ id: 'irc', seriesId: 's1', name: 'IRC 1', displayOrder: 0, scoringSystem: 'irc' }];

const boat = (sail: string, tcc: number, extra: Partial<Competitor> = {}): Competitor => ({
  id: `c${sail}`, seriesId: 's1', fleetIds: ['irc'], sailNumber: sail, boatName: `Boat ${sail}`,
  names: [`Helm ${sail}`], clubs: ['HYC'], gender: '', age: null, createdAt: 0, ircTcc: tcc, ...extra,
});
const COMPETITORS = [
  boat('IRL 0101', 1.0, { subdivisions: { div: 'Gold' }, customFields: { rig: 'Fractional' } }),
  boat('IRL 2', 0.95),
  boat('IRL 3', 0.9),
];

const RACES: Race[] = [
  { id: 'r1', seriesId: 's1', raceNumber: 1, name: null, date: '2026-09-05', createdAt: 0 },
  { id: 'r2', seriesId: 's1', raceNumber: 2, name: 'Lambay', date: '2026-09-12', createdAt: 0, conditions: { windSpeedMin: 8, windSpeedMax: 12, windDirection: 'SW' } },
];
const STARTS: RaceStart[] = [
  { id: 'st1', raceId: 'r1', fleetIds: ['irc'], startTime: '10:00:00' },
  { id: 'st2', raceId: 'r2', fleetIds: ['irc'], startTime: '11:00:00' },
];

function finish(raceId: string, competitorId: string | null, opts: { order?: number; time?: string; code?: string; unknown?: string }): Finish {
  return {
    id: `${raceId}-${competitorId ?? opts.unknown}`, raceId, competitorId, sortOrder: opts.order ?? null, tiedWithPrevious: false,
    ...(opts.time ? { finishTime: opts.time } : {}), ...(opts.unknown ? { unknownSailNumber: opts.unknown } : {}),
    resultCode: opts.code ?? null, startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null,
    redressExcludeRaceIds: null, redressIncludeRaceIds: null, redressIncludeAllLater: false, redressPoints: null,
  };
}

// R1: 0101 sails 1:00:00 (CT 3600), 2 sails 1:02:00 (CT 3534), 3 sails 1:05:00 (CT 3510) — 3, 2, 1.
// R2: 0101 wins, 2 second, 3 DNF; an unknown boat crosses too.
const FINISHES: Finish[] = [
  finish('r1', 'cIRL 0101', { order: 0, time: '11:00:00' }),
  finish('r1', 'cIRL 2', { order: 1, time: '11:02:00' }),
  finish('r1', 'cIRL 3', { order: 2, time: '11:05:00' }),
  finish('r2', 'cIRL 0101', { order: 0, time: '12:00:00' }),
  finish('r2', 'cIRL 2', { order: 1, time: '12:10:00' }),
  finish('r2', null, { order: 2, time: '12:11:00', unknown: '999' }),
  finish('r2', 'cIRL 3', { code: 'DNF' }),
];

function reposFor(opts: { subSeries?: SubSeries[] } = {}): ExportRepos {
  return {
    seriesRepo: { get: async (id: string) => (id === 's1' ? SERIES : undefined) },
    competitorRepo: { listBySeries: async () => COMPETITORS },
    raceRepo: { listBySeries: async () => RACES },
    fleetRepo: { listBySeries: async () => FLEETS },
    subSeriesRepo: { listBySeries: async () => opts.subSeries ?? [] },
    finishRepo: { listBySeries: async () => FINISHES },
    raceStartRepo: { listBySeries: async () => STARTS },
    raceRatingOverrideRepo: { listBySeries: async () => [] },
  } as unknown as ExportRepos;
}

function sheet(sheets: WorkbookSheet[], name: string): WorkbookSheet {
  const s = sheets.find((x) => x.name === name);
  if (!s) throw new Error(`no ${name} sheet`);
  return s;
}

/** The sheet's rows as objects keyed by header. */
function records(s: WorkbookSheet): Array<Record<string, Cell>> {
  return s.rows.map((row) => Object.fromEntries(s.columns.map((c, i) => [c.header, row[i] ?? null])));
}

const value = (c: Cell) => c?.value ?? null;

describe('buildSeriesWorkbook', () => {
  it('lays the series out as About, Fleets, Competitors, Races, Finishes, Results and Standings', async () => {
    const wb = (await buildSeriesWorkbook(reposFor(), 's1', new Date('2026-09-13T09:00:00Z')))!;
    expect(wb.fileName).toBe('autumn-league.xlsx');
    expect(wb.sheets.map((s) => s.name)).toEqual(['About', 'Fleets', 'Competitors', 'Races', 'Finishes', 'Results', 'Standings']);
    const about = sheet(wb.sheets, 'About').rows.map((r) => r.map(value).join(' | '));
    expect(about).toContain('Exported | 2026-09-13 09:00 UTC');
    expect(about.some((r) => r.startsWith('Discards |'))).toBe(true);
  });

  it('carries every competitor field, sail numbers as text', async () => {
    const wb = (await buildSeriesWorkbook(reposFor(), 's1'))!;
    const first = records(sheet(wb.sheets, 'Competitors')).find((r) => value(r['Sail number']) === 'IRL 0101');
    expect(value(first!['Fleets'])).toBe('IRC 1');
    expect(value(first!['Division'])).toBe('Gold');
    expect(value(first!['Rig'])).toBe('Fractional');
    expect(value(first!['IRC TCC'])).toBe(1);
    expect(value(first!['Competitor ID'])).toBe('cIRL 0101');
    // A field nobody has a value in is left out.
    expect(sheet(wb.sheets, 'Competitors').columns.map((c) => c.header)).not.toContain('PY');
  });

  it('lists the finish sheets as entered, unknown sail numbers included', async () => {
    const wb = (await buildSeriesWorkbook(reposFor(), 's1'))!;
    const rows = records(sheet(wb.sheets, 'Finishes')).filter((r) => value(r['Race']) === 2);
    expect(rows.map((r) => value(r['Sail number']))).toEqual(['IRL 0101', 'IRL 2', '999', 'IRL 3']);
    expect(value(rows[2]!['Unknown sail number'])).toBe(true);
    expect(value(rows[3]!['Code'])).toBe('DNF');
    expect(rows[0]!['Finish time']).toEqual({ value: 12 * 3600, format: 'time' });
  });

  it('scores every race as the pages do: rating, elapsed, corrected, points, discards', async () => {
    const wb = (await buildSeriesWorkbook(reposFor(), 's1'))!;
    const results = records(sheet(wb.sheets, 'Results'));
    const r1 = results.filter((r) => value(r['Race']) === 1);
    const three = r1.find((r) => value(r['Sail number']) === 'IRL 3')!;
    expect(value(three['Place'])).toBe(1);
    expect(value(three['Rating applied'])).toBe(0.9);
    expect(three['Elapsed']).toEqual({ value: 3900, format: 'duration' });
    expect(value(three['Corrected (s)'])).toBe(3510);
    const first = r1.find((r) => value(r['Sail number']) === 'IRL 0101')!;
    expect(value(first['Place'])).toBe(3);
    expect(value(first['Behind winner'])).toBe(90);
    expect(value(first['Time to win (s)'])).toBe(90);

    const dnf = results.find((r) => value(r['Race']) === 2 && value(r['Sail number']) === 'IRL 3')!;
    expect(value(dnf['Code'])).toBe('DNF');
    expect(value(dnf['Points'])).toBe(4);
    expect(value(dnf['Discarded'])).toBe(true);
    expect(value(dnf['Race name'])).toBe('Lambay');
  });

  it('puts the standings in one wide table, discards greyed, codes beside the points', async () => {
    const wb = (await buildSeriesWorkbook(reposFor(), 's1'))!;
    const standings = sheet(wb.sheets, 'Standings');
    expect(standings.columns.map((c) => c.header)).toEqual(expect.arrayContaining(['Rank', 'Total', 'Net', 'R1', 'R2 Lambay', 'R2 code']));
    const three = records(standings).find((r) => value(r['Sail number']) === 'IRL 3')!;
    expect(three['R2 Lambay']).toEqual({ value: 4, muted: true });
    expect(value(three['R2 code'])).toBe('DNF');
    expect(value(three['Total'])).toBe(5);
    expect(value(three['Net'])).toBe(1);
  });

  it('tags results and standings with their sub-series', async () => {
    const wb = (await buildSeriesWorkbook(reposFor({
      subSeries: [{ id: 'ss', seriesId: 's1', name: 'Saturdays', displayOrder: 0, raceIds: ['r1', 'r2'] }],
    }), 's1'))!;
    const results = records(sheet(wb.sheets, 'Results'));
    expect(new Set(results.map((r) => value(r['Sub-series'])))).toEqual(new Set(['Saturdays']));
    // The series race number, not the block's own count.
    expect(new Set(results.map((r) => value(r['Race'])))).toEqual(new Set([1, 2]));
  });

  it('writes an .xlsx that reads back with typed cells', async () => {
    const wb = (await buildSeriesWorkbook(reposFor(), 's1'))!;
    const blob = await workbookToBlob(wb);
    const sheets = await readXlsxFile(Buffer.from(await blob.arrayBuffer()));
    expect(sheets.map((s) => s.sheet)).toEqual(['About', 'Fleets', 'Competitors', 'Races', 'Finishes', 'Results', 'Standings']);
    const results = sheets.find((s) => s.sheet === 'Results')!.data;
    const header = results[0] as string[];
    const row = results.find((r) => r[header.indexOf('Sail number')] === 'IRL 3' && r[header.indexOf('Race')] === 1)!;
    expect(row[header.indexOf('Points')]).toBe(1);
    expect(row[header.indexOf('Corrected (s)')]).toBe(3510);
    // A duration is a spreadsheet time — a fraction of a day, which a reader
    // hands back as a time on Excel's day zero.
    expect(row[header.indexOf('Elapsed')]).toEqual(new Date('1899-12-30T01:05:00Z'));
  });
});
