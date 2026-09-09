/**
 * Each built page carries its own note (#511), and only its own. The case
 * that matters is a combined page: its sections are fleets, so a fleet's note
 * must not surface under the combined page's heading — and the combined
 * page's own note must, even though no fleet supplied it.
 */
import { describe, it, expect } from 'vitest';

import { buildFleetHtmlFiles } from '@/lib/results-export';
import type { ExportRepos } from '@/lib/public-export';
import type { Competitor, Finish, Fleet, PublishingGroup, Race, Series } from '@/lib/types';

const FLEETS: Fleet[] = [
  { id: 'f-a', seriesId: 's1', name: 'Class 1', displayOrder: 0, scoringSystem: 'scratch' },
  { id: 'f-b', seriesId: 's1', name: 'Class 2', displayOrder: 1, scoringSystem: 'scratch' },
];

const COMPETITORS: Competitor[] = [
  { id: 'c1', seriesId: 's1', fleetIds: ['f-a'], sailNumber: '101', names: ['A'], clubs: [], gender: '', age: null, createdAt: 0 },
  { id: 'c2', seriesId: 's1', fleetIds: ['f-b'], sailNumber: '201', names: ['B'], clubs: [], gender: '', age: null, createdAt: 0 },
];

const RACES: Race[] = [{ id: 'r1', seriesId: 's1', raceNumber: 1, name: null, date: '2026-09-05', createdAt: 0 }];

const FINISHES: Finish[] = ['c1', 'c2'].map((competitorId, i) => ({
  id: `r1-${competitorId}`, raceId: 'r1', competitorId, sortOrder: i + 1, tiedWithPrevious: false,
  resultCode: null, startPresent: null, penaltyCode: null, penaltyOverride: null,
  redressMethod: null, redressExcludeRaceIds: null, redressIncludeRaceIds: null,
  redressIncludeAllLater: false, redressPoints: null,
}));

const OVERALL: PublishingGroup = {
  id: 'g', name: 'Overall', fleetMode: 'all', fleetIds: [], detail: 'standings',
};

function makeSeries(over: Partial<Series> = {}): Series {
  return {
    id: 's1',
    name: 'Autumn League',
    venue: 'HYC',
    startDate: '2026-09-01',
    endDate: '',
    venueLogoUrl: '',
    eventLogoUrl: '',
    venueUrl: '',
    eventUrl: '',
    createdAt: 0,
    lastSavedAt: null,
    lastModifiedAt: 0,
    scoringMode: 'scratch',
    discardThresholds: [],
    dnfScoring: 'seriesEntries',
    ftpHost: '',
    ftpPath: '',
    ftpPaths: {},
    includeJsonExport: false,
    enabledCompetitorFields: [],
    primaryPersonLabel: 'helm',
    subdivisionAxes: [],
    ...over,
  };
}

function makeRepos(series: Series): ExportRepos {
  return {
    seriesRepo: { get: async (id: string) => (id === series.id ? series : undefined) },
    competitorRepo: { listBySeries: async () => COMPETITORS },
    raceRepo: { listBySeries: async () => RACES },
    fleetRepo: { listBySeries: async () => FLEETS },
    subSeriesRepo: { listBySeries: async () => [] },
    finishRepo: { listBySeries: async () => FINISHES },
    raceStartRepo: { listBySeries: async () => [] },
    raceRatingOverrideRepo: { listBySeries: async () => [] },
  } as unknown as ExportRepos;
}

const build = async (series: Series) =>
  (await buildFleetHtmlFiles(makeRepos(series), 's1', undefined, { includeEntryList: true, includePageNotes: true }))!.files;

const pageNamed = (files: Awaited<ReturnType<typeof build>>, name: string) =>
  files.find((f) => f.fleetName === name)!.html;

describe('notes on built pages', () => {
  it('puts the series note on every page and nothing else', async () => {
    const files = await build(makeSeries({ seriesNote: 'Corrected 16:40.' }));
    for (const file of files) expect(file.html).toContain('Corrected 16:40.');
  });

  it('puts a fleet’s note on that fleet’s page alone', async () => {
    const files = await build(
      makeSeries({
        publishingGroups: [OVERALL],
        pageNotes: [{ page: 'Class 1', text: 'Protest 14 outstanding.', updatedAt: 1 }],
      }),
    );
    expect(pageNamed(files, 'Class 1')).toContain('Protest 14 outstanding.');
    expect(pageNamed(files, 'Class 2')).not.toContain('Protest 14 outstanding.');
    // The combined page renders Class 1 as a section — its note belongs to
    // the fleet's own page, not under the combined page's heading.
    expect(pageNamed(files, 'Overall')).not.toContain('Protest 14 outstanding.');
    expect(pageNamed(files, 'Entries')).not.toContain('Protest 14 outstanding.');
  });

  it('puts a combined page’s note on the combined page', async () => {
    const files = await build(
      makeSeries({
        publishingGroups: [OVERALL],
        pageNotes: [{ page: 'Overall', text: 'Both classes on one scratch table.', updatedAt: 1 }],
      }),
    );
    expect(pageNamed(files, 'Overall')).toContain('Both classes on one scratch table.');
    expect(pageNamed(files, 'Class 1')).not.toContain('Both classes on one scratch table.');
  });

  it('puts the entry list’s note on the entry list', async () => {
    const files = await build(
      makeSeries({ pageNotes: [{ page: 'Entries', text: 'Late entries close Friday.', updatedAt: 1 }] }),
    );
    expect(pageNamed(files, 'Entries')).toContain('Late entries close Friday.');
    expect(pageNamed(files, 'Class 1')).not.toContain('Late entries close Friday.');
  });

  it('keeps a note off the pages while the workspace has the feature off', async () => {
    const series = makeSeries({
      seriesNote: 'Corrected 16:40.',
      pageNotes: [{ page: 'Class 1', text: 'Protest 14 outstanding.', updatedAt: 1 }],
    });
    const files = (await buildFleetHtmlFiles(makeRepos(series), 's1'))!.files;
    for (const file of files) {
      expect(file.html).not.toContain('Corrected 16:40.');
      expect(file.html).not.toContain('Protest 14 outstanding.');
    }
  });

  it('files a single-fleet series’ note against the lone results page', async () => {
    const one: Fleet[] = [FLEETS[0]];
    const repos = {
      ...makeRepos(makeSeries({ pageNotes: [{ page: '@default', text: 'Sailed in fog.', updatedAt: 1 }] })),
      fleetRepo: { listBySeries: async () => one },
      competitorRepo: { listBySeries: async () => [COMPETITORS[0]] },
      finishRepo: { listBySeries: async () => [FINISHES[0]] },
    } as unknown as ExportRepos;
    const files = (await buildFleetHtmlFiles(repos, 's1', undefined, { includePageNotes: true }))!.files;
    expect(files).toHaveLength(1);
    expect(files[0].isDefault).toBe(true);
    expect(files[0].html).toContain('Sailed in fog.');
  });
});
