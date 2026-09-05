import { describe, it, expect } from 'vitest';

import {
  buildSeriesFile,
  FORMAT_VERSION,
  openSeriesFromFile,
  parseSeriesFile,
  type SeriesFile,
  type SeriesFileRepos,
} from '@/lib/series-file';
import type { Series, Fleet, Competitor, Race, RaceStart, Finish } from '@/lib/types';

/**
 * The excluded flag survives the .sailscoring round trip both ways, written
 * sparsely (only when true) so an entered boat's record is unchanged.
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
    club: '', gender: '', age: null, createdAt: 0, ...extra,
  };
}

describe('excluded competitor file round-trip', () => {
  it('writes the flag only for excluded boats', async () => {
    const series = baseSeries();
    const fleets = [{ id: 'fleet-1', name: 'Fleet', displayOrder: 0, scoringSystem: 'scratch' } as Fleet];
    const repos = makeRepos({
      series, fleets,
      competitors: [competitor('c1', '1'), competitor('c2', '2', { excluded: true })],
    });
    const file = await buildSeriesFile(series.id, repos);
    expect(file.formatVersion).toBe(FORMAT_VERSION);
    expect(file.competitors.find((c) => c.sailNumber === '1')).not.toHaveProperty('excluded');
    expect(file.competitors.find((c) => c.sailNumber === '2')?.excluded).toBe(true);
    // And the written file parses back as this version.
    const reparsed = parseSeriesFile(JSON.stringify(file));
    expect(reparsed.competitors.find((c) => c.sailNumber === '2')?.excluded).toBe(true);
  });

  it('carries the series-level all-DNC rule both ways', async () => {
    const series = { ...baseSeries(), excludeDncOnlyCompetitors: true } as Series;
    const fleets = [{ id: 'fleet-1', name: 'Fleet', displayOrder: 0, scoringSystem: 'scratch' } as Fleet];
    const file = await buildSeriesFile(series.id, makeRepos({ series, fleets, competitors: [competitor('c1', '1')] }));
    expect(file.series.excludeDncOnlyCompetitors).toBe(true);
    // Off is written as absence, so an older file's series is unchanged.
    const plain = await buildSeriesFile(series.id, makeRepos({ series: baseSeries(), fleets, competitors: [] }));
    expect(plain.series).not.toHaveProperty('excludeDncOnlyCompetitors');

    const repos = makeRepos();
    let saved: Series | undefined;
    repos.seriesRepo.save = async (s: Series) => { saved = s; return s; };
    await openSeriesFromFile(file, repos);
    expect(saved?.excludeDncOnlyCompetitors).toBe(true);
  });

  it('restores the flag on open, and leaves entered boats without one', async () => {
    const file = {
      formatVersion: 44,
      seriesId: 'file-series',
      exportedAt: '2026-06-01T00:00:00.000Z',
      series: baseSeries(),
      fleets: [{ id: 'file-fleet', name: 'Fleet', displayOrder: 0, scoringSystem: 'scratch' }],
      competitors: [
        { id: 'fc-1', fleetIds: ['file-fleet'], sailNumber: '1', names: ['One'], club: '', gender: '', age: null },
        { id: 'fc-2', fleetIds: ['file-fleet'], sailNumber: '2', names: ['Two'], club: '', gender: '', age: null, excluded: true },
      ],
      races: [],
    } as unknown as SeriesFile;
    const repos = makeRepos();
    await openSeriesFromFile(file, repos);
    const one = repos.savedCompetitors.find((c) => c.sailNumber === '1')!;
    const two = repos.savedCompetitors.find((c) => c.sailNumber === '2')!;
    expect(one.excluded).toBeUndefined();
    expect(two.excluded).toBe(true);
  });
});
