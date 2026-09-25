/**
 * Placeholder standings: before any race is sailed, each fleet page publishes
 * its entrants unranked, so an event's results link can go live on day one.
 */
import { describe, it, expect } from 'vitest';

import { buildFleetHtmlFiles } from '@/lib/results-export';
import type { ExportRepos } from '@/lib/public-export';
import type { Competitor, Finish, Fleet, Race, Series, SubSeries } from '@/lib/types';

const SERIES: Series = {
  id: 's1',
  name: 'Autumn League',
  venue: 'Howth',
  startDate: '2026-10-03',
  endDate: '2026-11-21',
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
  includeJsonExport: true,
  enabledCompetitorFields: [],
  primaryPersonLabel: 'helm',
  subdivisionAxes: [],
  publishingGroups: [],
  publishIndividualFleetPages: true,
  prizes: [{ id: 'p1', name: 'Overall', recipientCount: 3, clauses: [] }],
};

const FLEETS: Fleet[] = [
  { id: 'f1', seriesId: 's1', name: 'Fleet', displayOrder: 0, scoringSystem: 'scratch' },
];

// Entered out of sail-number order, so the page's own ordering is exercised.
const COMPETITORS: Competitor[] = ['201', '15', '101'].map((sail) => ({
  id: `c${sail}`,
  seriesId: 's1',
  fleetIds: ['f1'],
  sailNumber: sail,
  names: [`Helm ${sail}`],
  clubs: [],
  gender: '' as const,
  age: null,
  createdAt: 0,
}));

const RACE: Race = { id: 'r1', seriesId: 's1', raceNumber: 1, name: null, date: '2026-10-03', createdAt: 0 };

const FINISH: Finish = {
  id: 'r1-c15', raceId: 'r1', competitorId: 'c15', sortOrder: 1, tiedWithPrevious: false, resultCode: null,
  startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null, redressExcludeRaceIds: null,
  redressIncludeRaceIds: null, redressIncludeAllLater: false, redressPoints: null,
};

function makeRepos(opts: { races?: Race[]; finishes?: Finish[]; subSeries?: SubSeries[] } = {}): ExportRepos {
  return {
    seriesRepo: { get: async (id: string) => (id === 's1' ? SERIES : undefined) },
    competitorRepo: { listBySeries: async () => COMPETITORS },
    raceRepo: { listBySeries: async () => opts.races ?? [] },
    fleetRepo: { listBySeries: async () => FLEETS },
    subSeriesRepo: { listBySeries: async () => opts.subSeries ?? [] },
    finishRepo: { listBySeries: async () => opts.finishes ?? [] },
    raceStartRepo: { listBySeries: async () => [] },
    raceRatingOverrideRepo: { listBySeries: async () => [] },
  } as unknown as ExportRepos;
}

describe('buildFleetHtmlFiles — placeholder standings before race one', () => {
  it('publishes each fleet page with its entrants, unranked, in sail-number order', async () => {
    const build = await buildFleetHtmlFiles(makeRepos(), 's1');
    expect(build!.files.map((f) => f.fleetName)).toEqual(['Fleet']);
    const html = build!.files[0].html;
    expect(html).not.toContain('<th>Rank</th>');
    expect(html).not.toContain('<th>Total</th>');
    expect(html).not.toContain('1st');
    expect(html).toContain('No races have been sailed yet.');
    const order = ['Helm 15', 'Helm 101', 'Helm 201'].map((n) => html.indexOf(n));
    expect(order.every((i) => i > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('treats a scheduled race nobody has sailed the same way', async () => {
    const html = (await buildFleetHtmlFiles(makeRepos({ races: [RACE] }), 's1'))!.files[0].html;
    expect(html).not.toContain('>R1<');
    expect(html).toContain('No races have been sailed yet.');
  });

  it('publishes the whole series’ placeholder on a sub-series series', async () => {
    // No block has a sailed race of its own, so each would be skipped.
    const subSeries: SubSeries[] = [
      { id: 'b1', seriesId: 's1', name: 'October', displayOrder: 0, raceIds: ['r1'] },
    ];
    const build = await buildFleetHtmlFiles(makeRepos({ races: [RACE], subSeries }), 's1');
    expect(build!.files.map((f) => f.fleetName)).toEqual(['Fleet']);
    expect(build!.files[0].html).toContain('No races have been sailed yet.');
  });

  it('holds the prize sheet back until a race is sailed', async () => {
    const before = await buildFleetHtmlFiles(makeRepos(), 's1', undefined, { includePrizes: true });
    expect(before!.files.some((f) => f.isPrizes)).toBe(false);
    const after = await buildFleetHtmlFiles(
      makeRepos({ races: [RACE], finishes: [FINISH] }),
      's1',
      undefined,
      { includePrizes: true },
    );
    expect(after!.files.some((f) => f.isPrizes)).toBe(true);
  });

  it('becomes the ordinary standings once a race is sailed', async () => {
    const html = (await buildFleetHtmlFiles(makeRepos({ races: [RACE], finishes: [FINISH] }), 's1'))!
      .files[0].html;
    expect(html).toContain('<th>Rank</th>');
    expect(html).not.toContain('No races have been sailed yet.');
  });
});
