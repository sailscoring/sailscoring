/**
 * Sub-series serialization round-trips (#203): the v9 `.sailscoring` file
 * format and the public JSON export both carry blocks, and both import
 * paths rebuild them (with fresh ids) and keep race membership attached.
 */
import { describe, it, expect } from 'vitest';
import {
  buildSeriesFile,
  openSeriesFromFile,
  parseSeriesFile,
  FORMAT_VERSION,
  type SeriesFileRepos,
} from '@/lib/series-file';
import {
  buildPublicExportFromSnapshot,
  importPublicExport,
  type ImportRepos,
} from '@/lib/public-export';
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
    enabledCompetitorFields: ['club'],
    primaryPersonLabel: 'helm',
    subdivisionLabel: 'Division',
  };
}

const fleet: Fleet = { id: 'fl-1', seriesId: 's1', name: 'Default', displayOrder: 0, scoringSystem: 'scratch' };

function makeCompetitor(id: string, sail: string): Competitor {
  return { id, seriesId: 's1', fleetIds: ['fl-1'], sailNumber: sail, name: sail, club: '', gender: '', age: null, createdAt: 0 };
}

function makeRace(id: string, n: number): Race {
  return { id, seriesId: 's1', raceNumber: n, date: '2026-11-01', createdAt: 0 };
}

function makeFinish(raceId: string, competitorId: string, sortOrder: number): Finish {
  return { id: `${raceId}-${competitorId}`, raceId, competitorId, sortOrder, tiedWithPrevious: false, resultCode: null, startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null, redressExcludeRaces: null, redressIncludeRaces: null, redressIncludeAllLater: false, redressPoints: null };
}

const winter: SubSeries = { id: 'ss-w', seriesId: 's1', name: 'Winter', displayOrder: 0, raceIds: ['r1', 'r2'] };
const spring: SubSeries = { id: 'ss-s', seriesId: 's1', name: 'Spring', displayOrder: 1, raceIds: ['r3'] };

const snapshot: SeriesSnapshot = {
  series: makeSeries('s1'),
  competitors: [makeCompetitor('c1', '101'), makeCompetitor('c2', '102')],
  fleets: [fleet],
  races: [makeRace('r1', 1), makeRace('r2', 2), makeRace('r3', 3)],
  subSeries: [winter, spring],
  finishes: [
    makeFinish('r1', 'c1', 1), makeFinish('r1', 'c2', 2),
    makeFinish('r2', 'c2', 1), makeFinish('r2', 'c1', 2),
    makeFinish('r3', 'c1', 1), makeFinish('r3', 'c2', 2),
  ],
  raceStarts: [],
  ratingOverrides: [],
};

/** Fake repos backed by the snapshot for reads, recording writes. */
function makeRecordingRepos(read?: SeriesSnapshot) {
  const savedSubSeries: SubSeries[] = [];
  const savedRaces: Race[] = [];
  const repos = {
    seriesRepo: {
      get: async (id: string) => (read && id === read.series.id ? read.series : undefined),
      save: async (s: Series) => s,
    },
    fleetRepo: {
      listBySeries: async () => read?.fleets ?? [],
      save: async (f: Fleet) => f,
      saveMany: async () => {},
    },
    competitorRepo: {
      listBySeries: async () => read?.competitors ?? [],
      save: async (c: Competitor) => c,
      saveMany: async () => {},
    },
    raceRepo: {
      listBySeries: async () => read?.races ?? [],
      save: async (r: Race) => {
        savedRaces.push(r);
        return r;
      },
    },
    subSeriesRepo: {
      listBySeries: async () => read?.subSeries ?? [],
      saveMany: async (list: SubSeries[]) => {
        savedSubSeries.push(...list);
      },
    },
    finishRepo: {
      listBySeries: async () => read?.finishes ?? [],
      saveMany: async () => {},
    },
    raceStartRepo: {
      listBySeries: async () => read?.raceStarts ?? [],
      save: async (rs: RaceStart) => rs,
      saveMany: async () => {},
    },
    raceRatingOverrideRepo: {
      listBySeries: async () => read?.ratingOverrides ?? [],
      listByRaces: async () => [],
      saveMany: async () => {},
    },
    listSeriesNames: async () => [],
    deleteSeriesChildren: async () => {},
  } as unknown as SeriesFileRepos & ImportRepos;
  return { repos, savedSubSeries, savedRaces };
}

