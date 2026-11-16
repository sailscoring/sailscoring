/**
 * A series' sponsors and trophy donors: the `.sailscoring` file (v83) and the
 * public export carry them sparsely, both import paths restore them, and the
 * stored-shape schema refuses an unnamed entry.
 */
import { describe, it, expect } from 'vitest';
import { buildSeriesFile, openSeriesFromFile, FORMAT_VERSION, type SeriesFileRepos } from '@/lib/series-file';
import { buildPublicExportFromSnapshot, importPublicExport, type ImportRepos } from '@/lib/public-export';
import { seriesSponsorsSchema } from '@/lib/validation/series';
import type { SeriesSnapshot } from '@/lib/series-snapshot';
import type { Competitor, Fleet, Race, RaceStart, Series, SeriesSponsor, SubSeries } from '@/lib/types';

const SPONSORS: SeriesSponsor[] = [
  { name: 'O\'Leary Life', kind: 'sponsor', logoUrl: '/logos/abc', url: 'https://olearylife.ie' },
  { name: 'The Blue Haven Group', kind: 'sponsor' },
  { name: 'The Draper Family', kind: 'donor' },
];

const series: Series = {
  id: 's1', name: 'Sovereign\'s Cup', venue: 'Kinsale', startDate: '2026-06-24', endDate: '',
  venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '', createdAt: 0, lastSavedAt: null,
  lastModifiedAt: 0, scoringMode: 'scratch', discardThresholds: [], dnfScoring: 'seriesEntries',
  ftpHost: '', ftpPath: '', ftpPaths: {}, includeJsonExport: true, enabledCompetitorFields: [],
  primaryPersonLabel: 'helm', subdivisionAxes: [],
  sponsors: SPONSORS,
};

const fleet: Fleet = { id: 'fl-1', seriesId: 's1', name: 'Class 1', displayOrder: 0, scoringSystem: 'scratch' };

const snapshot: SeriesSnapshot = {
  series,
  competitors: [
    { id: 'c1', seriesId: 's1', fleetIds: ['fl-1'], sailNumber: '101', names: ['A. Sailor'], clubs: [], gender: '', age: null, createdAt: 0 },
  ],
  fleets: [fleet],
  races: [{ id: 'r1', seriesId: 's1', raceNumber: 1, name: null, date: '2026-06-24', createdAt: 0 }],
  subSeries: [],
  finishes: [],
  raceStarts: [],
  ratingOverrides: [],
};

function makeFileRepos(read?: SeriesSnapshot) {
  let saved: Series | undefined;
  const repos = {
    seriesRepo: {
      get: async (id: string) => (read && id === read.series.id ? read.series : undefined),
      save: async (s: Series) => { saved = s; return s; },
    },
    fleetRepo: { listBySeries: async () => read?.fleets ?? [], saveMany: async () => {} },
    competitorRepo: { listBySeries: async () => read?.competitors ?? [], saveMany: async (_: Competitor[]) => {} },
    raceRepo: { listBySeries: async () => read?.races ?? [], save: async (r: Race) => r },
    subSeriesRepo: { listBySeries: async () => read?.subSeries ?? [], saveMany: async (_: SubSeries[]) => {} },
    finishRepo: { listBySeries: async () => read?.finishes ?? [], saveMany: async () => {} },
    raceStartRepo: { listBySeries: async () => read?.raceStarts ?? [], saveMany: async (_: RaceStart[]) => {} },
    raceRatingOverrideRepo: { listBySeries: async () => [], listByRaces: async () => [], saveMany: async () => {} },
    listSeriesNames: async () => [],
    deleteSeriesChildren: async () => {},
  } as unknown as SeriesFileRepos;
  return { repos, saved: () => saved };
}

describe('sponsors in the .sailscoring file', () => {
  it('writes them in order and restores them on import', async () => {
    const file = await buildSeriesFile('s1', makeFileRepos(snapshot).repos);
    expect(FORMAT_VERSION).toBe(83);
    expect(file.series.sponsors).toEqual(SPONSORS);

    const target = makeFileRepos();
    await openSeriesFromFile(file, target.repos);
    expect(target.saved()?.sponsors).toEqual(SPONSORS);
  });

  it('writes no key for a series with none', async () => {
    const plain = { ...snapshot, series: { ...series, sponsors: [] } };
    const file = await buildSeriesFile('s1', makeFileRepos(plain).repos);
    expect(file.series).not.toHaveProperty('sponsors');
  });
});

describe('sponsors in the public JSON export', () => {
  it('carries them and restores them on import', async () => {
    const data = buildPublicExportFromSnapshot(snapshot)!;
    expect(data.series.sponsors).toEqual(SPONSORS);

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
    expect(saved?.sponsors).toEqual(SPONSORS);
  });

  it('leaves the key out for a series with none', () => {
    const data = buildPublicExportFromSnapshot({ ...snapshot, series: { ...series, sponsors: undefined } })!;
    expect(data.series).not.toHaveProperty('sponsors');
  });
});

describe('the sponsors schema', () => {
  it('accepts a well-formed list and refuses an unnamed entry or an unknown kind', () => {
    expect(seriesSponsorsSchema.safeParse(SPONSORS).success).toBe(true);
    expect(seriesSponsorsSchema.safeParse([{ name: ' ', kind: 'sponsor' }]).success).toBe(false);
    expect(seriesSponsorsSchema.safeParse([{ name: 'X', kind: 'patron' }]).success).toBe(false);
  });
});
