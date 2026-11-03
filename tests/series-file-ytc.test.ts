import { describe, it, expect } from 'vitest';

import {
  buildSeriesFile,
  FORMAT_VERSION,
  openSeriesFromFile,
  parseSeriesFile,
  type SeriesFile,
  type SeriesFileRepos,
} from '@/lib/series-file';
import type { Series, Fleet, Competitor, Race, RaceStart, RaceRatingOverride, Finish } from '@/lib/types';

/**
 * A YTC fleet survives the .sailscoring round trip: each boat's YTC number,
 * the fleet's white-sail choice, and the per-race override that pins an
 * already-sailed race to the number it was sailed under.
 */

function makeRepos(seed?: { series?: Series; fleets?: Fleet[]; competitors?: Competitor[] }): SeriesFileRepos & {
  savedCompetitors: Competitor[];
} {
  let series: Series | undefined = seed?.series;
  const fleets: Fleet[] = seed?.fleets ?? [];
  const seedCompetitors = seed?.competitors ?? [];
  const savedCompetitors: Competitor[] = [];
  return {
    savedCompetitors,
    seriesRepo: {
      async get(id: string) { return series && id === series.id ? series : undefined; },
      async save(s: Series) { series = s; return s; },
    } as unknown as SeriesFileRepos['seriesRepo'],
    fleetRepo: {
      async listBySeries() { return fleets; },
      async saveMany(f: Fleet[]) { fleets.push(...f); },
    } as unknown as SeriesFileRepos['fleetRepo'],
    competitorRepo: {
      async listBySeries() { return seedCompetitors; },
      async saveMany(c: Competitor[]) { savedCompetitors.push(...c); },
    } as unknown as SeriesFileRepos['competitorRepo'],
    raceRepo: {
      async listBySeries() { return []; },
      async save(r: Race) { return r; },
    } as unknown as SeriesFileRepos['raceRepo'],
    subSeriesRepo: {
      listBySeries: async () => [],
      saveMany: async () => {},
      deleteBySeries: async () => {},
    } as unknown as SeriesFileRepos['subSeriesRepo'],
    raceStartRepo: {
      async listBySeries() { return []; },
      async saveMany(_: RaceStart[]) {},
    } as unknown as SeriesFileRepos['raceStartRepo'],
    raceRatingOverrideRepo: {
      listBySeries: async () => [],
      saveMany: async () => {},
      delete: async () => {},
      deleteByRaces: async () => {},
    } as unknown as SeriesFileRepos['raceRatingOverrideRepo'],
    finishRepo: {
      async listBySeries() { return []; },
      async saveMany(_: Finish[]) {},
    } as unknown as SeriesFileRepos['finishRepo'],
    async listSeriesNames() { return []; },
    async deleteSeriesChildren() {},
  };
}

function baseSeries(): Series {
  return {
    id: 'file-series',
    name: 'Roster Series',
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
    enabledCompetitorFields: [],
    primaryPersonLabel: 'competitor',
    scoringMode: 'scratch',
  } as unknown as Series;
}

function competitor(id: string, sailNumber: string, extra: Partial<Competitor> = {}): Competitor {
  return {
    id, seriesId: 'file-series', fleetIds: ['fleet-1'], sailNumber, names: [sailNumber],
    clubs: [], gender: '', age: null, createdAt: 0, ...extra,
  };
}

describe('YTC file round-trip', () => {
  function ytcFleet(extra: Partial<Fleet> = {}): Fleet {
    return {
      id: 'fleet-1', seriesId: 'file-series', name: 'Cruisers YTC', displayOrder: 0,
      scoringSystem: 'ytc', ...extra,
    } as Fleet;
  }

  it('writes the fleet and the boats\' numbers', async () => {
    const series = baseSeries();
    const file = await buildSeriesFile(series.id, makeRepos({
      series,
      fleets: [ytcFleet({ ratingVariant: 'non-spin' })],
      competitors: [
        competitor('c1', 'IRL3062', { ytcNumber: 941 }),
        competitor('c2', '1558'),
      ],
    }));
    expect(file.formatVersion).toBe(FORMAT_VERSION);
    expect(FORMAT_VERSION).toBeGreaterThanOrEqual(76);
    expect(file.fleets[0]).toMatchObject({ scoringSystem: 'ytc', ratingVariant: 'non-spin' });
    expect(file.competitors.find((c) => c.sailNumber === 'IRL3062')?.ytcNumber).toBe(941);
    // Sparse: an unrated boat carries no field at all.
    expect(file.competitors.find((c) => c.sailNumber === '1558')).not.toHaveProperty('ytcNumber');

    const reparsed = parseSeriesFile(JSON.stringify(file));
    expect(reparsed.fleets[0].scoringSystem).toBe('ytc');
    expect(reparsed.competitors.find((c) => c.sailNumber === 'IRL3062')?.ytcNumber).toBe(941);
  });

  it('restores the fleet, the ratings, and a ytcNumber race override on open', async () => {
    const overrides: RaceRatingOverride[] = [];
    const repos = makeRepos();
    const savedFleets: Fleet[] = [];
    repos.fleetRepo.saveMany = async (f: Fleet[]) => { savedFleets.push(...f); };
    repos.raceRatingOverrideRepo.saveMany = async (o: RaceRatingOverride[]) => { overrides.push(...o); };

    const file = {
      formatVersion: FORMAT_VERSION,
      seriesId: 'file-series',
      exportedAt: '2026-11-03T00:00:00.000Z',
      series: baseSeries(),
      fleets: [{ id: 'file-fleet', name: 'Cruisers YTC', displayOrder: 0, scoringSystem: 'ytc' }],
      competitors: [
        { id: 'fc-1', fleetIds: ['file-fleet'], sailNumber: 'IRL3062', names: ['Gerry Daly'], clubs: [], gender: '', age: null, ytcNumber: 941 },
      ],
      races: [{
        id: 'file-race-1', raceNumber: 1, date: '2026-07-23', finishes: [], starts: [],
        ratingOverrides: [{ id: 'ro-1', competitorId: 'fc-1', field: 'ytcNumber', value: 920 }],
      }],
    } as unknown as SeriesFile;

    await openSeriesFromFile(file, repos);
    expect(savedFleets[0]).toMatchObject({ scoringSystem: 'ytc' });
    expect(repos.savedCompetitors[0].ytcNumber).toBe(941);
    expect(overrides[0]).toMatchObject({ field: 'ytcNumber', value: 920 });
  });
});
