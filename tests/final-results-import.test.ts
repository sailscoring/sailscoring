/**
 * Importing a document that says the results are final.
 *
 * A series whose results are marked final is read-only: every write to it and
 * its children is refused by the guard that protects settled results. Both
 * import paths carry the lifecycle — a re-import that quietly reopened settled
 * results as provisional would be worse than not carrying it at all — so both
 * have to declare it *last*, on a series that by then holds everything it is
 * declaring final. Setting it on the write that creates the series locks the
 * import against itself, and the reader is told the series is "archived".
 */
import { describe, expect, it } from 'vitest';

import {
  buildSeriesFile,
  openSeriesFromFile,
  type SeriesFileRepos,
} from '@/lib/series-file';
import {
  buildPublicExportFromSnapshot,
  importPublicExport,
  type ImportRepos,
} from '@/lib/public-export';
import type { SeriesSnapshot } from '@/lib/series-snapshot';
import type { Competitor, Finish, Fleet, Race, Series } from '@/lib/types';

const FINALISED_AT = Date.parse('2026-08-30T18:00:00Z');

const series: Series = {
  id: 's1',
  name: 'Worlds',
  venue: 'Dun Laoghaire',
  startDate: '2026-08-23',
  endDate: '2026-08-30',
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
  enabledCompetitorFields: [],
  primaryPersonLabel: 'helm',
  subdivisionAxes: [],
  resultsStatus: 'final',
  finalisedAt: FINALISED_AT,
};

const fleet: Fleet = {
  id: 'fl-1', seriesId: 's1', name: 'ILCA 7', displayOrder: 0, scoringSystem: 'scratch',
};
const competitors: Competitor[] = [
  { id: 'c1', seriesId: 's1', fleetIds: ['fl-1'], sailNumber: '215001', names: ['Alice'], club: '', gender: '', age: null, createdAt: 0 },
  { id: 'c2', seriesId: 's1', fleetIds: ['fl-1'], sailNumber: '215002', names: ['Bob'], club: '', gender: '', age: null, createdAt: 0 },
];
const races: Race[] = [
  { id: 'r1', seriesId: 's1', raceNumber: 1, name: null, date: '2026-08-24', createdAt: 0 },
];
const finishes: Finish[] = [1, 2].map((n) => ({
  id: `r1-c${n}`, raceId: 'r1', competitorId: `c${n}`, sortOrder: n,
  tiedWithPrevious: false, resultCode: null, startPresent: null,
  penaltyCode: null, penaltyOverride: null, redressMethod: null,
  redressExcludeRaceIds: null, redressIncludeRaceIds: null,
  redressIncludeAllLater: false, redressPoints: null,
}));

const snapshot: SeriesSnapshot = {
  series, competitors, fleets: [fleet], races,
  subSeries: [], finishes, raceStarts: [], ratingOverrides: [],
};

/**
 * Repositories that record what was written, in order, and answer reads from
 * the fixture. `series` / `series:final` distinguish the two states the series
 * row is written in — which is the whole point of these tests.
 */
