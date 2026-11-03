import { describe, it, expect } from 'vitest';
import { buildPublicExportFromSnapshot, importPublicExport, type ImportRepos } from '@/lib/public-export';
import type { SeriesSnapshot } from '@/lib/series-snapshot';
import type { Competitor, Fleet, Race, Series } from '@/lib/types';

function makeSeries(id: string): Series {
  return {
    id,
    name: 'Frostbites',
    venue: 'HYC',
    startDate: '2026-11-01',
    endDate: '2027-03-31',
    venueLogoUrl: '',
    eventLogoUrl: '',
    venueUrl: '',
    eventUrl: '',
    createdAt: 0,
    lastSavedAt: null,
    lastModifiedAt: 0,
    scoringMode: 'scratch',
    discardThresholds: [],
    dnfScoring: 'seriesEntries',
    ftpHost: '',
    ftpPath: '',
    ftpPaths: {},
    includeJsonExport: true,
    enabledCompetitorFields: [],
    primaryPersonLabel: 'helm',
    subdivisionAxes: [],
  };
}

const fleet: Fleet = { id: 'fl-1', seriesId: 's1', name: 'Cruisers YTC', displayOrder: 0, scoringSystem: 'ytc' };

function makeCompetitor(id: string, sail: string, ytcNumber?: number): Competitor {
  return {
    id, seriesId: 's1', fleetIds: ['fl-1'], sailNumber: sail, names: [`Helm ${sail}`],
    ...(ytcNumber != null ? { ytcNumber } : {}),
    clubs: [], gender: '', age: null, createdAt: 0,
  };
}

function makeRace(id: string, n: number): Race {
  return { id, seriesId: 's1', raceNumber: n, name: null, date: '2026-11-01', createdAt: 0 };
}

const snapshot: SeriesSnapshot = {
  series: makeSeries('s1'),
  competitors: [
    makeCompetitor('c1', 'IRL3062', 941),
    makeCompetitor('c2', '1558'),
  ],
  fleets: [fleet],
  races: [makeRace('r1', 1)],
  subSeries: [],
  finishes: [],
  raceStarts: [],
  ratingOverrides: [],
};

function makeRecordingRepos() {
  const savedCompetitors: Competitor[] = [];
  const repos = {
    seriesRepo: { get: async () => undefined, save: async (s: Series) => s },
    fleetRepo: { listBySeries: async () => [], save: async (f: Fleet) => f, saveMany: async () => {} },
    competitorRepo: {
      listBySeries: async () => [],
      save: async (c: Competitor) => { savedCompetitors.push(c); return c; },
      saveMany: async (list: Competitor[]) => { savedCompetitors.push(...list); },
    },
    raceRepo: { listBySeries: async () => [], save: async (r: Race) => r },
    subSeriesRepo: { listBySeries: async () => [], saveMany: async () => {} },
    raceStartRepo: { listBySeries: async () => [], saveMany: async () => {} },
    finishRepo: { listByRace: async () => [], saveMany: async () => {} },
    ratingOverrideRepo: { listBySeries: async () => [], saveMany: async () => {} },
    listSeriesNames: async () => [],
  } as unknown as ImportRepos;
  return { repos, savedCompetitors };
}

describe('public JSON export — YTC', () => {
  it('exports each boat\'s YTC number and round-trips it through import', async () => {
    const data = buildPublicExportFromSnapshot(snapshot);
    expect(data).not.toBeNull();
    expect(data!.fleets[0].scoringSystem).toBe('ytc');
    expect(data!.competitors.find((c) => c.sailNumber === 'IRL3062')?.ytcNumber).toBe(941);
    expect(data!.competitors.find((c) => c.sailNumber === '1558')).not.toHaveProperty('ytcNumber');

    const { repos, savedCompetitors } = makeRecordingRepos();
    await importPublicExport(data!, repos);
    expect(savedCompetitors.find((c) => c.sailNumber === 'IRL3062')?.ytcNumber).toBe(941);
    expect(savedCompetitors.find((c) => c.sailNumber === '1558')?.ytcNumber).toBeUndefined();
  });
});
