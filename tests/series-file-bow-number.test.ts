import { describe, it, expect } from 'vitest';

import {
  buildSeriesFile,
  FORMAT_VERSION,
  openSeriesFromFile,
  type SeriesFile,
  type SeriesFileRepos,
} from '@/lib/series-file';
import type { Series, Fleet, Competitor, Race, RaceStart, Finish } from '@/lib/types';

// In-memory fake recording the competitors and finishes written on import, and
// serving a fixed snapshot back for the export direction — enough to prove the
// bow-number field (#234) survives the file round-trip in both directions.
function makeRepos(seed?: {
  series?: Series;
  fleets?: Fleet[];
  competitors?: Competitor[];
  races?: Race[];
  finishes?: Finish[];
}): SeriesFileRepos & {
  savedCompetitors: Competitor[];
  savedFinishes: Finish[];
} {
  let series: Series | undefined = seed?.series;
  const fleets: Fleet[] = seed?.fleets ?? [];
  const seedCompetitors = seed?.competitors ?? [];
  const seedRaces = seed?.races ?? [];
  const seedFinishes = seed?.finishes ?? [];
  const savedCompetitors: Competitor[] = [];
  const savedFinishes: Finish[] = [];
  return {
    savedCompetitors,
    savedFinishes,
    seriesRepo: {
      async get(id: string) {
        return series && id === series.id ? series : undefined;
      },
      async save(s: Series) {
        series = s;
        return s;
      },
    } as unknown as SeriesFileRepos['seriesRepo'],
    fleetRepo: {
      async listBySeries() {
        return fleets;
      },
      async saveMany(f: Fleet[]) {
        fleets.push(...f);
      },
    } as unknown as SeriesFileRepos['fleetRepo'],
    competitorRepo: {
      async listBySeries() {
        return seedCompetitors;
      },
      async saveMany(c: Competitor[]) {
        savedCompetitors.push(...c);
      },
    } as unknown as SeriesFileRepos['competitorRepo'],
    raceRepo: {
      async listBySeries() {
        return seedRaces;
      },
      async save(r: Race) {
        return r;
      },
    } as unknown as SeriesFileRepos['raceRepo'],
    subSeriesRepo: {
      listBySeries: async () => [],
      saveMany: async () => {},
      deleteBySeries: async () => {},
    } as unknown as SeriesFileRepos['subSeriesRepo'],
    raceStartRepo: {
      async listBySeries() {
        return [];
      },
      async saveMany(_: RaceStart[]) {},
    } as unknown as SeriesFileRepos['raceStartRepo'],
    raceRatingOverrideRepo: {
      listBySeries: async () => [],
      saveMany: async () => {},
      delete: async () => {},
      deleteByRaces: async () => {},
    } as unknown as SeriesFileRepos['raceRatingOverrideRepo'],
    finishRepo: {
      async listBySeries() {
        return seedFinishes;
      },
      async saveMany(f: Finish[]) {
        savedFinishes.push(...f);
      },
    } as unknown as SeriesFileRepos['finishRepo'],
    async listSeriesNames() {
      return [];
    },
    async deleteSeriesChildren() {},
  };
}

function baseSeries(): Series {
  return {
    id: 'file-series',
    name: 'Borrowed Hull Regatta',
    venue: 'HYC',
    startDate: '2026-06-01',
    endDate: '2026-06-02',
    venueLogoUrl: '',
    eventLogoUrl: '',
    discardThresholds: [],
    dnfScoring: 'seriesEntries',
    ftpHost: '',
    ftpPath: '',
    includeJsonExport: true,
    enabledCompetitorFields: ['bowNumber'],
    primaryPersonLabel: 'competitor',
    scoringMode: 'scratch',
  } as unknown as Series;
}

// A file carrying a competitor with a bow number distinct from the sail number,
// and a finish recorded by bow-number match.
function makeFile(): SeriesFile {
  return {
    formatVersion: 19,
    seriesId: 'file-series',
    exportedAt: '2026-06-01T00:00:00.000Z',
    series: baseSeries(),
    fleets: [{ id: 'file-fleet', name: 'Fleet', displayOrder: 0, scoringSystem: 'scratch' }],
    competitors: [
      {
        id: 'file-comp-1',
        fleetIds: ['file-fleet'],
        sailNumber: '567',
        bowNumber: '1234',
        name: 'Borrower',
        club: '',
        gender: '',
        age: null,
      },
    ],
    races: [
      {
        id: 'file-race-1',
        raceNumber: 1,
        date: '2026-06-01',
        starts: [],
        finishes: [
          {
            id: 'file-finish-1',
            competitorId: 'file-comp-1',
            matchedOnBowNumber: true,
            sortOrder: 1,
            resultCode: null,
            startPresent: null,
            penaltyCode: null,
            penaltyOverride: null,
          },
        ],
      },
    ],
  } as unknown as SeriesFile;
}

describe('bow-number field file round-trip (#234)', () => {
  it('imports competitor.bowNumber and finish.matchedOnBowNumber from a v19 file', async () => {
    const repos = makeRepos();
    await openSeriesFromFile(makeFile(), repos);

    expect(repos.savedCompetitors).toHaveLength(1);
    expect(repos.savedCompetitors[0].bowNumber).toBe('1234');
    expect(repos.savedCompetitors[0].sailNumber).toBe('567');

    expect(repos.savedFinishes).toHaveLength(1);
    expect(repos.savedFinishes[0].matchedOnBowNumber).toBe(true);
  });

  it('exports both fields back into the file (buildSeriesFile)', async () => {
    const series = baseSeries();
    const fleets: Fleet[] = [
      { id: 'fleet-1', name: 'Fleet', displayOrder: 0, scoringSystem: 'scratch' } as Fleet,
    ];
    const competitors: Competitor[] = [
      {
        id: 'comp-1',
        seriesId: series.id,
        fleetIds: ['fleet-1'],
        sailNumber: '567',
        bowNumber: '1234',
        name: 'Borrower',
        club: '',
        gender: '',
        age: null,
        createdAt: 0,
      },
    ];
    const races: Race[] = [
      { id: 'race-1', seriesId: series.id, raceNumber: 1, date: '2026-06-01' } as unknown as Race,
    ];
    const finishes: Finish[] = [
      {
        id: 'finish-1',
        raceId: 'race-1',
        competitorId: 'comp-1',
        matchedOnBowNumber: true,
        sortOrder: 1,
        tiedWithPrevious: false,
        resultCode: null,
        startPresent: null,
        penaltyCode: null,
        penaltyOverride: null,
        redressMethod: null,
        redressExcludeRaceIds: null,
        redressIncludeRaceIds: null,
        redressIncludeAllLater: false,
        redressPoints: null,
      },
    ];
    const repos = makeRepos({ series, fleets, competitors, races, finishes });

    const file = await buildSeriesFile(series.id, repos);

    expect(file.formatVersion).toBe(FORMAT_VERSION);
    expect(file.competitors[0].bowNumber).toBe('1234');
    expect(file.races[0].finishes[0].matchedOnBowNumber).toBe(true);
  });
});
