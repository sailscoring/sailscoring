import { describe, it, expect } from 'vitest';

import {
  openSeriesFromFile,
  type SeriesFile,
  type SeriesFileRepos,
} from '@/lib/series-file';
import type { Series, Fleet, Competitor, Race, RaceStart, Finish } from '@/lib/types';

// In-memory fake recording the fleets and finishes written on import, so we can
// assert the per-fleet RDG / DPI maps survive the round-trip and are re-keyed
// onto the freshly minted fleet ids.
function makeRepos(): SeriesFileRepos & {
  savedFleets: Fleet[];
  savedFinishes: Finish[];
} {
  let series: Series | undefined;
  const savedFleets: Fleet[] = [];
  const savedFinishes: Finish[] = [];
  return {
    savedFleets,
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
        return savedFleets;
      },
      async saveMany(f: Fleet[]) {
        savedFleets.push(...f);
      },
    } as unknown as SeriesFileRepos['fleetRepo'],
    competitorRepo: {
      async saveMany(_: Competitor[]) {},
    } as unknown as SeriesFileRepos['competitorRepo'],
    raceRepo: {
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
      async saveMany(_: RaceStart[]) {},
    } as unknown as SeriesFileRepos['raceStartRepo'],
    raceRatingOverrideRepo: {
      listByRaces: async () => [],
      saveMany: async () => {},
      delete: async () => {},
      deleteByRaces: async () => {},
    } as unknown as SeriesFileRepos['raceRatingOverrideRepo'],
    finishRepo: {
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

// A file with one boat scored in two fleets, carrying differing per-fleet
// stated redress points and a per-fleet DPI penalty, both keyed by the file's
// own (non-UUID) fleet ids.
function makeFile(): SeriesFile {
  return {
    formatVersion: 6,
    seriesId: 'file-series',
    exportedAt: '2026-05-01T00:00:00.000Z',
    series: {
      id: 'file-series',
      name: 'Cruisers League',
      venue: 'DBSC',
      startDate: '2026-05-01',
      endDate: '2026-09-30',
      venueLogoUrl: '',
      eventLogoUrl: '',
      discardThresholds: [],
      dnfScoring: 'seriesEntries',
      ftpHost: '',
      ftpPath: '',
      includeJsonExport: true,
      enabledCompetitorFields: ['boatName'],
      primaryPersonLabel: 'helm',
      scoringMode: 'handicap',
    },
    fleets: [
      { id: 'file-fleet-irc', name: 'IRC', displayOrder: 0, scoringSystem: 'irc' },
      { id: 'file-fleet-echo', name: 'ECHO', displayOrder: 1, scoringSystem: 'echo' },
    ],
    competitors: [
      {
        id: 'file-comp-1',
        fleetIds: ['file-fleet-irc', 'file-fleet-echo'],
        sailNumber: 'IRL1',
        name: 'Tandem',
        club: '',
        gender: '',
        age: null,
        ircTcc: 1.02,
        echoStartingTcf: 0.95,
      },
    ],
    races: [
      {
        id: 'file-race-1',
        raceNumber: 1,
        date: '2026-05-01',
        starts: [],
        finishes: [
          {
            id: 'file-finish-1',
            competitorId: 'file-comp-1',
            sortOrder: 1,
            resultCode: 'RDG',
            startPresent: null,
            penaltyCode: 'DPI',
            penaltyOverride: null,
            penaltyOverrideByFleet: { 'file-fleet-irc': 3, 'file-fleet-echo': 1 },
            redressMethod: 'stated',
            redressPoints: undefined,
            redressPointsByFleet: { 'file-fleet-irc': 8, 'file-fleet-echo': 2 },
          },
        ],
      },
    ],
  } as unknown as SeriesFile;
}

describe('per-fleet RDG / DPI points fleet remap on import', () => {
  it('re-keys the per-fleet maps onto the freshly minted fleet ids', async () => {
    const repos = makeRepos();
    await openSeriesFromFile(makeFile(), repos);

    const idByName = new Map(repos.savedFleets.map((f) => [f.name, f.id]));
    const ircId = idByName.get('IRC')!;
    const echoId = idByName.get('ECHO')!;

    expect(repos.savedFinishes).toHaveLength(1);
    const finish = repos.savedFinishes[0];

    // Maps survive the round-trip, re-keyed onto the new fleet ids.
    expect(finish.redressPointsByFleet).toEqual({ [ircId]: 8, [echoId]: 2 });
    expect(finish.penaltyOverrideByFleet).toEqual({ [ircId]: 3, [echoId]: 1 });

    // None of the file's original fleet ids leak through.
    const keys = [
      ...Object.keys(finish.redressPointsByFleet!),
      ...Object.keys(finish.penaltyOverrideByFleet!),
    ];
    expect(keys).not.toContain('file-fleet-irc');
    expect(keys).not.toContain('file-fleet-echo');
  });
});