function makeOrderedRepos(read?: SeriesSnapshot) {
  const log: string[] = [];
  const savedSeries: Series[] = [];
  const note = (what: string) => () => { log.push(what); };
  const repos = {
    seriesRepo: {
      get: async (id: string) => (read && id === read.series.id ? read.series : undefined),
      save: async (s: Series) => {
        savedSeries.push(s);
        log.push(s.resultsStatus === 'final' ? 'series:final' : 'series');
        return s;
      },
    },
    fleetRepo: {
      listBySeries: async () => read?.fleets ?? [],
      save: async (f: Fleet) => { log.push('fleet'); return f; },
      saveMany: async () => { log.push('fleet'); },
    },
    competitorRepo: {
      listBySeries: async () => read?.competitors ?? [],
      save: async (c: Competitor) => { log.push('competitor'); return c; },
      saveMany: async () => { log.push('competitor'); },
    },
    raceRepo: {
      listBySeries: async () => read?.races ?? [],
      save: async (r: Race) => { log.push('race'); return r; },
    },
    subSeriesRepo: { listBySeries: async () => read?.subSeries ?? [], saveMany: note('sub-series') },
    finishRepo: {
      listBySeries: async () => read?.finishes ?? [],
      save: async (f: Finish) => { log.push('finish'); return f; },
      saveMany: note('finish'),
    },
    raceStartRepo: {
      listBySeries: async () => read?.raceStarts ?? [],
      save: note('start'),
      saveMany: note('start'),
    },
    raceRatingOverrideRepo: {
      listBySeries: async () => read?.ratingOverrides ?? [],
      listByRaces: async () => [],
      saveMany: note('rating-override'),
    },
    listSeriesNames: async () => [],
    deleteSeriesChildren: async () => {},
  };
  return {
    repos: repos as unknown as SeriesFileRepos & ImportRepos,
    log,
    savedSeries,
  };
}

/** What both paths must do with a document that declares its results final. */
function expectLifecycleLast(log: string[], savedSeries: Series[]): void {
  // Created provisional…
  expect(log[0]).toBe('series');
  // …every child written while it still is…
  expect(log.slice(1, -1)).not.toContain('series:final');
  expect(log.slice(1, -1).length).toBeGreaterThan(0);
  // …and declared final only once there is something to declare.
  expect(log.at(-1)).toBe('series:final');
  expect(savedSeries).toHaveLength(2);
  expect(savedSeries[0].resultsStatus).toBeUndefined();
  // The original date, not the date of the import: the results were settled
  // when the source event settled them.
  expect(savedSeries[1].finalisedAt).toBe(FINALISED_AT);
}

describe('importing a published export of a final series', () => {
  it('writes the series, then its contents, then the lifecycle', async () => {
    const data = buildPublicExportFromSnapshot(snapshot)!;
    expect(data.series.resultsStatus).toBe('final');
    const { repos, log, savedSeries } = makeOrderedRepos();
    await importPublicExport(data, repos);
    expectLifecycleLast(log, savedSeries);
  });

  it("leaves a provisional series at one save, with no lifecycle write", async () => {
    const provisional: SeriesSnapshot = {
      ...snapshot,
      series: { ...series, resultsStatus: undefined, finalisedAt: undefined },
    };
    const data = buildPublicExportFromSnapshot(provisional)!;
    const { repos, log, savedSeries } = makeOrderedRepos();
    await importPublicExport(data, repos);
    expect(log.filter((w) => w.startsWith('series'))).toEqual(['series']);
    expect(savedSeries.at(-1)!.resultsStatus).toBeUndefined();
  });
});

describe('opening a .sailscoring file of a final series', () => {
  it('writes the series, then its contents, then the lifecycle', async () => {
    const { repos: buildRepos } = makeOrderedRepos(snapshot);
    const file = await buildSeriesFile('s1', buildRepos);
    expect(file.series.resultsStatus).toBe('final');
    expect(file.series.finalisedAt).toBe(FINALISED_AT);

    const { repos, log, savedSeries } = makeOrderedRepos();
    await openSeriesFromFile(file, repos);
    expectLifecycleLast(log, savedSeries);
  });

  it("leaves a provisional file at one save, with no lifecycle write", async () => {
    const provisional: SeriesSnapshot = {
      ...snapshot,
      series: { ...series, resultsStatus: undefined, finalisedAt: undefined },
    };
    const { repos: buildRepos } = makeOrderedRepos(provisional);
    const file = await buildSeriesFile('s1', buildRepos);
    const { repos, log, savedSeries } = makeOrderedRepos();
    await openSeriesFromFile(file, repos);
    expect(log.filter((w) => w.startsWith('series'))).toEqual(['series']);
    expect(savedSeries.at(-1)!.resultsStatus).toBeUndefined();
  });
});
