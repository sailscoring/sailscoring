import { describe, it, expect } from 'vitest';

import { defaultSplitFleetConfig } from '@/lib/split-fleets';
import {
  openSeriesFromFile,
  updateSeriesFromFile,
  type SeriesFile,
  type SeriesFileRepos,
  type SeriesFileSplitFleetsWrite,
} from '@/lib/series-file';
import type { Series, Fleet, Competitor, Race } from '@/lib/types';

/**
 * The split-fleet block travels through `SeriesFileRepos.splitFleets.replace`,
 * which every bundle has to implement — the client one didn't, so an in-app
 * file open silently dropped a championship's format, rounds and assignments
 * (#365). These fakes record what the replay hands the repo.
 */
function makeRepos(): SeriesFileRepos & {
  savedFleets: Fleet[];
  savedCompetitors: Competitor[];
  replaceCalls: SeriesFileSplitFleetsWrite[];
} {
  let series: Series | undefined;
  const savedFleets: Fleet[] = [];
  const savedCompetitors: Competitor[] = [];
  const replaceCalls: SeriesFileSplitFleetsWrite[] = [];
  return {
    savedFleets,
    savedCompetitors,
    replaceCalls,
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
      async saveMany(c: Competitor[]) {
        savedCompetitors.push(...c);
      },
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
      saveMany: async () => {},
    } as unknown as SeriesFileRepos['raceStartRepo'],
    raceRatingOverrideRepo: {
      listByRaces: async () => [],
      saveMany: async () => {},
      delete: async () => {},
      deleteByRaces: async () => {},
    } as unknown as SeriesFileRepos['raceRatingOverrideRepo'],
    finishRepo: {
      saveMany: async () => {},
    } as unknown as SeriesFileRepos['finishRepo'],
    splitFleets: {
      get: async () => null,
      async replace(_seriesId: string, data: SeriesFileSplitFleetsWrite) {
        replaceCalls.push(data);
      },
    },
    async listSeriesNames() {
      return [];
    },
    async deleteSeriesChildren() {},
  };
}

const CONFIG = defaultSplitFleetConfig(3);

/** A two-fleet, two-boat championship carrying one qualifying round with a
 *  manual placement, all keyed by the file's own (non-UUID) ids. */
function makeFile(opts: { splitFleets?: boolean } = {}): SeriesFile {
  return {
    formatVersion: 23,
    seriesId: 'file-series',
    exportedAt: '2026-08-01T00:00:00.000Z',
    series: {
      id: 'file-series',
      name: 'Worlds',
      venue: 'Dun Laoghaire',
      startDate: '2026-08-23',
      endDate: '2026-08-30',
      venueLogoUrl: '',
      eventLogoUrl: '',
      discardThresholds: [],
      dnfScoring: 'seriesEntries',
      ftpHost: '',
      ftpPath: '',
      includeJsonExport: true,
      enabledCompetitorFields: ['boatName'],
      primaryPersonLabel: 'helm',
      scoringMode: 'scratch',
    },
    fleets: [
      {
        id: 'file-fleet-yellow',
        name: 'Yellow',
        displayOrder: 0,
        scoringSystem: 'scratch',
        color: '#eab308',
      },
      { id: 'file-fleet-blue', name: 'Blue', displayOrder: 1, scoringSystem: 'scratch' },
    ],
    competitors: [
      {
        id: 'file-comp-1',
        fleetIds: ['file-fleet-yellow'],
        sailNumber: 'IRL1',
        names: ['A. Sailor'],
        club: '',
        gender: '',
        age: null,
      },
      {
        id: 'file-comp-2',
        fleetIds: ['file-fleet-blue'],
        sailNumber: 'IRL2',
        names: ['B. Sailor'],
        club: '',
        gender: '',
        age: null,
      },
    ],
    races: [],
    ...(opts.splitFleets === false
      ? {}
      : {
          splitFleets: {
            config: CONFIG,
            rounds: [
              {
                id: 'file-round-1',
                stage: 'qualifying',
                fromStageRace: 1,
                fleetIds: ['file-fleet-yellow', 'file-fleet-blue'],
                method: 'seeded',
                basis: null,
                overrides: { 'file-comp-2': 'file-fleet-yellow' },
                createdAt: 1_754_000_000_000,
              },
            ],
          },
        }),
  } as unknown as SeriesFile;
}

