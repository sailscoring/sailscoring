import { describe, it, expect } from 'vitest';

import {
  openSeriesFromFile,
  type SeriesFile,
  type SeriesFileRepos,
} from '@/lib/series-file';
import type { Series, Fleet, Competitor, Race, RaceStart, Finish } from '@/lib/types';

// In-memory fake of the repository surface the open path needs, recording
// writes — mirrors tests/series-file-start-sequence.test.ts.
function makeRepos(): SeriesFileRepos & {
  savedSeries: Series[];
  savedFleets: Fleet[];
} {
  let series: Series | undefined;
  const savedSeries: Series[] = [];
  const savedFleets: Fleet[] = [];

  return {
    savedSeries,
    savedFleets,
    seriesRepo: {
      async get(id: string) {
        return series && id === series.id ? series : undefined;
      },
      async save(s: Series) {
        series = s;
        savedSeries.push(s);
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
    raceRatingOverrideRepo: { listByRaces: async () => [], saveMany: async () => {}, delete: async () => {}, deleteByRaces: async () => {} } as unknown as SeriesFileRepos['raceRatingOverrideRepo'],
    finishRepo: {
      async saveMany(_: Finish[]) {},
    } as unknown as SeriesFileRepos['finishRepo'],
    async listSeriesNames() {
      return [];
    },
    async deleteSeriesChildren() {},
  };
}

// A v15 file whose publishing groups reference the file's own fleet ids. On
// import those fleets are re-keyed to fresh UUIDs, so the group membership
// must follow them rather than keep the stale refs.
function makeFile(): SeriesFile {
  return {
    formatVersion: 15,
    seriesId: 'file-series',
    exportedAt: '2026-07-01T00:00:00.000Z',
    series: {
      id: 'file-series',
      name: 'Autumn League',
      venue: 'HYC',
      startDate: '2026-09-01',
      endDate: '2026-10-30',
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
      subdivisionAxes: [],
      publishIndividualFleetPages: false,
      publishingGroups: [
        {
          id: 'group-overall',
          name: 'Overall',
          fleetMode: 'all',
          fleetIds: [],
          detail: 'standings',
        },
        {
          id: 'group-pups',
          name: 'Puppeteer',
          fleetMode: 'chosen',
          fleetIds: ['file-fleet-a', 'file-fleet-b', 'file-fleet-gone'],
          detail: 'full',
        },
      ],
    },
    fleets: [
      { id: 'file-fleet-a', name: 'Puppeteer Scratch', displayOrder: 0, scoringSystem: 'scratch' },
      { id: 'file-fleet-b', name: 'Puppeteer HPH', displayOrder: 1, scoringSystem: 'py' },
    ],
    competitors: [],
    races: [],
  };
}

describe('publishingGroups fleet remap on import (v15)', () => {
  it('openSeriesFromFile re-keys chosen members onto the new fleet ids and drops stale refs', async () => {
    const repos = makeRepos();
    await openSeriesFromFile(makeFile(), repos);

    const saved = repos.savedSeries.at(-1)!;
    const idByName = new Map(repos.savedFleets.map((f) => [f.name, f.id]));

    expect(saved.publishingGroups).toHaveLength(2);
    const [overall, pups] = saved.publishingGroups!;

    // 'all' mode carries no ids and passes through unchanged.
    expect(overall).toMatchObject({ name: 'Overall', fleetMode: 'all', fleetIds: [] });

    // Chosen members follow the freshly minted fleet ids; the reference to a
    // fleet absent from the file is dropped.
    expect(pups.fleetIds).toEqual([
      idByName.get('Puppeteer Scratch'),
      idByName.get('Puppeteer HPH'),
    ]);
    expect(pups.fleetIds).not.toContain('file-fleet-a');
    // The series-level toggle rides along.
    expect(saved.publishIndividualFleetPages).toBe(false);
    expect(pups.fleetIds).not.toContain('file-fleet-gone');
    // The rest of the group config round-trips verbatim.
    expect(pups).toMatchObject({
      name: 'Puppeteer',
      detail: 'full',
    });
  });

  it('a pre-v15 file loads with no publishing groups', async () => {
    const file = makeFile();
    file.formatVersion = 14;
    delete file.series.publishingGroups;
    delete file.series.publishIndividualFleetPages;
    const repos = makeRepos();
    await openSeriesFromFile(file, repos);
    expect(repos.savedSeries.at(-1)!.publishingGroups).toEqual([]);
    expect(repos.savedSeries.at(-1)!.publishIndividualFleetPages).toBe(true);
  });
});
