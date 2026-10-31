/**
 * ADR-013: `dnfScoring: 'startingAreaInclDnc'` (DBSC SI A13.2) is gone; a
 * series stored with it reads as A5.3 with DNC changed to score the same as
 * DNF, and scores identically.
 */
import { describe, it, expect } from 'vitest';
import { DNC_SCORED_AS_DNF, upgradeDncRule } from '@/lib/dnc-rule-upgrade';
import { migrateSeriesFileObject } from '@/lib/series-file';

describe('upgradeDncRule', () => {
  it('turns the DBSC setting into A5.3 with DNC scored as DNF', () => {
    const series: Record<string, unknown> = { dnfScoring: 'startingAreaInclDnc' };
    upgradeDncRule(series);
    expect(series).toEqual({ dnfScoring: 'startingArea', scoringCodes: [DNC_SCORED_AS_DNF] });
  });

  it('keeps a series’ own change to DNC, and its other codes', () => {
    const tle = { code: 'TLE', description: 'x', kind: 'replace', rule: { type: 'fixedPoints', points: 3 }, discardable: true };
    const dnc = { code: 'DNC', kind: 'replace', rule: { type: 'fixedPoints', points: 9 }, discardable: true };
    const series: Record<string, unknown> = { dnfScoring: 'startingAreaInclDnc', scoringCodes: [tle, dnc] };
    upgradeDncRule(series);
    expect(series.scoringCodes).toEqual([tle, dnc]);
  });

  it('leaves every other series alone', () => {
    for (const dnfScoring of ['seriesEntries', 'startingArea']) {
      const series: Record<string, unknown> = { dnfScoring };
      upgradeDncRule(series);
      expect(series).toEqual({ dnfScoring });
    }
  });
});

describe('reading a stored series', () => {
  it('upgrades a file, a revision snapshot or a tombstone as it is read', () => {
    const file: Record<string, unknown> = { formatVersion: 72, series: { dnfScoring: 'startingAreaInclDnc' } };
    migrateSeriesFileObject(file);
    expect(file.series).toEqual({ dnfScoring: 'startingArea', scoringCodes: [DNC_SCORED_AS_DNF] });
  });
});

describe('importing a published data file', () => {
  it('upgrades an export written before v14', async () => {
    const { buildPublicExportFromSnapshot, importPublicExport } = await import('@/lib/public-export');
    const series = {
      id: 's1', name: 'DBSC Thursday', venue: '', startDate: '2026-05-07', endDate: '', venueLogoUrl: '',
      eventLogoUrl: '', venueUrl: '', eventUrl: '', createdAt: 0, lastSavedAt: null, lastModifiedAt: 0,
      scoringMode: 'scratch' as const, discardThresholds: [], dnfScoring: 'startingArea' as const, ftpHost: '',
      ftpPath: '', ftpPaths: {}, includeJsonExport: true, enabledCompetitorFields: [],
      primaryPersonLabel: 'helm' as const, subdivisionAxes: [],
    };
    const exported = buildPublicExportFromSnapshot({
      series,
      competitors: [{ id: 'c1', seriesId: 's1', fleetIds: ['fl-1'], sailNumber: '2108', names: ['Helm'], clubs: [], gender: '', age: null, createdAt: 0 }],
      fleets: [{ id: 'fl-1', seriesId: 's1', name: 'Cruisers 2', displayOrder: 0, scoringSystem: 'scratch' }],
      races: [{ id: 'r1', seriesId: 's1', raceNumber: 1, name: null, date: '2026-05-07', createdAt: 0 }],
      subSeries: [], finishes: [], raceStarts: [], ratingOverrides: [],
    })!;
    const old = { ...exported, version: 13 as const, series: { ...exported.series, dnfScoring: 'startingAreaInclDnc' } };
    let saved: Record<string, unknown> | undefined;
    const repos = {
      seriesRepo: { get: async () => undefined, save: async (s: Record<string, unknown>) => { saved = s; return s; } },
      fleetRepo: { listBySeries: async () => [], save: async (f: unknown) => f, saveMany: async () => {} },
      competitorRepo: { listBySeries: async () => [], save: async (c: unknown) => c, saveMany: async () => {} },
      raceRepo: { listBySeries: async () => [], save: async (r: unknown) => r },
      subSeriesRepo: { listBySeries: async () => [], saveMany: async () => {} },
      raceStartRepo: { listBySeries: async () => [], saveMany: async () => {} },
      finishRepo: { listByRace: async () => [], saveMany: async () => {} },
      ratingOverrideRepo: { listBySeries: async () => [], saveMany: async () => {} },
      listSeriesNames: async () => [],
    };
    await importPublicExport(old as unknown as Parameters<typeof importPublicExport>[0], repos as unknown as Parameters<typeof importPublicExport>[1]);
    expect(saved?.dnfScoring).toBe('startingArea');
    expect(saved?.scoringCodes).toEqual([DNC_SCORED_AS_DNF]);
  });
});
