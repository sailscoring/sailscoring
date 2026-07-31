/**
 * Per-race scoring options (#342) across both file formats: the .sailscoring
 * v25 round-trip and the public JSON export. Dropping either field silently
 * changes the standings a re-imported series produces, so both directions are
 * asserted, along with the absent-by-default case.
 */

import { describe, it, expect } from 'vitest';
import {
  buildSeriesFile,
  FORMAT_VERSION,
  openSeriesFromFile,
  type SeriesFileRepos,
} from '@/lib/series-file';
import {
  buildPublicExportFromSnapshot,
  importPublicExport,
} from '@/lib/public-export';
import type {
  Competitor,
  Finish,
  Fleet,
  Race,
  RaceStart,
  Series,
  SubSeries,
} from '@/lib/types';
import type { SeriesSnapshot } from '@/lib/series-snapshot';

function makeSeries(): Series {
  return {
    id: 's1',
    name: 'Wave Regatta',
    venue: 'HYC',
    startDate: '2026-06-01',
    endDate: '2026-06-03',
    venueLogoUrl: '',
    eventLogoUrl: '',
    venueUrl: '',
    eventUrl: '',
    createdAt: 0,
    lastSavedAt: null,
    lastModifiedAt: 0,
    scoringMode: 'scratch',
    discardThresholds: [{ minRaces: 3, discardCount: 1 }],
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

const fleet: Fleet = { id: 'fl-1', seriesId: 's1', name: 'Cruisers 1', displayOrder: 0, scoringSystem: 'scratch' };

function makeCompetitor(id: string, sail: string): Competitor {
  return { id, seriesId: 's1', fleetIds: ['fl-1'], sailNumber: sail, names: [sail], club: '', gender: '', age: null, createdAt: 0 };
}

function makeFinish(raceId: string, competitorId: string, sortOrder: number): Finish {
  return { id: `${raceId}-${competitorId}`, raceId, competitorId, sortOrder, tiedWithPrevious: false, resultCode: null, startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null, redressExcludeRaceIds: null, redressIncludeRaceIds: null, redressIncludeAllLater: false, redressPoints: null };
}

function makeRace(id: string, raceNumber: number, extra: Partial<Race> = {}): Race {
  return { id, seriesId: 's1', raceNumber, name: null, date: '2026-06-01', createdAt: 0, ...extra };
}

// Race 1 ordinary, race 2 the practice race, race 3 the Lambay-style
// centrepiece counting double.
const snapshot: SeriesSnapshot = {
  series: makeSeries(),
  competitors: [makeCompetitor('c1', '1401'), makeCompetitor('c2', '1402')],
  fleets: [fleet],
  races: [
    makeRace('r1', 1),
    makeRace('r2', 2, { discardPolicy: 'discardFirst' }),
    makeRace('r3', 3, { discardPolicy: 'mustCount', pointsMultiplier: 2 }),
  ],
  subSeries: [],
  finishes: [
    makeFinish('r1', 'c1', 1), makeFinish('r1', 'c2', 2),
    makeFinish('r2', 'c1', 1), makeFinish('r2', 'c2', 2),
    makeFinish('r3', 'c1', 1), makeFinish('r3', 'c2', 2),
  ],
  raceStarts: [],
  ratingOverrides: [],
};

function makeRecordingRepos(read?: SeriesSnapshot) {
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
      saveMany: async (_: SubSeries[]) => {},
    },
    finishRepo: {
      listBySeries: async () => read?.finishes ?? [],
      save: async (f: Finish) => f,
      saveMany: async () => {},
    },
    raceStartRepo: {
      listBySeries: async () => read?.raceStarts ?? [],
      save: async (rs: RaceStart) => rs,
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
  return { repos, savedRaces };
}

describe('.sailscoring v25 per-race scoring options', () => {
  it('writes both fields, and writes nothing for an ordinary race', async () => {
    const { repos } = makeRecordingRepos(snapshot);
    const file = await buildSeriesFile('s1', repos);

    expect(file.formatVersion).toBe(FORMAT_VERSION);
    expect('discardPolicy' in file.races[0]).toBe(false);
    expect('pointsMultiplier' in file.races[0]).toBe(false);
    expect(file.races[1].discardPolicy).toBe('discardFirst');
    expect(file.races[2].discardPolicy).toBe('mustCount');
    expect(file.races[2].pointsMultiplier).toBe(2);
  });

  it('omits a policy of "normal" and a multiplier of 1 — the defaults are absence', async () => {
    const explicitDefaults: SeriesSnapshot = {
      ...snapshot,
      races: [makeRace('r1', 1, { discardPolicy: 'normal', pointsMultiplier: 1 })],
      finishes: [makeFinish('r1', 'c1', 1), makeFinish('r1', 'c2', 2)],
    };
    const { repos } = makeRecordingRepos(explicitDefaults);
    const file = await buildSeriesFile('s1', repos);

    expect('discardPolicy' in file.races[0]).toBe(false);
    expect('pointsMultiplier' in file.races[0]).toBe(false);
  });

  it('restores both fields on import', async () => {
    const { repos: buildRepos } = makeRecordingRepos(snapshot);
    const file = await buildSeriesFile('s1', buildRepos);

    const { repos, savedRaces } = makeRecordingRepos();
    await openSeriesFromFile(file, repos);

    expect(savedRaces).toHaveLength(3);
    expect(savedRaces[0].discardPolicy).toBeUndefined();
    expect(savedRaces[0].pointsMultiplier).toBeUndefined();
    expect(savedRaces[1].discardPolicy).toBe('discardFirst');
    expect(savedRaces[2].discardPolicy).toBe('mustCount');
    expect(savedRaces[2].pointsMultiplier).toBe(2);
  });
});

describe('public JSON export per-race scoring options', () => {
  it('carries both fields, and re-imports them onto the fresh races', async () => {
    const data = buildPublicExportFromSnapshot(snapshot);
    expect(data).not.toBeNull();
    expect('discardPolicy' in data!.races[0]).toBe(false);
    expect(data!.races[1].discardPolicy).toBe('discardFirst');
    expect(data!.races[2].discardPolicy).toBe('mustCount');
    expect(data!.races[2].pointsMultiplier).toBe(2);

    const { repos, savedRaces } = makeRecordingRepos();
    await importPublicExport(data!, repos);

    expect(savedRaces.map((r) => r.discardPolicy)).toEqual([
      undefined,
      'discardFirst',
      'mustCount',
    ]);
    expect(savedRaces[2].pointsMultiplier).toBe(2);
  });
});
