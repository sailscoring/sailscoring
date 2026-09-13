import { describe, it, expect } from 'vitest';

import {
  openSeriesFromFile,
  updateSeriesFromFile,
  type SeriesFile,
  type SeriesFileRepos,
} from '@/lib/series-file';
import type { Series, Fleet, Competitor, Race, RaceStart, Finish } from '@/lib/types';

// In-memory fake of the repository surface open/update need, recording writes.
function makeRepos(initialSeries?: Series): SeriesFileRepos & {
  savedSeries: Series[];
  savedFleets: Fleet[];
  savedStarts: RaceStart[];
} {
  let series = initialSeries;
  const savedSeries: Series[] = [];
  const savedFleets: Fleet[] = [];
  const savedStarts: RaceStart[] = [];

  return {
    savedSeries,
    savedFleets,
    savedStarts,
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
      async saveMany(starts: RaceStart[]) {
        savedStarts.push(...starts);
      },
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

// A file whose defaultStartSequence references the file's own (non-UUID) fleet
// ids. On import those fleets are re-keyed to fresh UUIDs, so the start
// sequence must follow them rather than keep the stale refs.
function makeFile(): SeriesFile {
  return {
    formatVersion: 6,
    seriesId: 'file-series',
    exportedAt: '2026-05-01T00:00:00.000Z',
    series: {
      id: 'file-series',
      name: 'Autumn League',
      venue: 'HYC',
      startDate: '2026-09-01',
      endDate: '2026-10-30',
      venueLogoUrl: '',
      eventLogoUrl: '',
      discardThresholds: [{ minRaces: 4, discardCount: 1 }],
      dnfScoring: 'seriesEntries',
      ftpHost: '',
      ftpPath: '',
      includeJsonExport: true,
      enabledCompetitorFields: ['boatName'],
      primaryPersonLabel: 'helm',
      scoringMode: 'handicap',
      defaultStartSequence: [
        { fleetIds: ['file-fleet-a'], intervalMinutes: 0 },
        { fleetIds: ['file-fleet-b'], intervalMinutes: 5 },
      ],
    },
    fleets: [
      { id: 'file-fleet-a', name: 'Cruisers', displayOrder: 0, scoringSystem: 'nhc' },
      { id: 'file-fleet-b', name: 'Whitesail', displayOrder: 1, scoringSystem: 'echo' },
    ],
    competitors: [],
    races: [],
  };
}

/** The start sequence should reference the freshly-minted fleet ids (by name),
 *  never the file's original ids. */
function expectRemapped(saved: Series, fleets: Fleet[]) {
  const idByName = new Map(fleets.map((f) => [f.name, f.id]));
  expect(saved.defaultStartSequence).toEqual([
    { fleetIds: [idByName.get('Cruisers')], intervalMinutes: 0 },
    { fleetIds: [idByName.get('Whitesail')], intervalMinutes: 5 },
  ]);
  // And none of the original file ids leak through.
  const refs = saved.defaultStartSequence!.flatMap((g) => g.fleetIds);
  expect(refs).not.toContain('file-fleet-a');
  expect(refs).not.toContain('file-fleet-b');
}

describe('defaultStartSequence fleet remap on import', () => {
  it('openSeriesFromFile re-keys the start sequence onto the new fleet ids', async () => {
    const repos = makeRepos();
    await openSeriesFromFile(makeFile(), repos);
    expectRemapped(repos.savedSeries.at(-1)!, repos.savedFleets);
  });

  it('updateSeriesFromFile re-keys the start sequence onto the new fleet ids', async () => {
    const existing: Series = {
      id: 'series-1',
      name: 'Old',
      venue: '',
      startDate: '2026-01-01',
      endDate: '2026-01-02',
      venueLogoUrl: '',
      eventLogoUrl: '',
      venueUrl: '',
      eventUrl: '',
      createdAt: 1000,
      lastSavedAt: 1000,
      lastModifiedAt: 1000,
      scoringMode: 'handicap',
      defaultStartSequence: undefined,
      discardThresholds: [],
      dnfScoring: 'seriesEntries',
      ftpHost: '',
      ftpPath: '',
      ftpPaths: {},
      includeJsonExport: true,
      enabledCompetitorFields: ['boatName'],
      primaryPersonLabel: 'helm',
      subdivisionAxes: [],
      categoryId: null,
      archived: false,
      version: 1,
    };
    const repos = makeRepos(existing);
    await updateSeriesFromFile('series-1', makeFile(), repos);
    expectRemapped(repos.savedSeries.at(-1)!, repos.savedFleets);
  });
});

describe('a race start naming a fleet the file doesn’t carry', () => {
  /** A file whose start lists a fleet that is not in `fleets` — what a
   *  hand-edited file looks like when a fleet was removed and the start it
   *  was on wasn't. */
  function fileWithDanglingStart(): SeriesFile {
    const file = makeFile();
    file.races = [{
      id: 'file-race-1',
      raceNumber: 1,
      date: '2026-09-03',
      starts: [{
        id: 'file-start-1',
        fleetIds: ['file-fleet-a', 'file-fleet-gone'],
        startTime: '19:00:00',
      }],
      finishes: [],
    }];
    return file;
  }

  it('drops it rather than writing the id through', async () => {
    const repos = makeRepos();
    await openSeriesFromFile(fileWithDanglingStart(), repos);
    const idByName = new Map(repos.savedFleets.map((f) => [f.name, f.id]));
    expect(repos.savedStarts).toHaveLength(1);
    // Only the fleet the file actually carries, on its new id — a stale id
    // written through would stand in for a fleet name on the start, which is
    // how a raw UUID ends up on screen.
    expect(repos.savedStarts[0].fleetIds).toEqual([idByName.get('Cruisers')]);
    expect(repos.savedStarts[0].fleetIds).not.toContain('file-fleet-gone');
  });

  it('the update path drops it too — both share the writer', async () => {
    const existing: Series = {
      id: 'series-1', name: 'Old', venue: '', startDate: '2026-01-01', endDate: '2026-01-02',
      venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '',
      createdAt: 1000, lastSavedAt: 1000, lastModifiedAt: 1000,
      discardThresholds: [], dnfScoring: 'seriesEntries', ftpHost: '', ftpPath: '',
      includeJsonExport: true, enabledCompetitorFields: [], primaryPersonLabel: 'helm',
      scoringMode: 'handicap',
    } as unknown as Series;
    const repos = makeRepos(existing);
    await updateSeriesFromFile('series-1', fileWithDanglingStart(), repos);
    const idByName = new Map(repos.savedFleets.map((f) => [f.name, f.id]));
    expect(repos.savedStarts[0].fleetIds).toEqual([idByName.get('Cruisers')]);
  });
});
