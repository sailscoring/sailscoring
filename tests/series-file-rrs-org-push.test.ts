/**
 * rrs.org push-config serialization: the v16 `.sailscoring` file carries
 * `series.rrsOrgPush` (sparse — written only when set) and the import paths
 * restore it verbatim (axis ids are stable across imports, so no remap). The
 * public JSON export must NOT carry it: the event UUID is a write-credential
 * for the rrs.org event.
 */
import { describe, it, expect } from 'vitest';
import {
  buildSeriesFile,
  openSeriesFromFile,
  type SeriesFile,
  type SeriesFileRepos,
} from '@/lib/series-file';
import {
  buildPublicExportFromSnapshot,
} from '@/lib/public-export';
import type { SeriesSnapshot } from '@/lib/series-snapshot';
import type {
  Competitor,
  Finish,
  Fleet,
  Race,
  RaceStart,
  RrsOrgPushConfig,
  Series,
  SubSeries,
} from '@/lib/types';

const RRS_PUSH: RrsOrgPushConfig = {
  eventUuid: 'd17854ef-f55f-4ab6-8429-3f55527b6e9f',
  divisionSource: 'axis',
  divisionAxisId: 'axis-div',
};

function makeSeries(id: string): Series {
  return {
    id,
    name: 'GP14 Leinsters',
    venue: 'Sligo YC',
    startDate: '2026-07-11',
    endDate: '2026-07-12',
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
    subdivisionAxes: [{ id: 'axis-div', label: 'Division' }],
    rrsOrgPush: RRS_PUSH,
  };
}

const fleet: Fleet = { id: 'fl-1', seriesId: 's1', name: 'GP14', displayOrder: 0, scoringSystem: 'scratch' };

function makeCompetitor(id: string, sail: string): Competitor {
  return { id, seriesId: 's1', fleetIds: ['fl-1'], sailNumber: sail, name: sail, club: '', gender: '', age: null, createdAt: 0 };
}

function makeRace(id: string, n: number): Race {
  return { id, seriesId: 's1', raceNumber: n, name: null, date: '2026-07-11', createdAt: 0 };
}

function makeFinish(raceId: string, competitorId: string, sortOrder: number): Finish {
  return { id: `${raceId}-${competitorId}`, raceId, competitorId, sortOrder, tiedWithPrevious: false, resultCode: null, startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null, redressExcludeRaceIds: null, redressIncludeRaceIds: null, redressIncludeAllLater: false, redressPoints: null };
}

const snapshot: SeriesSnapshot = {
  series: makeSeries('s1'),
  competitors: [makeCompetitor('c1', '14302'), makeCompetitor('c2', '14241')],
  fleets: [fleet],
  races: [makeRace('r1', 1)],
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
    fleetRepo: {
      listBySeries: async () => read?.fleets ?? [],
      saveMany: async () => {},
    },
    competitorRepo: {
      listBySeries: async () => read?.competitors ?? [],
      saveMany: async () => {},
    },
    raceRepo: {
      listBySeries: async () => read?.races ?? [],
      save: async (r: Race) => r,
    },
    subSeriesRepo: {
      listBySeries: async () => read?.subSeries ?? [],
      saveMany: async (_: SubSeries[]) => {},
    },
    finishRepo: {
      listBySeries: async () => read?.finishes ?? [],
      saveMany: async () => {},
    },
    raceStartRepo: {
      listBySeries: async () => read?.raceStarts ?? [],
      saveMany: async (_: RaceStart[]) => {},
    },
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

describe('.sailscoring v16 rrsOrgPush round-trip', () => {
  it('buildSeriesFile carries rrsOrgPush when set', async () => {
    const { repos } = makeRecordingRepos(snapshot);
    const file = await buildSeriesFile('s1', repos);
    expect(file.series.rrsOrgPush).toEqual(RRS_PUSH);
  });

  it('a series with no push config writes no rrsOrgPush key', async () => {
    const bare: SeriesSnapshot = { ...snapshot, series: { ...snapshot.series, rrsOrgPush: undefined } };
    const { repos } = makeRecordingRepos(bare);
    const file = await buildSeriesFile('s1', repos);
    expect('rrsOrgPush' in file.series).toBe(false);
  });

  it('openSeriesFromFile restores the config verbatim, axis reference intact', async () => {
    const { repos: buildRepos } = makeRecordingRepos(snapshot);
    const file = await buildSeriesFile('s1', buildRepos);
    const { repos, savedSeries } = makeRecordingRepos();
    await openSeriesFromFile(file, repos);
    const saved = savedSeries.at(-1)!;
    expect(saved.rrsOrgPush).toEqual(RRS_PUSH);
    // The referenced axis keeps its id on import, so the reference stays live.
    expect(saved.subdivisionAxes.some((a) => a.id === RRS_PUSH.divisionAxisId)).toBe(true);
  });

  it('a pre-v16 file loads with no push config', async () => {
    const { repos: buildRepos } = makeRecordingRepos(snapshot);
    const file: SeriesFile = await buildSeriesFile('s1', buildRepos);
    file.formatVersion = 15;
    delete file.series.rrsOrgPush;
    const { repos, savedSeries } = makeRecordingRepos();
    await openSeriesFromFile(file, repos);
    expect(savedSeries.at(-1)!.rrsOrgPush).toBeUndefined();
  });
});

describe('public JSON export excludes rrsOrgPush', () => {
  it('the export carries neither the key nor the event UUID', () => {
    const data = buildPublicExportFromSnapshot(snapshot);
    expect(data).not.toBeNull();
    const json = JSON.stringify(data);
    expect(json).not.toContain('rrsOrgPush');
    expect(json).not.toContain(RRS_PUSH.eventUuid);
  });
});
