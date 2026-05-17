import { describe, it, expect } from 'vitest';
import { parseSeriesFile } from '@/lib/series-file';

// v2 files store `defaultStartSequence[*].offsetMinutes` as cumulative minutes
// from the first start. v3 stores `intervalMinutes` (gap to the previous
// start). The parser must convert v1/v2 sequences on read so callers always
// see the v3 shape — see #95.

function v2FileWithSequence(sequence: { fleetIds: string[]; offsetMinutes: number }[]): string {
  return JSON.stringify({
    formatVersion: 2,
    seriesId: 's1',
    snapshotId: 'snap-1',
    snapshotHistory: ['snap-1'],
    exportedAt: '2026-04-26T00:00:00.000Z',
    series: {
      id: 's1',
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
      bilgeBundle: null,
      includeJsonExport: true,
      enabledCompetitorFields: [],
      primaryPersonLabel: 'helm',
      scoringMode: 'handicap',
      defaultStartSequence: sequence,
    },
    fleets: [],
    competitors: [],
    races: [],
  });
}

describe('parseSeriesFile — v1/v2 → v3 start-sequence migration', () => {
  it('converts a 3-start cumulative sequence to per-step intervals', () => {
    const file = parseSeriesFile(
      v2FileWithSequence([
        { fleetIds: ['c1'], offsetMinutes: 0 },
        { fleetIds: ['c2'], offsetMinutes: 5 },
        { fleetIds: ['c3'], offsetMinutes: 10 },
      ]),
    );
    expect(file.series.defaultStartSequence).toEqual([
      { fleetIds: ['c1'], intervalMinutes: 0 },
      { fleetIds: ['c2'], intervalMinutes: 5 },
      { fleetIds: ['c3'], intervalMinutes: 5 },
    ]);
  });

  it('leaves a single-start sequence unchanged', () => {
    const file = parseSeriesFile(
      v2FileWithSequence([{ fleetIds: ['only'], offsetMinutes: 0 }]),
    );
    expect(file.series.defaultStartSequence).toEqual([
      { fleetIds: ['only'], intervalMinutes: 0 },
    ]);
  });

  it('handles uneven cumulative gaps', () => {
    const file = parseSeriesFile(
      v2FileWithSequence([
        { fleetIds: ['a'], offsetMinutes: 0 },
        { fleetIds: ['b'], offsetMinutes: 3 },
        { fleetIds: ['c'], offsetMinutes: 11 },
      ]),
    );
    expect(file.series.defaultStartSequence).toEqual([
      { fleetIds: ['a'], intervalMinutes: 0 },
      { fleetIds: ['b'], intervalMinutes: 3 },
      { fleetIds: ['c'], intervalMinutes: 8 },
    ]);
  });

  it('is a no-op when defaultStartSequence is absent', () => {
    const content = JSON.stringify({
      formatVersion: 2,
      seriesId: 's1',
      snapshotId: 'snap-1',
      snapshotHistory: ['snap-1'],
      exportedAt: '2026-04-26T00:00:00.000Z',
      series: {
        id: 's1',
        name: 'Scratch Series',
        venue: '',
        startDate: '',
        endDate: '',
        venueLogoUrl: '',
        eventLogoUrl: '',
        discardThresholds: [],
        dnfScoring: 'seriesEntries',
        ftpHost: '',
        ftpPath: '',
        bilgeBundle: null,
        includeJsonExport: true,
        enabledCompetitorFields: [],
        primaryPersonLabel: 'helm',
        scoringMode: 'scratch',
      },
      fleets: [],
      competitors: [],
      races: [],
    });
    const file = parseSeriesFile(content);
    expect(file.series.defaultStartSequence).toBeUndefined();
  });
});

describe('parseSeriesFile — v5 nationality', () => {
  function fileV5WithNationality(nationality: string | undefined): string {
    return JSON.stringify({
      formatVersion: 5,
      seriesId: 's1',
      snapshotId: 'snap-1',
      snapshotHistory: ['snap-1'],
      exportedAt: '2026-05-17T00:00:00.000Z',
      series: {
        id: 's1',
        name: 'Nationals',
        venue: 'HYC',
        startDate: '2026-08-01',
        endDate: '2026-08-03',
        venueLogoUrl: '',
        eventLogoUrl: '',
        discardThresholds: [],
        dnfScoring: 'seriesEntries',
        ftpHost: '',
        ftpPath: '',
        bilgeBundle: null,
        includeJsonExport: true,
        enabledCompetitorFields: ['boatName', 'nationality'],
        primaryPersonLabel: 'helm',
        scoringMode: 'scratch',
      },
      fleets: [],
      competitors: [
        {
          id: 'c1',
          fleetIds: [],
          sailNumber: 'IRL-7',
          name: 'Skipper',
          club: 'HYC',
          gender: '',
          age: null,
          ...(nationality ? { nationality } : {}),
        },
      ],
      races: [],
    });
  }

  it('preserves a competitor nationality through parse', () => {
    const file = parseSeriesFile(fileV5WithNationality('IRL'));
    expect(file.competitors[0].nationality).toBe('IRL');
  });

  it('leaves nationality undefined when absent (and on legacy v4 files)', () => {
    const file = parseSeriesFile(fileV5WithNationality(undefined));
    expect(file.competitors[0].nationality).toBeUndefined();
    // v4 spelling of the same file should also load without nationality.
    const v4 = parseSeriesFile(fileV5WithNationality(undefined).replace('"formatVersion":5', '"formatVersion":4'));
    expect(v4.competitors[0].nationality).toBeUndefined();
  });
});