describe('split-fleet block on file import', () => {
  it('replays the config and rounds, remapped onto the freshly minted ids', async () => {
    const repos = makeRepos();
    await openSeriesFromFile(makeFile(), repos);

    expect(repos.replaceCalls).toHaveLength(1);
    const [written] = repos.replaceCalls;
    expect(written.config).toEqual(CONFIG);
    expect(written.rounds).toHaveLength(1);

    const fleetIdByName = new Map(repos.savedFleets.map((f) => [f.name, f.id]));
    const competitorIdBySail = new Map(
      repos.savedCompetitors.map((c) => [c.sailNumber, c.id]),
    );
    const round = written.rounds[0];
    expect(round.fleetIds).toEqual([
      fleetIdByName.get('Yellow'),
      fleetIdByName.get('Blue'),
    ]);
    expect(round.overrides).toEqual({
      [competitorIdBySail.get('IRL2')!]: fleetIdByName.get('Yellow')!,
    });

    // The round itself gets a fresh id — the file's is another workspace's row.
    expect(round.id).not.toBe('file-round-1');
    expect(round.stage).toBe('qualifying');
    expect(round.method).toBe('seeded');
    expect(round.createdAt).toBe(1_754_000_000_000);
  });

  it('drops references the import didn’t carry over', async () => {
    const file = makeFile();
    file.splitFleets!.rounds[0].fleetIds = ['file-fleet-yellow', 'no-such-fleet'];
    file.splitFleets!.rounds[0].overrides = {
      'file-comp-1': 'no-such-fleet',
      'no-such-competitor': 'file-fleet-blue',
    };
    const repos = makeRepos();
    await openSeriesFromFile(file, repos);

    const fleetIdByName = new Map(repos.savedFleets.map((f) => [f.name, f.id]));
    const round = repos.replaceCalls[0].rounds[0];
    expect(round.fleetIds).toEqual([fleetIdByName.get('Yellow')]);
    expect(round.overrides).toEqual({});
  });

  it('carries the colour a round gave its fleets', async () => {
    // The medal fleet's colour lives on the fleet and nowhere else, so a file
    // that drops it publishes that fleet untinted after a round-trip.
    const repos = makeRepos();
    await openSeriesFromFile(makeFile(), repos);
    const byName = new Map(repos.savedFleets.map((f) => [f.name, f]));
    expect(byName.get('Yellow')?.color).toBe('#eab308');
    expect(byName.get('Blue')?.color).toBeUndefined();
  });

  it('leaves a series with no split-fleet state alone when the file has none', async () => {
    const repos = makeRepos();
    await openSeriesFromFile(makeFile({ splitFleets: false }), repos);
    expect(repos.replaceCalls).toEqual([]);
  });

  it('clears the series’ split-fleet state when a blockless file replays over it', async () => {
    const repos = makeRepos();
    const seriesId = await openSeriesFromFile(makeFile(), repos);
    expect(repos.replaceCalls).toHaveLength(1);

    await updateSeriesFromFile(seriesId, makeFile({ splitFleets: false }), repos);

    // Split rounds cascade from the series row, which survives an in-place
    // replay — so an explicit clear is the only thing that removes them.
    expect(repos.replaceCalls).toHaveLength(2);
    expect(repos.replaceCalls[1]).toEqual({ config: null, rounds: [] });
  });
});

describe('the seeding committee\u2019s fields on file import', () => {
  it('carries the seeding rank and the initial fleet onto the saved competitors', async () => {
    const file = makeFile();
    file.competitors[0].seed = 3;
    file.competitors[0].initialFleet = 'Yellow';
    file.competitors[1].initialFleet = 'Blue';

    const repos = makeRepos();
    await openSeriesFromFile(file, repos);

    const bySail = new Map(repos.savedCompetitors.map((c) => [c.sailNumber, c]));
    expect(bySail.get('IRL1')?.seed).toBe(3);
    expect(bySail.get('IRL1')?.initialFleet).toBe('Yellow');
    // The assignment is the committee's, not a fleet reference: it is the
    // label as written, and survives even though IRL2 carries no rank.
    expect(bySail.get('IRL2')?.seed).toBeUndefined();
    expect(bySail.get('IRL2')?.initialFleet).toBe('Blue');
  });

  it('leaves both absent when the file carries neither', async () => {
    const repos = makeRepos();
    await openSeriesFromFile(makeFile(), repos);
    for (const c of repos.savedCompetitors) {
      expect(c.seed).toBeUndefined();
      expect(c.initialFleet).toBeUndefined();
    }
  });
});
