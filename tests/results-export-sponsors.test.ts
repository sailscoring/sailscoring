/**
 * A series' sponsors and trophy donors are named under the header of every
 * page a publish builds: each fleet's page, a combined page and the entry
 * list alike. A line of names reads as a sentence; a line where an entry has
 * a logo shows the logos.
 */
import { describe, it, expect } from 'vitest';

import { buildFleetHtmlFiles } from '@/lib/results-export';
import type { ExportRepos } from '@/lib/public-export';
import type { Competitor, Finish, Fleet, Race, Series, SeriesSponsor } from '@/lib/types';

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

function makeSeries(sponsors?: SeriesSponsor[]): Series {
  return {
    id: 's1', name: 'Spring Series', venue: 'Kinsale', startDate: '2026-04-01', endDate: '',
    venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '', createdAt: 0, lastSavedAt: null,
    lastModifiedAt: 0, scoringMode: 'scratch', discardThresholds: [], dnfScoring: 'seriesEntries',
    ftpHost: '', ftpPath: '', ftpPaths: {}, includeJsonExport: false, enabledCompetitorFields: [],
    primaryPersonLabel: 'helm', subdivisionAxes: [],
    publishingGroups: [{ id: 'g', name: 'Overall', fleetMode: 'all', fleetIds: [], detail: 'standings' }],
    ...(sponsors ? { sponsors } : {}),
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
  (await buildFleetHtmlFiles(makeRepos(series), 's1', undefined, { includeEntryList: true }))!.files;

describe('sponsors on published pages', () => {
  it('names them under the header of every page, donors on a line of their own', async () => {
    const files = await build(makeSeries([
      { name: 'Axiom Private Clients', kind: 'sponsor', url: 'https://axiom.example' },
      { name: 'The Blue Haven Group', kind: 'sponsor' },
      { name: 'The Draper Family', kind: 'donor' },
    ]));
    const names = files.map((f) => f.fleetName);
    expect(names).toEqual(expect.arrayContaining(['Class 1', 'Class 2', 'Overall']));
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const f of files) {
      expect(f.html, f.fleetName).toContain(
        'Sponsored by <a href="https://axiom.example" target="_top" rel="noopener">Axiom Private Clients</a> and The Blue Haven Group',
      );
      expect(f.html, f.fleetName).toContain('Trophy presented by The Draper Family');
    }
  });

  it('shows a row of logos where an entry has one, with the name as alt text', async () => {
    const files = await build(makeSeries([
      { name: 'O\'Leary Life', kind: 'sponsor', logoUrl: '/logos/abc' },
      { name: 'Plain Name Ltd', kind: 'sponsor' },
    ]));
    const html = files.find((f) => f.fleetName === 'Class 1')!.html;
    expect(html).toContain('<img class="sponsorlogo" src="/logos/abc" alt="O\'Leary Life"');
    expect(html).toContain('<span class="sponsorlead">Sponsored by</span>');
    expect(html).toContain('Plain Name Ltd');
  });

  it('adds nothing for a series with none', async () => {
    const files = await build(makeSeries());
    for (const f of files) expect(f.html).not.toContain('class="sponsors"');
  });
});
