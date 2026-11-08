/**
 * Custom fields and a series' own results columns: the `.sailscoring` file
 * (v75) carries both, and the competitors' values, sparsely — absent is no
 * custom fields and automatic columns — and both import paths restore them.
 * The public export carries a custom field only while it is published as a
 * column.
 */
import { describe, it, expect } from 'vitest';
import { buildSeriesFile, openSeriesFromFile, FORMAT_VERSION, type SeriesFileRepos } from '@/lib/series-file';
import { buildPublicExportFromSnapshot, importPublicExport, type ImportRepos } from '@/lib/public-export';
import { customFieldsSchema, resultsColumnsSchema } from '@/lib/validation/series';
import type { SeriesSnapshot } from '@/lib/series-snapshot';
import type { Competitor, CustomField, Fleet, Race, RaceStart, ResultsColumn, Series, SubSeries } from '@/lib/types';

const RIG: CustomField = { id: 'f-rig', label: 'Rig' };
const SPONSOR: CustomField = { id: 'f-sponsor', label: 'Sponsor' };
const COLUMNS: ResultsColumn[] = [
  { key: 'rank' },
  { key: 'sailNumber', title: 'Bib Number' },
  { key: 'primary' },
  { key: 'field:f-rig', tables: ['standings', 'entries'] },
  { key: 'total', hidden: true },
];

const series: Series = {
  id: 's1', name: 'WASZP Games', venue: 'Dún Laoghaire', startDate: '2026-11-01', endDate: '',
  venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '', createdAt: 0, lastSavedAt: null,
  lastModifiedAt: 0, scoringMode: 'scratch', discardThresholds: [], dnfScoring: 'seriesEntries',
  ftpHost: '', ftpPath: '', ftpPaths: {}, includeJsonExport: true, enabledCompetitorFields: [],
  primaryPersonLabel: 'helm', subdivisionAxes: [],
  customFields: [RIG, SPONSOR],
  resultsColumns: COLUMNS,
};

const fleet: Fleet = { id: 'fl-1', seriesId: 's1', name: 'WASZP', displayOrder: 0, scoringSystem: 'scratch' };

const competitors: Competitor[] = [
  { id: 'c1', seriesId: 's1', fleetIds: ['fl-1'], sailNumber: '101', names: ['A. Sailor'], clubs: [], gender: '', age: null, createdAt: 0, customFields: { 'f-rig': '8.2', 'f-sponsor': 'Acme' } },
  { id: 'c2', seriesId: 's1', fleetIds: ['fl-1'], sailNumber: '102', names: ['B. Sailor'], clubs: [], gender: '', age: null, createdAt: 0 },
];

const snapshot: SeriesSnapshot = {
  series,
  competitors,
  fleets: [fleet],
  races: [{ id: 'r1', seriesId: 's1', raceNumber: 1, name: null, date: '2026-11-01', createdAt: 0 }],
  subSeries: [],
  finishes: [],
  raceStarts: [],
  ratingOverrides: [],
};

function makeFileRepos(read?: SeriesSnapshot) {
  let saved: Series | undefined;
  let savedCompetitors: Competitor[] = [];
  const repos = {
    seriesRepo: {
      get: async (id: string) => (read && id === read.series.id ? read.series : undefined),
      save: async (s: Series) => { saved = s; return s; },
    },
    fleetRepo: { listBySeries: async () => read?.fleets ?? [], saveMany: async () => {} },
    competitorRepo: { listBySeries: async () => read?.competitors ?? [], saveMany: async (cs: Competitor[]) => { savedCompetitors = cs; } },
    raceRepo: { listBySeries: async () => read?.races ?? [], save: async (r: Race) => r },
    subSeriesRepo: { listBySeries: async () => read?.subSeries ?? [], saveMany: async (_: SubSeries[]) => {} },
    finishRepo: { listBySeries: async () => read?.finishes ?? [], saveMany: async () => {} },
    raceStartRepo: { listBySeries: async () => read?.raceStarts ?? [], saveMany: async (_: RaceStart[]) => {} },
    raceRatingOverrideRepo: { listBySeries: async () => [], listByRaces: async () => [], saveMany: async () => {} },
    listSeriesNames: async () => [],
    deleteSeriesChildren: async () => {},
  } as unknown as SeriesFileRepos;
  return { repos, saved: () => saved, savedCompetitors: () => savedCompetitors };
}

