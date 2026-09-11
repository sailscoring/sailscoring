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
 * A fixed-TCF fleet survives the .sailscoring round trip: the club's name for
 * the handicap, each boat's number, and the per-race override that pins an
 * already-sailed race to the rating it was sailed under.
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

describe('fixed-TCF file round-trip', () => {
  function fixedTcfFleet(): Fleet {
    return {
      id: 'fleet-1', seriesId: 'file-series', name: 'Class 1 HPH', displayOrder: 0,
      scoringSystem: 'tcf', ratingLabel: 'HPH',
    } as Fleet;
  }

  it('writes the fleet label and the boats\' numbers', async () => {
    const series = baseSeries();
    const repos = makeRepos({
      series,
      fleets: [fixedTcfFleet()],
      competitors: [
        competitor('c1', '1405', { fixedTcf: 0.865 }),
        competitor('c2', '1410'),
      ],
    });
    const file = await buildSeriesFile(series.id, repos);
    expect(file.formatVersion).toBe(FORMAT_VERSION);
    expect(file.fleets[0]).toMatchObject({ scoringSystem: 'tcf', ratingLabel: 'HPH' });
    expect(file.competitors.find((c) => c.sailNumber === '1405')?.fixedTcf).toBe(0.865);
    // Sparse: an unrated boat carries no field at all.
    expect(file.competitors.find((c) => c.sailNumber === '1410')).not.toHaveProperty('fixedTcf');

    const reparsed = parseSeriesFile(JSON.stringify(file));
    expect(reparsed.fleets[0].ratingLabel).toBe('HPH');
    expect(reparsed.competitors.find((c) => c.sailNumber === '1405')?.fixedTcf).toBe(0.865);
  });

  it('leaves the label off a fleet the club has not named', async () => {
    const series = baseSeries();
    const fleet = { ...fixedTcfFleet(), ratingLabel: undefined } as Fleet;
    const file = await buildSeriesFile(series.id, makeRepos({
      series, fleets: [fleet], competitors: [competitor('c1', '1405', { fixedTcf: 0.865 })],
    }));
    expect(file.fleets[0]).not.toHaveProperty('ratingLabel');
  });

  it('restores the fleet, the ratings, and a fixedTcf race override on open', async () => {
    const overrides: RaceRatingOverride[] = [];
    const repos = makeRepos();
    const savedFleets: Fleet[] = [];
    repos.fleetRepo.saveMany = async (f: Fleet[]) => { savedFleets.push(...f); };
    repos.raceRatingOverrideRepo.saveMany = async (o: RaceRatingOverride[]) => { overrides.push(...o); };

    const file = {
      formatVersion: FORMAT_VERSION,
      seriesId: 'file-series',
      exportedAt: '2026-09-05T00:00:00.000Z',
      series: baseSeries(),
      fleets: [{ id: 'file-fleet', name: 'Class 1 HPH', displayOrder: 0, scoringSystem: 'tcf', ratingLabel: 'HPH' }],
      competitors: [
        { id: 'fc-1', fleetIds: ['file-fleet'], sailNumber: '1405', names: ['One'], clubs: [], gender: '', age: null, fixedTcf: 0.885 },
      ],
      races: [{
        id: 'file-race-1', raceNumber: 1, date: '2026-09-05', finishes: [], starts: [],
        ratingOverrides: [{ id: 'ro-1', competitorId: 'fc-1', field: 'fixedTcf', value: 0.865 }],
      }],
    } as unknown as SeriesFile;

    await openSeriesFromFile(file, repos);
    expect(savedFleets[0]).toMatchObject({ scoringSystem: 'tcf', ratingLabel: 'HPH' });
    expect(repos.savedCompetitors[0].fixedTcf).toBe(0.885);
    expect(overrides[0]).toMatchObject({ field: 'fixedTcf', value: 0.865 });
  });
});
