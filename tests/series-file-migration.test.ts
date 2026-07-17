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

describe('parseSeriesFile — v8 snapshot-lineage removal', () => {
  function minimalFile(extra: Record<string, unknown>): string {
    return JSON.stringify({
      formatVersion: 8,
      seriesId: 's1',
      exportedAt: '2026-06-09T00:00:00.000Z',
      series: {
        id: 's1',
        name: 'Series',
        venue: 'HYC',
        startDate: '2026-06-01',
        endDate: '2026-06-30',
        venueLogoUrl: '',
        eventLogoUrl: '',
        discardThresholds: [],
        dnfScoring: 'seriesEntries',
        ftpHost: '',
        ftpPath: '',
        includeJsonExport: true,
        enabledCompetitorFields: [],
        primaryPersonLabel: 'helm',
        scoringMode: 'scratch',
      },
      fleets: [],
      competitors: [],
      races: [],
      ...extra,
    });
  }

  it('parses a v8 file that omits snapshotId / snapshotHistory', () => {
    const file = parseSeriesFile(minimalFile({}));
    expect(file.seriesId).toBe('s1');
    expect(file).not.toHaveProperty('snapshotId');
    expect(file).not.toHaveProperty('snapshotHistory');
  });

  it('tolerates legacy snapshot fields on an older file (keys ignored)', () => {
    // A v7 file still carries the lineage keys; they must not break parsing.
    const file = parseSeriesFile(
      minimalFile({ formatVersion: 7, snapshotId: 'snap-1', snapshotHistory: ['snap-1'] }),
    );
    expect(file.seriesId).toBe('s1');
  });
});

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

