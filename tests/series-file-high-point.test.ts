/**
 * High-point scoring: the `.sailscoring` file (v78) and the public JSON export
 * (v16) carry the points system, its formula, the point for coming to the
 * start and a code's `countsInFleetSize` sparsely, and both import paths
 * restore them. A low-point series carries none of them.
 */
import { describe, it, expect } from 'vitest';
import { buildSeriesFile, openSeriesFromFile, parseSeriesFile, type SeriesFileRepos } from '@/lib/series-file';
import { buildPublicExportFromSnapshot, importPublicExport, type ImportRepos } from '@/lib/public-export';
import { seriesSchema } from '@/lib/validation/series';
import { pointsSystemFields } from '@/lib/high-point';
import type { SeriesSnapshot } from '@/lib/series-snapshot';
import type { Competitor, Finish, Fleet, Race, RaceStart, Series, SubSeries } from '@/lib/types';

const series: Series = {
  id: 's1', name: 'Winter Series', venue: 'Irish Sea', startDate: '2026-04-25', endDate: '2026-09-12',
  venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '', createdAt: 0, lastSavedAt: null,
  lastModifiedAt: 0, scoringMode: 'scratch',
  discardThresholds: [{ minRaces: 6, discardCount: 1 }],
  countBest: 18,
  dnfScoring: 'seriesEntries',
  pointsSystem: 'highPoint',
  highPointFormula: 'boatsBeaten',
  pointForComingToStart: true,
  scoringCodes: [
    { code: 'DTP', description: 'Declared to race, did not', kind: 'replace', rule: { type: 'fixedPoints', points: 8 }, discardable: true, countsInFleetSize: true },
    { code: 'DNS', kind: 'replace', rule: { type: 'fixedPoints', points: 0 }, discardable: true, countsInFleetSize: false },
  ],
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

const lowPoint: Series = {
  ...series, pointsSystem: undefined, highPointFormula: undefined, pointForComingToStart: undefined, scoringCodes: undefined,
};

describe('high point in the .sailscoring file', () => {
  it('writes the points system and restores it on import', async () => {
    const file = await buildSeriesFile('s1', makeFileRepos(snapshot).repos);
    expect(file.series.pointsSystem).toBe('highPoint');
    expect(file.series.highPointFormula).toBe('boatsBeaten');
    expect(file.series.pointForComingToStart).toBe(true);
    const reparsed = parseSeriesFile(JSON.stringify(file));

    const target = makeFileRepos();
    await openSeriesFromFile(reparsed, target.repos);
    expect(target.saved()?.pointsSystem).toBe('highPoint');
    expect(target.saved()?.highPointFormula).toBe('boatsBeaten');
    expect(target.saved()?.pointForComingToStart).toBe(true);
    expect(target.saved()?.scoringCodes?.map((c) => c.countsInFleetSize)).toEqual([true, false]);
  });

  it('carries a penalty code that takes a share of the boat’s points, and the penalty', async () => {
    const CMP = { code: 'CMP', description: 'Finish not declared', kind: 'add', rule: { type: 'reducePercent', percent: 30 }, discardable: true } as const;
    const penalised: SeriesSnapshot = {
      ...snapshot,
      series: { ...series, scoringCodes: [...series.scoringCodes!, CMP] },
      finishes: [{ ...makeFinish('c1', 1), penaltyCode: 'CMP' }, makeFinish('c2', 2)],
    };
    const file = await buildSeriesFile('s1', makeFileRepos(penalised).repos);
    const reparsed = parseSeriesFile(JSON.stringify(file));
    const target = makeFileRepos();
    await openSeriesFromFile(reparsed, target.repos);
    expect(target.saved()?.scoringCodes?.at(-1)).toEqual(CMP);

    // Two boats, boats beaten with the start point: 3 for the win, less 30%.
    const data = buildPublicExportFromSnapshot(penalised)!;
    expect(data.series.scoringCodes?.at(-1)).toEqual(CMP);
    expect(data.standings[0].rows.find((r) => r.sailNumber === '101')!.racePoints).toEqual([2.1]);
  });

  it('writes no key for a low-point series', async () => {
    const file = await buildSeriesFile('s1', makeFileRepos({ ...snapshot, series: lowPoint }).repos);
    const written = JSON.parse(JSON.stringify(file)) as typeof file;
    expect(written.series).not.toHaveProperty('pointsSystem');
    expect(written.series).not.toHaveProperty('highPointFormula');
    expect(written.series).not.toHaveProperty('pointForComingToStart');
  });
});

describe('high point in the public JSON export', () => {
  it('carries the points system and restores it on import', async () => {
    const data = buildPublicExportFromSnapshot({ ...snapshot, series: { ...series, highPointFormula: 'chips3', pointForComingToStart: undefined } })!;
    expect(data.version).toBe(19);
    expect(data.series.pointsSystem).toBe('highPoint');
    expect(data.series.highPointFormula).toBe('chips3');

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
    await importPublicExport(JSON.parse(JSON.stringify(data)), repos);
    expect(saved?.pointsSystem).toBe('highPoint');
    expect(saved?.highPointFormula).toBe('chips3');
    expect(saved?.pointForComingToStart).toBeUndefined();
  });

  it('omits the keys for a low-point series', () => {
    const data = JSON.parse(JSON.stringify(buildPublicExportFromSnapshot({ ...snapshot, series: lowPoint })!));
    expect(data.series).not.toHaveProperty('pointsSystem');
    expect(data.series).not.toHaveProperty('highPointFormula');
  });
});

describe('pointsSystemFields', () => {
  it('carries nothing for low point, whatever is left behind', () => {
    expect(pointsSystemFields({ pointsSystem: 'lowPoint', highPointFormula: 'chips3', pointForComingToStart: true }))
      .toEqual({ pointsSystem: undefined, highPointFormula: undefined, pointForComingToStart: undefined });
  });

  it('names the formula in high point, and keeps the start point for boats beaten alone', () => {
    expect(pointsSystemFields({ pointsSystem: 'highPoint' }))
      .toEqual({ pointsSystem: 'highPoint', highPointFormula: 'boatsBeaten', pointForComingToStart: undefined });
    expect(pointsSystemFields({ pointsSystem: 'highPoint', highPointFormula: 'chips3', pointForComingToStart: true }).pointForComingToStart)
      .toBeUndefined();
  });
});

describe('the series schema', () => {
  it('accepts the points systems and formulas there are, and nothing else', () => {
    expect(seriesSchema.shape.pointsSystem.safeParse('highPoint').success).toBe(true);
    expect(seriesSchema.shape.pointsSystem.safeParse('bonusPoint').success).toBe(false);
    expect(seriesSchema.shape.highPointFormula.safeParse('chips3').success).toBe(true);
    expect(seriesSchema.shape.highPointFormula.safeParse('rinderle').success).toBe(false);
  });
});
