/**
 * Custom scoring codes: the `.sailscoring` file (v74) and the public JSON
 * export (v14) carry `series.scoringCodes` sparsely — absent is the RRS
 * codes — and both import paths restore them. They are a scoring input, so
 * a re-scored export scores a series code as the series does.
 */
import { describe, it, expect } from 'vitest';
import { buildSeriesFile, openSeriesFromFile, type SeriesFileRepos } from '@/lib/series-file';
import { buildPublicExportFromSnapshot, importPublicExport, type ImportRepos } from '@/lib/public-export';
import { seriesScoringCodesSchema } from '@/lib/validation/series';
import type { SeriesSnapshot } from '@/lib/series-snapshot';
import type { Competitor, Finish, Fleet, Race, RaceStart, ResultCode, Series, SeriesScoringCode, SubSeries } from '@/lib/types';

const TLE: SeriesScoringCode = {
  code: 'TLE',
  description: 'Time limit expired (SI 16.1)',
  kind: 'replace',
  rule: { type: 'placeAfter', base: 'finishers', plus: 1 },
  capAtDnf: true,
  discardable: true,
};
const DNC_AS_DNF: SeriesScoringCode = { code: 'DNC', kind: 'replace', rule: { type: 'sameAs', code: 'DNF' }, discardable: true };

const series: Series = {
  id: 's1', name: 'Frostbites', venue: 'Howth Yacht Club', startDate: '2026-11-01', endDate: '',
  venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '', createdAt: 0, lastSavedAt: null,
  lastModifiedAt: 0, scoringMode: 'scratch', discardThresholds: [], dnfScoring: 'seriesEntries',
  scoringCodes: [TLE, DNC_AS_DNF],
  ftpHost: '', ftpPath: '', ftpPaths: {}, includeJsonExport: true, enabledCompetitorFields: [],
  primaryPersonLabel: 'helm', subdivisionAxes: [],
};

const fleet: Fleet = { id: 'fl-1', seriesId: 's1', name: 'ILCA 7', displayOrder: 0, scoringSystem: 'scratch' };

function makeCompetitor(id: string, sail: string): Competitor {
  return { id, seriesId: 's1', fleetIds: ['fl-1'], sailNumber: sail, names: [sail], clubs: [], gender: '', age: null, createdAt: 0 };
}

function makeFinish(competitorId: string, sortOrder: number | null, resultCode: string | null = null): Finish {
  return {
    id: `r1-${competitorId}`, raceId: 'r1', competitorId, sortOrder, tiedWithPrevious: false,
    resultCode: resultCode as ResultCode | null, startPresent: null, penaltyCode: null, penaltyOverride: null,
    redressMethod: null, redressExcludeRaceIds: null, redressIncludeRaceIds: null, redressIncludeAllLater: false,
    redressPoints: null,
  };
}

const snapshot: SeriesSnapshot = {
  series,
  competitors: ['101', '102', '103', '104', '105'].map((s, i) => makeCompetitor(`c${i + 1}`, s)),
  fleets: [fleet],
  races: [{ id: 'r1', seriesId: 's1', raceNumber: 1, name: null, date: '2026-11-01', createdAt: 0 }],
  subSeries: [],
  finishes: [makeFinish('c1', 1), makeFinish('c2', 2), makeFinish('c3', null, 'TLE')],
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

describe('scoring codes in the .sailscoring file', () => {
  it('writes the series’ codes and restores them on import', async () => {
    const file = await buildSeriesFile('s1', makeFileRepos(snapshot).repos);
    expect(file.series.scoringCodes).toEqual([TLE, DNC_AS_DNF]);
    const target = makeFileRepos();
    await openSeriesFromFile(file, target.repos);
    expect(target.saved()?.scoringCodes).toEqual([TLE, DNC_AS_DNF]);
  });

  it('writes no key for a series scoring the RRS codes', async () => {
    const plain = { ...snapshot, series: { ...series, scoringCodes: undefined }, finishes: [] };
    const file = await buildSeriesFile('s1', makeFileRepos(plain).repos);
    expect(file.series).not.toHaveProperty('scoringCodes');
  });
});

describe('scoring codes in the public JSON export', () => {
  it('carries the codes, scores a series code by them, and restores them on import', async () => {
    const data = buildPublicExportFromSnapshot(snapshot)!;
    expect(data.version).toBe(16);
    expect(data.series.scoringCodes).toEqual([TLE, DNC_AS_DNF]);
    const tle = data.standings[0].rows.find((r) => r.sailNumber === '103')!;
    // The place after the two finishers.
    expect(tle.raceCodes).toEqual(['TLE']);
    expect(tle.racePoints).toEqual([3]);

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
    expect(saved?.scoringCodes).toEqual([TLE, DNC_AS_DNF]);
  });
});

describe('the scoring-codes schema', () => {
  const problems = (codes: SeriesScoringCode[]) => {
    const r = seriesScoringCodesSchema.safeParse(codes);
    return r.success ? [] : r.error.issues.map((i) => i.message);
  };

  it('accepts a well-formed table', () => {
    expect(problems([TLE, DNC_AS_DNF])).toEqual([]);
  });

  it('refuses codes that differ only by case', () => {
    expect(problems([TLE, { ...TLE, code: 'tle' }])).toEqual([
      'tle: This series already has a code TLE. Codes can’t differ only by case.',
    ]);
  });

  it('refuses a case variant of an RRS code', () => {
    expect(problems([{ ...TLE, code: 'dnf' }])).toEqual([
      'dnf: dnf differs from the RRS code DNF only by case. Choose another code.',
    ]);
  });

  it('refuses a change to a code decided for each boat', () => {
    expect(problems([{ code: 'SCP', kind: 'add', rule: { type: 'addPoints', points: 2 }, discardable: true }])).toEqual([
      'SCP: SCP can’t be changed: its amount is decided for each boat when it is applied.',
    ]);
  });

  it('refuses a series code without a description', () => {
    expect(problems([{ ...TLE, description: ' ' }])).toEqual(['TLE: Description is required.']);
  });

  it('refuses a "same as" loop', () => {
    const a: SeriesScoringCode = { code: 'XPA', description: 'x', kind: 'replace', rule: { type: 'sameAs', code: 'TLE' }, discardable: true };
    const t: SeriesScoringCode = { ...TLE, rule: { type: 'sameAs', code: 'XPA' } };
    expect(problems([t, a])).toEqual([
      'TLE: TLE can’t score the same as XPA, which scores the same as TLE.',
      'XPA: XPA can’t score the same as TLE, which scores the same as XPA.',
    ]);
  });

  it('allows lower case', () => {
    expect(problems([{ ...TLE, code: 'RDGa' }])).toEqual([]);
  });
});
