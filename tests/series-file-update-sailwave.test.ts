import { describe, it, expect, beforeEach } from 'vitest';

import { updateSeriesFromSailwave, type SeriesFile, type SeriesFileRepos } from '@/lib/series-file';
import type {
  Series,
  Fleet,
  Competitor,
  Race,
  RaceStart,
  Finish,
} from '@/lib/types';

// ── In-memory fake of the repository surface updateSeriesFromSailwave needs.
// Records writes so the test can assert what landed without a database.
function makeRepos(initial: {
  series: Series;
  fleets: Fleet[];
}): SeriesFileRepos & {
  savedSeries: Series[];
  savedFleets: Fleet[];
  savedCompetitors: Competitor[];
  savedRaces: Race[];
  deletedChildrenOf: string[];
} {
  let series = initial.series;
  let fleets = initial.fleets;
  const savedSeries: Series[] = [];
  const savedFleets: Fleet[] = [];
  const savedCompetitors: Competitor[] = [];
  const savedRaces: Race[] = [];
  const deletedChildrenOf: string[] = [];

  return {
    savedSeries,
    savedFleets,
    savedCompetitors,
    savedRaces,
    deletedChildrenOf,
    seriesRepo: {
      async get(id: string) {
        return id === series.id ? series : undefined;
      },
      async save(s: Series) {
        series = s;
        savedSeries.push(s);
        return s;
      },
    } as unknown as SeriesFileRepos['seriesRepo'],
    fleetRepo: {
      async listBySeries() {
        return fleets;
      },
      async saveMany(f: Fleet[]) {
        savedFleets.push(...f);
        fleets = f;
      },
    } as unknown as SeriesFileRepos['fleetRepo'],
    competitorRepo: {
      async saveMany(c: Competitor[]) {
        savedCompetitors.push(...c);
      },
    } as unknown as SeriesFileRepos['competitorRepo'],
    raceRepo: {
      async save(r: Race) {
        savedRaces.push(r);
        return r;
      },
    } as unknown as SeriesFileRepos['raceRepo'],
    subSeriesRepo: {
      listBySeries: async () => [],
      saveMany: async () => {},
      deleteBySeries: async () => {},
    } as unknown as SeriesFileRepos['subSeriesRepo'],
    raceStartRepo: {
      async saveMany(_: RaceStart[]) {},
    } as unknown as SeriesFileRepos['raceStartRepo'],
    raceRatingOverrideRepo: { listByRaces: async () => [], saveMany: async () => {}, delete: async () => {}, deleteByRaces: async () => {} } as unknown as SeriesFileRepos['raceRatingOverrideRepo'],
    finishRepo: {
      async saveMany(_: Finish[]) {},
    } as unknown as SeriesFileRepos['finishRepo'],
    async listSeriesNames() {
      return [];
    },
    async deleteSeriesChildren(id: string) {
      deletedChildrenOf.push(id);
    },
  };
}

function makeSeries(over: Partial<Series>): Series {
  return {
    id: 'series-1',
    name: 'Autumn League',
    venue: 'HYC',
    startDate: '2026-09-01',
    endDate: '2026-10-30',
    venueLogoUrl: 'venue.png',
    eventLogoUrl: 'event.png',
    venueUrl: 'www.hyc.ie',
    eventUrl: 'www.event.ie',
    createdAt: 1000,
    lastSavedAt: 5000,
    lastModifiedAt: 5000,
    scoringMode: 'handicap',
    defaultStartSequence: [{ fleetIds: ['old-fleet-a'], intervalMinutes: 0 }],
    discardThresholds: [{ minRaces: 4, discardCount: 1 }],
    dnfScoring: 'seriesEntries',
    ftpHost: 'ftp.hyc.ie',
    ftpPath: '/results',
    ftpPaths: { 'old-fleet-a': '/results/cruisers', 'old-fleet-b': '/results/whitesail' },
    includeJsonExport: true,
    publishRatingCalculations: false,
    showPerRaceRatingsInSummary: false,
    enabledCompetitorFields: ['boatName', 'club', 'nationality'],
    primaryPersonLabel: 'owner',
    subdivisionAxes: [{ id: 'ax-class', label: 'Class' }],
    categoryId: 'cat-1',
    archived: false,
    source: 'sailwave',
    version: 7,
    ...over,
  };
}

