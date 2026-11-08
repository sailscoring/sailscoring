/**
 * "Count the best N races": the `.sailscoring` file (v77) and the public JSON
 * export (v15) carry `series.countBest` sparsely, alongside whichever other
 * rule the series keeps for switching back, and both import paths restore it.
 */
import { describe, it, expect } from 'vitest';
import { buildSeriesFile, openSeriesFromFile, parseSeriesFile, type SeriesFileRepos } from '@/lib/series-file';
import { buildPublicExportFromSnapshot, importPublicExport, type ImportRepos } from '@/lib/public-export';
import { seriesSchema } from '@/lib/validation/series';
import type { SeriesSnapshot } from '@/lib/series-snapshot';
import type { Competitor, Finish, Fleet, Race, RaceStart, Series, SubSeries } from '@/lib/types';

const series: Series = {
  id: 's1', name: 'Wolf’s Head', venue: 'Irish Sea', startDate: '2026-04-25', endDate: '2026-09-12',
  venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '', createdAt: 0, lastSavedAt: null,
  lastModifiedAt: 0, scoringMode: 'scratch',
  discardThresholds: [{ minRaces: 6, discardCount: 1 }],
  proportionalDiscard: { firstAt: 4, everyRaces: 4 },
  countBest: 5,
  dnfScoring: 'seriesEntries',
  ftpHost: '', ftpPath: '', ftpPaths: {}, includeJsonExport: true, enabledCompetitorFields: [],
  primaryPersonLabel: 'helm', subdivisionAxes: [],
};

const fleet: Fleet = { id: 'fl-1', seriesId: 's1', name: 'Overall', displayOrder: 0, scoringSystem: 'scratch' };

function makeCompetitor(id: string, sail: string): Competitor {
  return { id, seriesId: 's1', fleetIds: ['fl-1'], sailNumber: sail, names: [sail], clubs: [], gender: '', age: null, createdAt: 0 };
}

function makeFinish(competitorId: string, sortOrder: number): Finish {
  return {
    id: `r1-${competitorId}`, raceId: 'r1', competitorId, sortOrder, tiedWithPrevious: false,
    resultCode: null, startPresent: null, penaltyCode: null, penaltyOverride: null,
    redressMethod: null, redressExcludeRaceIds: null, redressIncludeRaceIds: null, redressIncludeAllLater: false,
    redressPoints: null,
  };
}

const snapshot: SeriesSnapshot = {
  series,
  competitors: [makeCompetitor('c1', '101'), makeCompetitor('c2', '102')],
  fleets: [fleet],
  races: [{ id: 'r1', seriesId: 's1', raceNumber: 1, name: null, date: '2026-04-25', createdAt: 0 }],
  subSeries: [],
  finishes: [makeFinish('c1', 1), makeFinish('c2', 2)],
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
    competitorRepo: { listBySeries: async () => read?.competitors ?? [], saveMany: async () => {} },
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

describe('count-best in the .sailscoring file', () => {
  it('writes the rule beside the ones it replaces and restores all three on import', async () => {
    const file = await buildSeriesFile('s1', makeFileRepos(snapshot).repos);
    expect(file.series.countBest).toBe(5);
    const reparsed = parseSeriesFile(JSON.stringify(file));
    expect(reparsed.series.countBest).toBe(5);

    const target = makeFileRepos();
    await openSeriesFromFile(reparsed, target.repos);
    expect(target.saved()?.countBest).toBe(5);
    expect(target.saved()?.proportionalDiscard).toEqual({ firstAt: 4, everyRaces: 4 });
    expect(target.saved()?.discardThresholds).toEqual([{ minRaces: 6, discardCount: 1 }]);
  });

  it('writes no key for a series without it', async () => {
    const plain = { ...snapshot, series: { ...series, countBest: undefined } };
    const file = await buildSeriesFile('s1', makeFileRepos(plain).repos);
    expect(file.series).not.toHaveProperty('countBest');
  });
});

describe('count-best in the public JSON export', () => {
  it('carries the rule and restores it on import', async () => {
    const data = buildPublicExportFromSnapshot(snapshot)!;
    expect(data.version).toBe(16);
    expect(data.series.countBest).toBe(5);

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
    expect(saved?.countBest).toBe(5);
  });

  it('omits the key for a series without it', () => {
    const data = buildPublicExportFromSnapshot({ ...snapshot, series: { ...series, countBest: undefined } })!;
    expect(data.series).not.toHaveProperty('countBest');
  });
});

describe('the series schema', () => {
  it('refuses a count of no races', () => {
    expect(seriesSchema.shape.countBest.safeParse(0).success).toBe(false);
    expect(seriesSchema.shape.countBest.safeParse(2.5).success).toBe(false);
    expect(seriesSchema.shape.countBest.safeParse(5).success).toBe(true);
    expect(seriesSchema.shape.countBest.safeParse(undefined).success).toBe(true);
  });
});