describe('.sailscoring v9 sub-series round-trip', () => {
  it('buildSeriesFile carries sub-series with race membership', async () => {
    const { repos } = makeRecordingRepos(snapshot);
    const file = await buildSeriesFile('s1', repos);

    expect(file.formatVersion).toBe(FORMAT_VERSION);
    expect(file.subSeries).toEqual([
      { id: 'ss-w', name: 'Winter', displayOrder: 0, raceIds: ['r1', 'r2'] },
      { id: 'ss-s', name: 'Spring', displayOrder: 1, raceIds: ['r3'] },
    ]);
    expect(file.races.every((r) => !('subSeriesId' in r))).toBe(true);

    // The serialized file parses back without loss.
    const reparsed = parseSeriesFile(JSON.stringify(file));
    expect(reparsed.subSeries).toEqual(file.subSeries);
  });

  it('a series with no sub-series writes no subSeries key', async () => {
    const { repos } = makeRecordingRepos({ ...snapshot, subSeries: [] });
    const file = await buildSeriesFile('s1', repos);
    expect(file.subSeries).toBeUndefined();
  });

  it('openSeriesFromFile rebuilds sub-series with fresh ids and remapped membership', async () => {
    const built = await buildSeriesFile('s1', makeRecordingRepos(snapshot).repos);
    const { repos, savedSubSeries, savedRaces } = makeRecordingRepos();
    await openSeriesFromFile(built, repos);

    expect(savedSubSeries.map((ss) => ss.name)).toEqual(['Winter', 'Spring']);
    expect(savedSubSeries.every((ss) => ss.id !== 'ss-w' && ss.id !== 'ss-s')).toBe(true);

    // Membership references the freshly-minted race ids, in race order.
    const raceIdByNumber = new Map(savedRaces.map((r) => [r.raceNumber, r.id]));
    const newWinter = savedSubSeries.find((ss) => ss.name === 'Winter')!;
    const newSpring = savedSubSeries.find((ss) => ss.name === 'Spring')!;
    expect(newWinter.raceIds).toEqual([raceIdByNumber.get(1), raceIdByNumber.get(2)]);
    expect(newSpring.raceIds).toEqual([raceIdByNumber.get(3)]);
  });

  it('parseSeriesFile rejects a non-list subSeries', () => {
    const built = { formatVersion: 9, seriesId: 's1', exportedAt: 'x', series: {}, fleets: [], competitors: [], races: [], subSeries: 'nope' };
    expect(() => parseSeriesFile(JSON.stringify(built))).toThrow(/subSeries/);
  });
});

describe('public JSON export sub-series round-trip', () => {
  it('export names each race\'s sub-series; import rebuilds them with membership', async () => {
    const data = buildPublicExportFromSnapshot(snapshot);
    expect(data).not.toBeNull();
    expect(data!.races.map((r) => r.subSeries)).toEqual([['Winter'], ['Winter'], ['Spring']]);

    const { repos, savedSubSeries, savedRaces } = makeRecordingRepos();
    await importPublicExport(data!, repos);

    expect(savedSubSeries.map((ss) => ss.name)).toEqual(['Winter', 'Spring']);
    expect(savedSubSeries.map((ss) => ss.displayOrder)).toEqual([0, 1]);
    const raceIdByNumber = new Map(savedRaces.map((r) => [r.raceNumber, r.id]));
    const newWinter = savedSubSeries.find((ss) => ss.name === 'Winter')!;
    const newSpring = savedSubSeries.find((ss) => ss.name === 'Spring')!;
    expect(newWinter.raceIds).toEqual([raceIdByNumber.get(1), raceIdByNumber.get(2)]);
    expect(newSpring.raceIds).toEqual([raceIdByNumber.get(3)]);
  });

  it('an export with no sub-series carries no subSeries keys', () => {
    const data = buildPublicExportFromSnapshot({ ...snapshot, subSeries: [] });
    expect(data!.races.every((r) => r.subSeries === undefined)).toBe(true);
  });
});

describe('buildFleetHtmlFiles with sub-series', () => {
  it('renders one page per (block, fleet) with block-local race numbers', async () => {
    const { buildFleetHtmlFiles } = await import('@/lib/results-export');
    const { repos } = makeRecordingRepos(snapshot);
    const files = await buildFleetHtmlFiles(repos, 's1');
    expect(files).not.toBeNull();
    expect(files!.map((f) => f.subSeriesName)).toEqual(['Winter', 'Spring']);

    const winterPage = files![0];
    expect(winterPage.html).toContain('Frostbites — Winter');
    // Two Winter races, numbered within the block.
    expect(winterPage.html).toContain('R1');
    expect(winterPage.html).toContain('R2');

    const springPage = files![1];
    expect(springPage.html).toContain('Frostbites — Spring');
    // The lone Spring race is R1 in its block, not series-wide R3.
    expect(springPage.html).not.toContain('>R3<');
  });

  it('a series with no sub-series still renders one page per fleet', async () => {
    const { buildFleetHtmlFiles } = await import('@/lib/results-export');
    const blockless: SeriesSnapshot = { ...snapshot, subSeries: [] };
    const { repos } = makeRecordingRepos(blockless);
    const files = await buildFleetHtmlFiles(repos, 's1');
    expect(files).toHaveLength(1);
    expect(files![0].subSeriesName).toBeUndefined();
  });
});
