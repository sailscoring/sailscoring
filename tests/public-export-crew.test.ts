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
    enabledCompetitorFields: ['crewName'],
    primaryPersonLabel: 'helm',
    subdivisionAxes: [],
  };
}

const fleet: Fleet = { id: 'fl-1', seriesId: 's1', name: 'Default', displayOrder: 0, scoringSystem: 'scratch' };

function makeCompetitor(id: string, sail: string, crewNames?: string[]): Competitor {
  return {
    id, seriesId: 's1', fleetIds: ['fl-1'], sailNumber: sail, names: [`Helm ${sail}`],
    ...(crewNames ? { crewNames } : {}),
    club: '', gender: '', age: null, createdAt: 0,
  };
}

function makeRace(id: string, n: number): Race {
  return { id, seriesId: 's1', raceNumber: n, name: null, date: '2026-11-01', createdAt: 0 };
}

const snapshot: SeriesSnapshot = {
  series: makeSeries('s1'),
  competitors: [
    makeCompetitor('c1', '101', ['Alice Byrne', 'Bob Malone']),
    makeCompetitor('c2', '102'),
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

describe('public JSON export — crew list', () => {
  it('exports crewNames and round-trips them through import', async () => {
    const data = buildPublicExportFromSnapshot(snapshot);
    expect(data).not.toBeNull();
    const exported = data!.competitors.find((c) => c.sailNumber === '101');
    expect(exported?.crewNames).toEqual(['Alice Byrne', 'Bob Malone']);
    expect(exported && 'crewName' in exported && exported.crewName).toBeFalsy();
    expect(data!.competitors.find((c) => c.sailNumber === '102')?.crewNames).toBeUndefined();

    const { repos, savedCompetitors } = makeRecordingRepos();
    await importPublicExport(data!, repos);
    const imported = savedCompetitors.find((c) => c.sailNumber === '101');
    expect(imported?.crewNames).toEqual(['Alice Byrne', 'Bob Malone']);
    expect(savedCompetitors.find((c) => c.sailNumber === '102')?.crewNames).toBeUndefined();
  });

  it('folds a legacy single crewName into crewNames on import', async () => {
    const data = buildPublicExportFromSnapshot(snapshot)!;
    const legacy = {
      ...data,
      competitors: data.competitors.map((c) =>
        c.sailNumber === '101'
          ? { ...c, crewNames: undefined, crewName: 'J. Crew' }
          : c,
      ),
    };
    const { repos, savedCompetitors } = makeRecordingRepos();
    await importPublicExport(legacy, repos);
    expect(savedCompetitors.find((c) => c.sailNumber === '101')?.crewNames).toEqual(['J. Crew']);
  });
});