describe('parseSeriesFile — venue/event website URLs', () => {
  function fileWithUrls(urls: { venueUrl?: string; eventUrl?: string }): string {
    return JSON.stringify({
      formatVersion: 6,
      seriesId: 's1',
      snapshotId: 'snap-1',
      snapshotHistory: ['snap-1'],
      exportedAt: '2026-04-26T00:00:00.000Z',
      series: {
        id: 's1',
        name: 'Branding Series',
        venue: 'HYC',
        startDate: '2026-09-01',
        endDate: '',
        venueLogoUrl: 'https://example.com/venue.png',
        eventLogoUrl: 'https://example.com/event.png',
        ...(urls.venueUrl !== undefined ? { venueUrl: urls.venueUrl } : {}),
        ...(urls.eventUrl !== undefined ? { eventUrl: urls.eventUrl } : {}),
        discardThresholds: [],
        dnfScoring: 'seriesEntries',
        ftpHost: '',
        ftpPath: '',
        bilgeBundle: null,
        includeJsonExport: true,
        enabledCompetitorFields: [],
        primaryPersonLabel: 'helm',
        scoringMode: 'handicap',
      },
      fleets: [],
      competitors: [],
      races: [],
    });
  }

  it('preserves venueUrl / eventUrl through a parse', () => {
    const file = parseSeriesFile(
      fileWithUrls({ venueUrl: 'www.hyc.ie', eventUrl: 'ilcaireland.com/event/' }),
    );
    expect(file.series.venueUrl).toBe('www.hyc.ie');
    expect(file.series.eventUrl).toBe('ilcaireland.com/event/');
  });

  it('tolerates older files that omit the website URLs', () => {
    const file = parseSeriesFile(fileWithUrls({}));
    expect(file.series.venueUrl).toBeUndefined();
    expect(file.series.eventUrl).toBeUndefined();
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

describe('parseSeriesFile — v6 subdivision', () => {
  function fileV6(opts: { subdivision?: string; subdivisionLabel?: string }): string {
    return JSON.stringify({
      formatVersion: 6,
      seriesId: 's1',
      snapshotId: 'snap-1',
      snapshotHistory: ['snap-1'],
      exportedAt: '2026-05-24T00:00:00.000Z',
      series: {
        id: 's1',
        name: 'ILCA Masters',
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
        enabledCompetitorFields: ['subdivision'],
        primaryPersonLabel: 'helm',
        ...(opts.subdivisionLabel ? { subdivisionLabel: opts.subdivisionLabel } : {}),
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
          ...(opts.subdivision ? { subdivision: opts.subdivision } : {}),
        },
      ],
      races: [],
    });
  }

  it('preserves competitor subdivision and the series subdivision label', () => {
    const file = parseSeriesFile(fileV6({ subdivision: 'Grand Master', subdivisionLabel: 'Category' }));
    expect(file.competitors[0].subdivision).toBe('Grand Master');
    expect(file.series.subdivisionLabel).toBe('Category');
  });

  it('leaves both fields absent when not present (and on legacy v5 files)', () => {
    // The repo-write path defaults subdivisionLabel to "Division"; the parse
    // layer just preserves what the file carried.
    const v6 = parseSeriesFile(fileV6({}));
    expect(v6.competitors[0].subdivision).toBeUndefined();
    expect(v6.series.subdivisionLabel).toBeUndefined();
    // A legacy v5 spelling of the same file loads cleanly too.
    const v5 = parseSeriesFile(fileV6({}).replace('"formatVersion":6', '"formatVersion":5'));
    expect(v5.competitors[0].subdivision).toBeUndefined();
  });
});

describe('parseSeriesFile — v13 multi-axis subdivisions', () => {
  function fileV13(): string {
    return JSON.stringify({
      formatVersion: 13,
      seriesId: 's1',
      exportedAt: '2026-08-24T00:00:00.000Z',
      series: {
        id: 's1',
        name: 'ILCA Leinsters',
        venue: 'HYC',
        startDate: '2026-08-01',
        endDate: '2026-08-03',
        venueLogoUrl: '',
        eventLogoUrl: '',
        discardThresholds: [],
        dnfScoring: 'seriesEntries',
        ftpHost: '',
        ftpPath: '',
        includeJsonExport: true,
        enabledCompetitorFields: ['subdivision'],
        primaryPersonLabel: 'helm',
        subdivisionAxes: [
          { id: 'ax-div', label: 'Division' },
          { id: 'ax-cat', label: 'Age category' },
        ],
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
          subdivisions: { 'ax-div': 'Silver', 'ax-cat': 'Master' },
        },
      ],
      races: [],
    });
  }

  it('round-trips the axes and per-competitor values', () => {
    const file = parseSeriesFile(fileV13());
    expect(file.series.subdivisionAxes).toEqual([
      { id: 'ax-div', label: 'Division' },
      { id: 'ax-cat', label: 'Age category' },
    ]);
    expect(file.competitors[0].subdivisions).toEqual({ 'ax-div': 'Silver', 'ax-cat': 'Master' });
  });
});

describe('parseSeriesFile — v21 crew list', () => {
  function fileWithCompetitor(formatVersion: number, competitor: Record<string, unknown>): string {
    return JSON.stringify({
      formatVersion,
      seriesId: 's1',
      exportedAt: '2026-07-17T00:00:00.000Z',
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
        includeJsonExport: true,
        enabledCompetitorFields: ['crewName'],
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
          ...competitor,
        },
      ],
      races: [],
    });
  }

  it('folds a ≤v20 crewName into a one-element crewNames list', () => {
    const file = parseSeriesFile(fileWithCompetitor(20, { crewName: 'J. Crew' }));
    expect(file.competitors[0].crewNames).toEqual(['J. Crew']);
    expect('crewName' in file.competitors[0]).toBe(false);
  });

  it('drops an empty legacy crewName', () => {
    const file = parseSeriesFile(fileWithCompetitor(20, { crewName: '  ' }));
    expect(file.competitors[0].crewNames).toBeUndefined();
  });

  it('leaves a competitor with no crew untouched', () => {
    const file = parseSeriesFile(fileWithCompetitor(20, {}));
    expect(file.competitors[0].crewNames).toBeUndefined();
  });

  it('passes a v21 crewNames list through unchanged', () => {
    const file = parseSeriesFile(
      fileWithCompetitor(21, { crewNames: ['Alice Byrne', 'Bob Malone'] }),
    );
    expect(file.competitors[0].crewNames).toEqual(['Alice Byrne', 'Bob Malone']);
  });
});
