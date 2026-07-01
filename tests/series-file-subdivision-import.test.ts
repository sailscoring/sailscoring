import { describe, it, expect } from 'vitest';

import {
  openSeriesFromFile,
  updateSeriesFromFile,
  type SeriesFile,
  type SeriesFileRepos,
} from '@/lib/series-file';
import type { Series, Fleet, Competitor, Race, RaceStart, Finish } from '@/lib/types';

// In-memory fake recording the series and competitors written on import, so we
// can assert the synthesised subdivision axis id matches the id the competitors'
// `subdivisions` maps are keyed onto (regression for the double-mint that
// silently dropped every legacy subdivision value).
function makeRepos(): SeriesFileRepos & {
  savedSeries: Series[];
  savedCompetitors: Competitor[];
} {
  let series: Series | undefined;
  const savedSeries: Series[] = [];
  const savedCompetitors: Competitor[] = [];
  return {
    savedSeries,
    savedCompetitors,
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
        return [];
      },
      async saveMany(_: Fleet[]) {},
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
      async saveMany(_: RaceStart[]) {},
    } as unknown as SeriesFileRepos['raceStartRepo'],
    raceRatingOverrideRepo: {
      listByRaces: async () => [],
      saveMany: async () => {},
      delete: async () => {},
      deleteByRaces: async () => {},
    } as unknown as SeriesFileRepos['raceRatingOverrideRepo'],
    finishRepo: {
      async saveMany(_: Finish[]) {},
    } as unknown as SeriesFileRepos['finishRepo'],
    async listSeriesNames() {
      return [];
    },
    async deleteSeriesChildren() {},
  };
}

// A legacy (v6–v12) single-axis file: `series.subdivisionLabel` + a per-competitor
// `subdivision` string, with no v13 `subdivisionAxes` / `subdivisions` map.
function makeLegacyFile(): SeriesFile {
  return {
    formatVersion: 11,
    seriesId: 'file-series',
    exportedAt: '2026-05-01T00:00:00.000Z',
    series: {
      id: 'file-series',
      name: 'ILCA Leinsters',
      venue: 'SSC',
      startDate: '2026-06-28',
      endDate: '2026-06-28',
      venueLogoUrl: '',
      eventLogoUrl: '',
      discardThresholds: [],
      dnfScoring: 'seriesEntries',
      ftpHost: '',
      ftpPath: '',
      includeJsonExport: true,
      enabledCompetitorFields: ['subdivision'],
      subdivisionLabel: 'Division',
      primaryPersonLabel: 'helm',
      scoringMode: 'scratch',
    },
    fleets: [{ id: 'file-fleet', name: 'ILCA 6', displayOrder: 0, scoringSystem: 'scratch' }],
    competitors: [
      {
        id: 'file-comp-gold',
        fleetIds: ['file-fleet'],
        sailNumber: '211091',
        name: 'Gold Sailor',
        club: '',
        gender: '',
        age: null,
        subdivision: 'Gold',
      },
      {
        id: 'file-comp-silver',
        fleetIds: ['file-fleet'],
        sailNumber: '216101',
        name: 'Silver Sailor',
        club: '',
        gender: '',
        age: null,
        subdivision: 'Silver',
      },
    ],
    races: [],
  } as unknown as SeriesFile;
}

describe('legacy subdivision import: axis id survives to competitors', () => {
  it('keys each competitor onto the same axis id the series was saved with (openSeriesFromFile)', async () => {
    const repos = makeRepos();
    await openSeriesFromFile(makeLegacyFile(), repos);

    const series = repos.savedSeries.at(-1)!;
    expect(series.subdivisionAxes).toHaveLength(1);
    const axisId = series.subdivisionAxes[0].id;
    expect(series.subdivisionAxes[0].label).toBe('Division');

    const gold = repos.savedCompetitors.find((c) => c.name === 'Gold Sailor')!;
    const silver = repos.savedCompetitors.find((c) => c.name === 'Silver Sailor')!;

    // The bug: the competitors were keyed onto a *different* random axis id, so
    // these maps existed but never matched the series axis and rendered blank.
    expect(gold.subdivisions).toEqual({ [axisId]: 'Gold' });
    expect(silver.subdivisions).toEqual({ [axisId]: 'Silver' });
  });

  it('keys each competitor onto the series axis id on update-from-file too', async () => {
    const repos = makeRepos();
    // Seed an existing series so updateSeriesFromFile has something to replace.
    await repos.seriesRepo.save({ id: 'existing', subdivisionAxes: [] } as unknown as Series);

    await updateSeriesFromFile('existing', makeLegacyFile(), repos);

    const series = repos.savedSeries.at(-1)!;
    const axisId = series.subdivisionAxes[0].id;
    const gold = repos.savedCompetitors.find((c) => c.name === 'Gold Sailor')!;
    expect(gold.subdivisions).toEqual({ [axisId]: 'Gold' });
  });
});