describe('custom fields and results columns in the .sailscoring file', () => {
  it('writes them, with the competitors’ values, and restores them on import', async () => {
    const file = await buildSeriesFile('s1', makeFileRepos(snapshot).repos);
    expect(file.formatVersion).toBe(FORMAT_VERSION);
    expect(FORMAT_VERSION).toBe(79);
    expect(file.series.customFields).toEqual([RIG, SPONSOR]);
    expect(file.series.resultsColumns).toEqual(COLUMNS);
    expect(file.competitors.find((c) => c.sailNumber === '101')?.customFields).toEqual({ 'f-rig': '8.2', 'f-sponsor': 'Acme' });
    expect(file.competitors.find((c) => c.sailNumber === '102')).not.toHaveProperty('customFields');

    const target = makeFileRepos();
    await openSeriesFromFile(file, target.repos);
    expect(target.saved()?.customFields).toEqual([RIG, SPONSOR]);
    expect(target.saved()?.resultsColumns).toEqual(COLUMNS);
    expect(target.savedCompetitors().find((c) => c.sailNumber === '101')?.customFields).toEqual({ 'f-rig': '8.2', 'f-sponsor': 'Acme' });
  });

  it('writes no keys for a series with no custom fields and automatic columns', async () => {
    const plain = { ...snapshot, series: { ...series, customFields: undefined, resultsColumns: undefined } };
    const file = await buildSeriesFile('s1', makeFileRepos(plain).repos);
    expect(file.series).not.toHaveProperty('customFields');
    expect(file.series).not.toHaveProperty('resultsColumns');
  });
});

describe('custom fields and results columns in the public JSON export', () => {
  it('carries only the custom fields that are columns, and restores them on import', async () => {
    const data = buildPublicExportFromSnapshot(snapshot)!;
    expect(data.series.customFields).toEqual([RIG]);
    expect(data.series.resultsColumns).toEqual(COLUMNS);
    expect(data.competitors.find((c) => c.sailNumber === '101')?.customFields).toEqual({ 'f-rig': '8.2' });

    let saved: Series | undefined;
    const repos = {
      seriesRepo: { get: async () => undefined, save: async (s: Series) => { saved = s; return s; } },
      fleetRepo: { listBySeries: async () => [], save: async (f: Fleet) => f, saveMany: async () => {} },
      competitorRepo: { listBySeries: async () => [], save: async (c: Competitor) => c, saveMany: async () => {} },
      raceRepo: { listBySeries: async () => [], save: async (r: Race) => r },
      subSeriesRepo: { listBySeries: async () => [], saveMany: async () => {} },
      raceStartRepo: { listBySeries: async () => [], saveMany: async () => {} },
      finishRepo: { listByRace: async () => [], saveMany: async () => {} },
      ratingOverrideRepo: { listBySeries: async () => [], saveMany: async () => {} },
      listSeriesNames: async () => [],
    } as unknown as ImportRepos;
    await importPublicExport(data, repos);
    expect(saved?.customFields).toEqual([RIG]);
    expect(saved?.resultsColumns).toEqual(COLUMNS);
  });

  it('carries every custom field under automatic columns, which show them all', () => {
    const data = buildPublicExportFromSnapshot({ ...snapshot, series: { ...series, resultsColumns: undefined } })!;
    expect(data.series.customFields).toEqual([RIG, SPONSOR]);
    expect(data.series).not.toHaveProperty('resultsColumns');
  });
});

describe('the results-columns and custom-fields schemas', () => {
  const columnProblems = (columns: ResultsColumn[]) => {
    const r = resultsColumnsSchema.safeParse(columns);
    return r.success ? [] : r.error.issues.map((i) => i.message);
  };
  const fieldProblems = (fields: CustomField[]) => {
    const r = customFieldsSchema.safeParse(fields);
    return r.success ? [] : r.error.issues.map((i) => i.message);
  };

  it('accepts a well-formed list', () => {
    expect(columnProblems(COLUMNS)).toEqual([]);
  });

  it('refuses a list without the sail number or primary name', () => {
    expect(columnProblems([{ key: 'primary' }])).toEqual(['The sail number column can’t be removed.']);
  });

  it('refuses a title over two lines or 40 characters', () => {
    expect(columnProblems([...COLUMNS, { key: 'club', title: 'a\nb\nc' }])).toEqual(['A title can have at most two lines.']);
    expect(columnProblems([...COLUMNS, { key: 'club', title: 'x'.repeat(41) }])).toEqual(['Keep the title to 40 characters or fewer.']);
  });

  it('refuses hiding the Points column, and a scoring column limited to some tables', () => {
    expect(columnProblems([...COLUMNS, { key: 'points', hidden: true }])).toEqual(['The Points column can’t be hidden.']);
    expect(columnProblems([...COLUMNS, { key: 'nett', tables: ['standings'] }])).toEqual(['The scoring column nett can only be hidden or retitled.']);
  });

  it('refuses a competitor column on no table, and a key it doesn’t know', () => {
    expect(columnProblems([...COLUMNS, { key: 'club', tables: [] }])).toEqual(['Tick at least one table, or remove the column.']);
    expect(columnProblems([...COLUMNS, { key: 'shoeSize' }])).toEqual(['There is no column shoeSize.']);
  });

  it('refuses custom fields named alike, or after a built-in field', () => {
    expect(fieldProblems([RIG, { id: 'x', label: 'rig' }])).toEqual(['This series already has a field called rig.']);
    expect(fieldProblems([{ id: 'x', label: 'Class' }])).toEqual(['Class is already a field. To publish it under another title, retitle its column.']);
    expect(fieldProblems([{ id: 'x', label: ' ' }])).toEqual(['Name is required.']);
  });
});
