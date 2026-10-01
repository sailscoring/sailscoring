import { describe, it, expect } from 'vitest';

import {
  fleetOrcFamily,
  fleetTccVariant,
  ratingVariantFromOrcFamily,
  ratingVariantFromTcc,
  ratingVariantsFor,
} from '@/lib/fleet-rating-variant';
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
 * A fleet's non-standard certificate choice — the non-spinnaker TCC, or an
 * ORC non-spinnaker / double-handed certificate — is remembered on the fleet
 * so Update handicaps preselects it, and survives the .sailscoring round trip.
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

function fleet(id: string, system: Fleet['scoringSystem'], extra: Partial<Fleet> = {}): Fleet {
  return { id, seriesId: 'file-series', name: id, displayOrder: 0, scoringSystem: system, ...extra };
}

describe('fleet rating variant', () => {
  it('reads as each source\u2019s own choice, standard when absent', () => {
    expect(fleetTccVariant(fleet('f', 'irc'))).toBe('spin');
    expect(fleetTccVariant(fleet('f', 'irc', { ratingVariant: 'non-spin' }))).toBe('non-spin');
    expect(fleetOrcFamily(fleet('f', 'orc'))).toBe('ORC');
    expect(fleetOrcFamily(fleet('f', 'orc', { ratingVariant: 'non-spin' }))).toBe('NS');
    expect(fleetOrcFamily(fleet('f', 'orc', { ratingVariant: 'double-handed' }))).toBe('DH');
  });

  it('reads a double-handed choice left on an IRC fleet as standard', () => {
    expect(fleetTccVariant(fleet('f', 'irc', { ratingVariant: 'double-handed' }))).toBe('spin');
  });

  it('stores nothing for the standard choice', () => {
    expect(ratingVariantFromTcc('spin')).toBeUndefined();
    expect(ratingVariantFromTcc('non-spin')).toBe('non-spin');
    expect(ratingVariantFromOrcFamily('ORC')).toBeUndefined();
    expect(ratingVariantFromOrcFamily('NS')).toBe('non-spin');
    expect(ratingVariantFromOrcFamily('DH')).toBe('double-handed');
  });

  it('offers double-handed for ORC only, and nothing for unlisted systems', () => {
    expect(ratingVariantsFor('orc')).toEqual(['non-spin', 'double-handed']);
    expect(ratingVariantsFor('vprs')).toEqual(['non-spin']);
    expect(ratingVariantsFor('echo')).toEqual([]);
  });
});

describe('fleet rating variant file round-trip', () => {
  it('writes the choice on the fleets that have one, and nothing on the rest', async () => {
    const series = baseSeries();
    const file = await buildSeriesFile(series.id, makeRepos({
      series,
      fleets: [fleet('f-irc', 'irc'), fleet('f-ns', 'orc', { ratingVariant: 'non-spin' })],
    }));
    expect(file.formatVersion).toBe(FORMAT_VERSION);
    expect(FORMAT_VERSION).toBeGreaterThanOrEqual(63);
    expect(file.fleets.find((f) => f.name === 'f-ns')?.ratingVariant).toBe('non-spin');
    expect(file.fleets.find((f) => f.name === 'f-irc')).not.toHaveProperty('ratingVariant');
    expect(parseSeriesFile(JSON.stringify(file)).fleets.find((f) => f.name === 'f-ns')?.ratingVariant)
      .toBe('non-spin');
  });

  it('restores the choice on open, dropping a value it does not know', async () => {
    const repos = makeRepos();
    const savedFleets: Fleet[] = [];
    repos.fleetRepo.saveMany = async (f: Fleet[]) => { savedFleets.push(...f); };
    const file = {
      formatVersion: FORMAT_VERSION,
      seriesId: 'file-series',
      exportedAt: '2026-10-01T00:00:00.000Z',
      series: baseSeries(),
      fleets: [
        { id: 'a', name: 'Non-Spinnaker (ORC)', displayOrder: 0, scoringSystem: 'orc', ratingVariant: 'double-handed' },
        { id: 'b', name: 'Class 1 (IRC)', displayOrder: 1, scoringSystem: 'irc', ratingVariant: 'gennaker' },
      ],
      competitors: [],
      races: [],
    } as unknown as SeriesFile;

    await openSeriesFromFile(file, repos);
    expect(savedFleets.find((f) => f.name === 'Non-Spinnaker (ORC)')?.ratingVariant).toBe('double-handed');
    expect(savedFleets.find((f) => f.name === 'Class 1 (IRC)')).not.toHaveProperty('ratingVariant');
  });
});
