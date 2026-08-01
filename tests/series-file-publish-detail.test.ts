/**
 * `series.publishDetail` serialization (#347): the v28 `.sailscoring` file
 * carries the single-race-event presentation sparsely — written only as
 * 'races', absent for the default — and the import path restores it. The
 * public JSON export carries the same hint, since a re-renderer needs to know
 * the event publishes as a race result rather than a one-race series table.
 */
import { describe, it, expect } from 'vitest';
import {
  buildSeriesFile,
  openSeriesFromFile,
  type SeriesFileRepos,
} from '@/lib/series-file';
import { buildPublicExportFromSnapshot } from '@/lib/public-export';
import type { SeriesSnapshot } from '@/lib/series-snapshot';
import type {
  Competitor,
  Finish,
  Fleet,
  Race,
  RaceStart,
  Series,
  SubSeries,
} from '@/lib/types';

function makeSeries(id: string): Series {
  return {
    id,
    name: 'Lambay Race',
    venue: 'Howth Yacht Club',
    startDate: '2026-06-06',
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
    publishDetail: 'races',
  };
}

const fleet: Fleet = { id: 'fl-1', seriesId: 's1', name: 'Class 1', displayOrder: 0, scoringSystem: 'scratch' };

function makeCompetitor(id: string, sail: string): Competitor {
  return { id, seriesId: 's1', fleetIds: ['fl-1'], sailNumber: sail, names: [sail], club: '', gender: '', age: null, createdAt: 0 };
}

function makeFinish(raceId: string, competitorId: string, sortOrder: number): Finish {
  return { id: `${raceId}-${competitorId}`, raceId, competitorId, sortOrder, tiedWithPrevious: false, resultCode: null, startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null, redressExcludeRaceIds: null, redressIncludeRaceIds: null, redressIncludeAllLater: false, redressPoints: null };
}

const snapshot: SeriesSnapshot = {
  series: makeSeries('s1'),
  competitors: [makeCompetitor('c1', '1234'), makeCompetitor('c2', '5678')],
  fleets: [fleet],
  races: [{ id: 'r1', seriesId: 's1', raceNumber: 1, name: null, date: '2026-06-06', createdAt: 0 }],
  subSeries: [],
  finishes: [makeFinish('r1', 'c1', 1), makeFinish('r1', 'c2', 2)],
  raceStarts: [],
  ratingOverrides: [],
};

/** Fake repos backed by the snapshot for reads, recording writes. */
function makeRecordingRepos(read?: SeriesSnapshot) {
  const savedSeries: Series[] = [];
  const repos = {
    seriesRepo: {
      get: async (id: string) => (read && id === read.series.id ? read.series : undefined),
      save: async (s: Series) => {
        savedSeries.push(s);
        return s;
      },
    },
    fleetRepo: { listBySeries: async () => read?.fleets ?? [], saveMany: async () => {} },
    competitorRepo: { listBySeries: async () => read?.competitors ?? [], saveMany: async () => {} },
    raceRepo: { listBySeries: async () => read?.races ?? [], save: async (r: Race) => r },
    subSeriesRepo: { listBySeries: async () => read?.subSeries ?? [], saveMany: async (_: SubSeries[]) => {} },
    finishRepo: { listBySeries: async () => read?.finishes ?? [], saveMany: async () => {} },
    raceStartRepo: { listBySeries: async () => read?.raceStarts ?? [], saveMany: async (_: RaceStart[]) => {} },
    raceRatingOverrideRepo: {
      listBySeries: async () => read?.ratingOverrides ?? [],
      listByRaces: async () => [],
      saveMany: async () => {},
    },
    listSeriesNames: async () => [],
    deleteSeriesChildren: async () => {},
  } as unknown as SeriesFileRepos;
  return { repos, savedSeries };
}

describe('.sailscoring v28 publishDetail round-trip', () => {
  it('buildSeriesFile writes the setting when the event publishes race results', async () => {
    const { repos } = makeRecordingRepos(snapshot);
    const file = await buildSeriesFile('s1', repos);
    expect(file.series.publishDetail).toBe('races');
  });

  it('the default writes no publishDetail key', async () => {
    const full: SeriesSnapshot = { ...snapshot, series: { ...snapshot.series, publishDetail: 'full' } };
    const { repos } = makeRecordingRepos(full);
    expect('publishDetail' in (await buildSeriesFile('s1', repos)).series).toBe(false);

    const absent: SeriesSnapshot = { ...snapshot, series: { ...snapshot.series, publishDetail: undefined } };
    const { repos: repos2 } = makeRecordingRepos(absent);
    expect('publishDetail' in (await buildSeriesFile('s1', repos2)).series).toBe(false);
  });

  it('openSeriesFromFile restores the setting', async () => {
    const { repos: buildRepos } = makeRecordingRepos(snapshot);
    const file = await buildSeriesFile('s1', buildRepos);
    const { repos, savedSeries } = makeRecordingRepos();
    await openSeriesFromFile(file, repos);
    expect(savedSeries.at(-1)!.publishDetail).toBe('races');
  });

  it('a file without the setting loads at full detail', async () => {
    const { repos: buildRepos } = makeRecordingRepos(snapshot);
    const file = await buildSeriesFile('s1', buildRepos);
    file.formatVersion = 27;
    delete file.series.publishDetail;
    const { repos, savedSeries } = makeRecordingRepos();
    await openSeriesFromFile(file, repos);
    expect(savedSeries.at(-1)!.publishDetail).toBe('full');
  });

  it('the public JSON export carries the hint, sparsely', async () => {
    const raceResults = await buildPublicExportFromSnapshot(snapshot, {});
    expect(raceResults?.series.publishDetail).toBe('races');

    const full: SeriesSnapshot = { ...snapshot, series: { ...snapshot.series, publishDetail: 'full' } };
    const fullExport = await buildPublicExportFromSnapshot(full, {});
    expect('publishDetail' in fullExport!.series).toBe(false);
  });
});