function makeFile(over: Partial<SeriesFile['series']> = {}): SeriesFile {
  return {
    formatVersion: 8,
    seriesId: 'file-series',
    exportedAt: '2026-05-01T00:00:00.000Z',
    series: {
      id: 'file-series',
      name: 'FILE NAME (should be ignored)',
      venue: 'FILE VENUE (ignored)',
      startDate: '2027-01-01',
      endDate: '2027-02-01',
      venueLogoUrl: '',
      eventLogoUrl: '',
      discardThresholds: [{ minRaces: 6, discardCount: 2 }],
      dnfScoring: 'startingArea',
      ftpHost: '',
      ftpPath: '',
      includeJsonExport: true,
      enabledCompetitorFields: ['boatName'],
      primaryPersonLabel: 'helm',
      scoringMode: 'handicap',
      ...over,
    },
    // Two fleets; "Cruisers" matches the existing fleet name, "Mixed" is new.
    fleets: [
      { id: 'new-fleet-cruisers', name: 'Cruisers', displayOrder: 0, scoringSystem: 'nhc' },
      { id: 'new-fleet-mixed', name: 'Mixed', displayOrder: 1, scoringSystem: 'irc' },
    ],
    competitors: [
      {
        id: 'c1',
        fleetIds: ['new-fleet-cruisers'],
        sailNumber: 'IRL 1',
        names: ['Boat One'],
        club: 'HYC',
        gender: '',
        age: null,
      },
    ],
    races: [
      {
        id: 'r1',
        raceNumber: 1,
        date: '2027-01-05',
        starts: [{ id: 's1', fleetIds: ['new-fleet-cruisers'], startTime: '11:00:00' }],
        finishes: [
          {
            id: 'f1',
            competitorId: 'c1',
            sortOrder: 1,
            resultCode: null,
            startPresent: null,
            penaltyCode: null,
            penaltyOverride: null,
          },
        ],
      },
    ],
  };
}

describe('updateSeriesFromSailwave', () => {
  let repos: ReturnType<typeof makeRepos>;

  beforeEach(() => {
    repos = makeRepos({
      series: makeSeries({}),
      // Existing fleets: "Cruisers" (will match the file by name) keyed by
      // old-fleet-a, plus "Whitesail" (no match in the new file) at old-fleet-b.
      fleets: [
        { id: 'old-fleet-a', seriesId: 'series-1', name: 'Cruisers', displayOrder: 0, scoringSystem: 'nhc' },
        { id: 'old-fleet-b', seriesId: 'series-1', name: 'Whitesail', displayOrder: 1, scoringSystem: 'echo' },
      ],
    });
  });

  it('clears the existing children before writing the new ones', async () => {
    await updateSeriesFromSailwave('series-1', makeFile(), repos);
    expect(repos.deletedChildrenOf).toEqual(['series-1']);
    // New competition data landed.
    expect(repos.savedFleets.map((f) => f.name)).toEqual(['Cruisers', 'Mixed']);
    expect(repos.savedCompetitors).toHaveLength(1);
    expect(repos.savedRaces).toHaveLength(1);
  });

  it('preserves the series identity and publishing config from the existing series', async () => {
    await updateSeriesFromSailwave('series-1', makeFile(), repos);
    const saved = repos.savedSeries.at(-1)!;
    // Retained from the existing series, NOT the file:
    expect(saved.name).toBe('Autumn League');
    expect(saved.venue).toBe('HYC');
    expect(saved.startDate).toBe('2026-09-01');
    expect(saved.ftpHost).toBe('ftp.hyc.ie');
    expect(saved.ftpPath).toBe('/results');
    expect(saved.includeJsonExport).toBe(true);
    expect(saved.publishRatingCalculations).toBe(false);
    expect(saved.showPerRaceRatingsInSummary).toBe(false);
    expect(saved.enabledCompetitorFields).toEqual(['boatName', 'club', 'nationality']);
    expect(saved.primaryPersonLabel).toBe('owner');
    expect(saved.subdivisionAxes).toEqual([{ id: 'ax-class', label: 'Class' }]);
    expect(saved.categoryId).toBe('cat-1');
    expect(saved.source).toBe('sailwave');
  });

  it('takes scoring rules from the file and drops the stale start sequence', async () => {
    await updateSeriesFromSailwave('series-1', makeFile(), repos);
    const saved = repos.savedSeries.at(-1)!;
    expect(saved.discardThresholds).toEqual([{ minRaces: 6, discardCount: 2 }]);
    expect(saved.dnfScoring).toBe('startingArea');
    // defaultStartSequence keyed old fleet ids that no longer exist.
    expect(saved.defaultStartSequence).toBeUndefined();
  });

  it('re-keys ftpPaths from old fleet ids to new ones by matching fleet name', async () => {
    await updateSeriesFromSailwave('series-1', makeFile(), repos);
    const saved = repos.savedSeries.at(-1)!;
    const newCruisersId = repos.savedFleets.find((f) => f.name === 'Cruisers')!.id;
    // "Cruisers" path carries over onto the new fleet id; "Whitesail" had no
    // match in the new file, so its destination is dropped.
    expect(saved.ftpPaths).toEqual({ [newCruisersId]: '/results/cruisers' });
  });

  it('bumps lastModifiedAt but leaves lastSavedAt untouched', async () => {
    const before = Date.now();
    await updateSeriesFromSailwave('series-1', makeFile(), repos);
    const saved = repos.savedSeries.at(-1)!;
    expect(saved.lastModifiedAt).toBeGreaterThanOrEqual(before);
    expect(saved.lastSavedAt).toBe(5000);
  });

  it('throws when the series does not exist', async () => {
    await expect(updateSeriesFromSailwave('missing', makeFile(), repos)).rejects.toThrow(
      /not found/,
    );
  });
});
