/**
 * An SCP stated in points (RRS 44.3(c)'s main form): the `.sailscoring` file
 * and the public JSON export carry `penaltyInPoints` sparsely — absent is a
 * percentage of DNF — and both import paths restore it. It decides whether a
 * stored 2 means 2 points or 2% of DNF, so it travels unconditionally.
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
  name: 'Dinghy Frostbites',
  venue: 'Howth Yacht Club',
  startDate: '2026-11-01',
  endDate: '',
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
  enabledCompetitorFields: ['club'],
  primaryPersonLabel: 'helm',
  subdivisionAxes: [],
};

const fleet: Fleet = { id: 'fl-1', seriesId: 's1', name: 'ILCA 7', displayOrder: 0, scoringSystem: 'scratch' };

function makeCompetitor(id: string, sail: string): Competitor {
  return { id, seriesId: 's1', fleetIds: ['fl-1'], sailNumber: sail, names: [sail], clubs: [], gender: '', age: null, createdAt: 0 };
}

function makeFinish(competitorId: string, sortOrder: number, penalty?: Partial<Finish>): Finish {
  return {
    id: `r1-${competitorId}`, raceId: 'r1', competitorId, sortOrder, tiedWithPrevious: false,
    resultCode: null, startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null,
    redressExcludeRaceIds: null, redressIncludeRaceIds: null, redressIncludeAllLater: false, redressPoints: null,
    ...penalty,
  };
}

const snapshot: SeriesSnapshot = {
  series,
  competitors: [makeCompetitor('c1', '1001'), makeCompetitor('c2', '1002'), makeCompetitor('c3', '1003')],
  fleets: [fleet],
  races: [{ id: 'r1', seriesId: 's1', raceNumber: 1, name: null, date: '2026-11-01', createdAt: 0 }],
  subSeries: [],
  finishes: [
    makeFinish('c1', 1, { penaltyCode: 'SCP', penaltyOverride: 2, penaltyInPoints: true }),
    makeFinish('c2', 2, { penaltyCode: 'SCP', penaltyOverride: 30 }),
    makeFinish('c3', 3),
  ],
  raceStarts: [],
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

describe('an SCP stated in points in the .sailscoring file', () => {
  it('writes the flag on the points SCP only, and restores it on import', async () => {
    const file = await buildSeriesFile('s1', makeRecordingRepos(snapshot).repos);
    expect(file.races[0].finishes.map((f) => f.penaltyInPoints)).toEqual([true, undefined, undefined]);
    expect(file.races[0].finishes.filter((f) => 'penaltyInPoints' in f)).toHaveLength(1);

    const { repos, savedFinishes } = makeRecordingRepos();
    await openSeriesFromFile(file, repos);
    const scps = savedFinishes.filter((f) => f.penaltyCode === 'SCP');
    expect(scps.map((f) => [f.penaltyOverride, !!f.penaltyInPoints]).sort()).toEqual([[2, true], [30, false]]);
  });
});

describe('an SCP stated in points in the public JSON export', () => {
  it('carries the flag on the finish, and on the standings row', () => {
    const data = buildPublicExportFromSnapshot(snapshot)!;
    const bySail = new Map(data.races[0].finishes.map((f) => [f.sailNumber, f]));
    expect(bySail.get('1001')!.penaltyInPoints).toBe(true);
    expect('penaltyInPoints' in bySail.get('1002')!).toBe(false);

    const rows = new Map(data.standings[0].rows.map((r) => [r.sailNumber, r]));
    expect(rows.get('1001')!.racePoints).toEqual([3]);    // 1 + 2 points
    expect(rows.get('1001')!.racePenaltyInPoints).toEqual([true]);
    expect(rows.get('1002')!.racePoints).toEqual([3.2]);  // 2 + 30% of 4
    expect('racePenaltyInPoints' in rows.get('1002')!).toBe(false);  // sparse
  });
});
