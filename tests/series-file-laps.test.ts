/**
 * Lap counts on finishes: the `.sailscoring` file and the public JSON export
 * both carry `finishes[*].laps` sparsely — absent is the full course — and
 * the file's import path restores it. It is a scoring input, so it travels
 * unconditionally.
 */
import { describe, it, expect } from 'vitest';
import {
  buildSeriesFile,
  openSeriesFromFile,
  type SeriesFileRepos,
} from '@/lib/series-file';
import { buildPublicExportFromSnapshot } from '@/lib/public-export';
import type { SeriesSnapshot } from '@/lib/series-snapshot';
import type { Competitor, Finish, Fleet, Race, RaceStart, Series, SubSeries } from '@/lib/types';

const series: Series = {
  id: 's1',
  name: 'Winter Series',
  venue: 'Bray Sailing Club',
  startDate: '2024-11-03',
  endDate: '',
  venueLogoUrl: '',
  eventLogoUrl: '',
  venueUrl: '',
  eventUrl: '',
  createdAt: 0,
  lastSavedAt: null,
  lastModifiedAt: 0,
  scoringMode: 'handicap',
  discardThresholds: [],
  dnfScoring: 'seriesEntries',
  ftpHost: '',
  ftpPath: '',
  ftpPaths: {},
  includeJsonExport: true,
  enabledCompetitorFields: ['club'],
  primaryPersonLabel: 'helm',
  subdivisionAxes: [],
};

const fleet: Fleet = { id: 'fl-1', seriesId: 's1', name: 'Mixed PY', displayOrder: 0, scoringSystem: 'py' };

function makeCompetitor(id: string, sail: string, pyNumber: number): Competitor {
  return { id, seriesId: 's1', fleetIds: ['fl-1'], sailNumber: sail, names: [sail], clubs: [], gender: '', age: null, createdAt: 0, pyNumber };
}

function makeFinish(competitorId: string, sortOrder: number, finishTime: string, laps?: number): Finish {
  return {
    id: `r1-${competitorId}`, raceId: 'r1', competitorId, sortOrder, tiedWithPrevious: false, finishTime,
    ...(laps != null ? { laps } : {}),
    resultCode: null, startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null,
    redressExcludeRaceIds: null, redressIncludeRaceIds: null, redressIncludeAllLater: false, redressPoints: null,
  };
}

const snapshot: SeriesSnapshot = {
  series,
  competitors: [makeCompetitor('c1', '1001', 1100), makeCompetitor('c2', 'H303', 1434)],
  fleets: [fleet],
  races: [{ id: 'r1', seriesId: 's1', raceNumber: 1, name: null, date: '2024-11-03', createdAt: 0 }],
  subSeries: [],
  finishes: [makeFinish('c1', 1, '11:40:10', 2), makeFinish('c2', 2, '11:23:41', 1)],
  raceStarts: [{ id: 'st1', raceId: 'r1', fleetIds: ['fl-1'], startTime: '11:00:00' }],
  ratingOverrides: [],
};

function makeRecordingRepos(read?: SeriesSnapshot) {
  const savedFinishes: Finish[] = [];
  const repos = {
    seriesRepo: { get: async (id: string) => (read && id === read.series.id ? read.series : undefined), save: async (s: Series) => s },
    fleetRepo: { listBySeries: async () => read?.fleets ?? [], saveMany: async () => {} },
    competitorRepo: { listBySeries: async () => read?.competitors ?? [], saveMany: async () => {} },
    raceRepo: { listBySeries: async () => read?.races ?? [], save: async (r: Race) => r },
    subSeriesRepo: { listBySeries: async () => read?.subSeries ?? [], saveMany: async (_: SubSeries[]) => {} },
    finishRepo: {
      listBySeries: async () => read?.finishes ?? [],
      saveMany: async (fs: Finish[]) => { savedFinishes.push(...fs); },
    },
    raceStartRepo: { listBySeries: async () => read?.raceStarts ?? [], saveMany: async (_: RaceStart[]) => {} },
    raceRatingOverrideRepo: { listBySeries: async () => read?.ratingOverrides ?? [], listByRaces: async () => [], saveMany: async () => {} },
    listSeriesNames: async () => [],
    deleteSeriesChildren: async () => {},
  } as unknown as SeriesFileRepos;
  return { repos, savedFinishes };
}

describe('lap counts in the .sailscoring file', () => {
  it('writes each finish’s lap count and restores it on import', async () => {
    const file = await buildSeriesFile('s1', makeRecordingRepos(snapshot).repos);
    expect(file.races[0].finishes.map((f) => f.laps)).toEqual([2, 1]);

    const { repos, savedFinishes } = makeRecordingRepos();
    await openSeriesFromFile(file, repos);
    expect(savedFinishes.map((f) => f.laps).sort()).toEqual([1, 2]);
  });

  it('writes no key for a finish on the full course', async () => {
    const bare: SeriesSnapshot = { ...snapshot, finishes: [makeFinish('c1', 1, '11:40:10'), makeFinish('c2', 2, '11:50:00')] };
    const file = await buildSeriesFile('s1', makeRecordingRepos(bare).repos);
    expect(file.races[0].finishes.some((f) => 'laps' in f)).toBe(false);
  });
});

describe('lap counts in the public JSON export', () => {
  it('carries each finish’s lap count', () => {
    const data = buildPublicExportFromSnapshot(snapshot)!;
    const bySail = new Map(data.races[0].finishes.map((f) => [f.sailNumber, f]));
    expect(bySail.get('1001')!.laps).toBe(2);
    expect(bySail.get('H303')!.laps).toBe(1);
  });
});
