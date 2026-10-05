import { describe, it, expect } from 'vitest';

import {
  buildSeriesFile,
  openSeriesFromFile,
  parseSeriesFile,
  type SeriesFile,
  type SeriesFileRepos,
} from '@/lib/series-file';
import type { Series, Fleet, Competitor, Race, RaceStart, Finish } from '@/lib/types';

/**
 * The venue position — where a course with no marks takes its magnetic
 * variation from — survives the .sailscoring round trip.
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

describe('venue position file round-trip', () => {
  it('is written where set, and nowhere else', async () => {
    const series = { ...baseSeries(), venuePosition: { lat: 51.8, lng: -8.3 } };
    const file = await buildSeriesFile(series.id, makeRepos({ series }));
    expect(parseSeriesFile(JSON.stringify(file)).series.venuePosition).toEqual({ lat: 51.8, lng: -8.3 });
    const without = await buildSeriesFile('file-series', makeRepos({ series: baseSeries() }));
    expect(without.series).not.toHaveProperty('venuePosition');
  });

  it('comes back on open', async () => {
    const repos = makeRepos();
    let saved: Series | undefined;
    const save = repos.seriesRepo.save.bind(repos.seriesRepo);
    repos.seriesRepo.save = async (s: Series) => { saved = s; return save(s); };
    const file = {
      formatVersion: 65,
      seriesId: 'file-series',
      exportedAt: '2026-10-05T00:00:00.000Z',
      series: { ...baseSeries(), venuePosition: { lat: 51.8, lng: -8.3 } },
      fleets: [],
      competitors: [],
      races: [],
    } as unknown as SeriesFile;
    await openSeriesFromFile(file, repos);
    expect(saved?.venuePosition).toEqual({ lat: 51.8, lng: -8.3 });
  });
});
