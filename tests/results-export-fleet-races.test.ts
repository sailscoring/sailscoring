/**
 * A fleet's published page carries its own races and no others.
 *
 * The shape is an HYC Autumn League day: on 19 Sep the Puppeteers sail two
 * races and the Howth 17s one, so the second race has no 17 start; and the
 * 26 Sep race is struck for the 17s by a protest decision. Both already count
 * for nothing in the 17s' standings — the page should not show them at all.
 */
import { describe, it, expect } from 'vitest';

import { buildFleetHtmlFiles } from '@/lib/results-export';
import type { ExportRepos } from '@/lib/public-export';
import type { Competitor, Finish, Fleet, Race, RaceStart, Series } from '@/lib/types';

const SERIES: Series = {
  id: 's1',
  name: 'Autumn League',
  venue: 'Howth',
  startDate: '2026-09-12',
  endDate: '2026-10-17',
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
  publishingGroups: [],
  publishIndividualFleetPages: true,
  raceFleetExclusions: [{ raceId: 'r4', fleetId: 'h17' }],
};

const FLEETS: Fleet[] = [
  { id: 'p22', seriesId: 's1', name: 'Puppeteer', displayOrder: 0, scoringSystem: 'scratch' },
  { id: 'h17', seriesId: 's1', name: 'Howth 17', displayOrder: 1, scoringSystem: 'scratch' },
];

const boat = (sail: string, fleetId: string): Competitor => ({
  id: `c${sail}`,
  seriesId: 's1',
  fleetIds: [fleetId],
  sailNumber: sail,
  names: [`Helm ${sail}`],
  clubs: [],
  gender: '' as const,
  age: null,
  createdAt: 0,
});

const COMPETITORS = [boat('1', 'p22'), boat('2', 'p22'), boat('11', 'h17'), boat('12', 'h17')];

const race = (n: number, name: string, date: string): Race => ({
  id: `r${n}`,
  seriesId: 's1',
  raceNumber: n,
  name,
  date,
  createdAt: 0,
});

const RACES: Race[] = [
  race(1, 'Opening race', '2026-09-12'),
  race(2, 'Second Saturday first', '2026-09-19'),
  race(3, 'Second Saturday second', '2026-09-19'),
  race(4, 'Protested race', '2026-09-26'),
  race(5, 'October opener', '2026-10-03'),
];

const start = (raceId: string, fleetIds: string[]): RaceStart =>
  ({ id: `s-${raceId}-${fleetIds.join('-')}`, raceId, fleetIds } as RaceStart);

const STARTS: RaceStart[] = [
  start('r1', ['p22']), start('r1', ['h17']),
  start('r2', ['p22']), start('r2', ['h17']),
  start('r3', ['p22']),
  start('r4', ['p22']), start('r4', ['h17']),
  start('r5', ['p22']), start('r5', ['h17']),
];

function finish(raceId: string, competitorId: string, sortOrder: number): Finish {
  return {
    id: `${raceId}-${competitorId}`,
    raceId,
    competitorId,
    sortOrder,
    tiedWithPrevious: false,
    resultCode: null,
    startPresent: null,
    penaltyCode: null,
    penaltyOverride: null,
    redressMethod: null,
    redressExcludeRaceIds: null,
    redressIncludeRaceIds: null,
    redressIncludeAllLater: false,
    redressPoints: null,
  };
}

const FINISHES: Finish[] = [
  ...['r1', 'r2', 'r3', 'r4', 'r5'].flatMap((r) => [finish(r, 'c1', 1), finish(r, 'c2', 2)]),
  // The 17s sailed the protested race; the result rows stay, struck.
  ...['r1', 'r2', 'r4', 'r5'].flatMap((r) => [finish(r, 'c11', 1), finish(r, 'c12', 2)]),
];

const makeRepos = (series: Series): ExportRepos => ({
  seriesRepo: { get: async (id: string) => (id === 's1' ? series : undefined) },
  competitorRepo: { listBySeries: async () => COMPETITORS },
  raceRepo: { listBySeries: async () => RACES },
  fleetRepo: { listBySeries: async () => FLEETS },
  subSeriesRepo: { listBySeries: async () => [] },
  finishRepo: { listBySeries: async () => FINISHES },
  raceStartRepo: { listBySeries: async () => STARTS },
  raceRatingOverrideRepo: { listBySeries: async () => [] },
}) as unknown as ExportRepos;

async function page(fleetName: string, series: Series = SERIES): Promise<string> {
  const build = await buildFleetHtmlFiles(makeRepos(series), 's1');
  return build!.files.find((f) => f.fleetName === fleetName)!.html;
}

/** The summary table's race column headers, in order. */
function raceColumns(html: string): string[] {
  const summary = html.slice(html.indexOf('summarytable'), html.indexOf('</thead>', html.indexOf('summarytable')));
  return [...summary.matchAll(/<th[^>]*>(?:<a[^>]*>)?(R\d+)/g)].map((m) => m[1]);
}

describe('buildFleetHtmlFiles — each fleet publishes its own races', () => {
  it('leaves a race the fleet had no start in, and one struck for it, off its page', async () => {
    const html = await page('Howth 17');
    expect(raceColumns(html)).toHaveLength(3);
    expect(html).toContain('Opening race');
    expect(html).toContain('Second Saturday first');
    expect(html).not.toContain('Second Saturday second');
    expect(html).not.toContain('Protested race');
    expect(html).not.toContain('No finishers in this race');
  });

  it('scores the fleet over the races it keeps', async () => {
    const html = await page('Howth 17');
    const row = html.slice(html.indexOf('Helm 12'), html.indexOf('</tr>', html.indexOf('Helm 12')));
    // 2 + 2 + 2 over the three races that count; nothing from the struck one.
    expect(row).toMatch(/<td[^>]*>2\.0<\/td>\s*<td[^>]*>2\.0<\/td>\s*<td[^>]*>2\.0<\/td>\s*<td>6\.0<\/td>\s*$/);
  });

  it('leaves a fleet that sailed every race with every race', async () => {
    const html = await page('Puppeteer');
    expect(raceColumns(html)).toEqual(['R1', 'R2', 'R3', 'R4', 'R5']);
    expect(html).toContain('Second Saturday second');
    expect(html).toContain('Protested race');
  });

  it('numbers the races a fleet sailed for itself', async () => {
    const html = await page('Howth 17');
    expect(raceColumns(html)).toEqual(['R1', 'R2', 'R3']);
    // The series' fifth race is the 17s' third.
    expect(html).toMatch(/id="r3">R3&nbsp;&mdash;&nbsp;October opener/);
  });

  it('lines the fleets up by race on a combined page’s race grid', async () => {
    const html = await page('Inshore', {
      ...SERIES,
      publishingGroups: [
        { id: 'g1', name: 'Inshore', fleetMode: 'chosen', fleetIds: ['p22', 'h17'], detail: 'full', raceGrid: true },
      ],
    });
    const grid = html.slice(html.indexOf('<table class="racegrid"'), html.indexOf('</table>', html.indexOf('<table class="racegrid"')));
    const headings = [...grid.slice(0, grid.indexOf('</thead>')).matchAll(/<th>([^<]+)<\/th>/g)].map((m) => m[1]);
    // The two fleets count their races apart, so the columns go by date.
    expect(headings).toEqual(['Standings', '12 Sept', '19 Sept', '19 Sept', '26 Sept', '3 Oct']);
    const h17Row = grid.slice(grid.indexOf('Howth 17'));
    const cells = [...h17Row.slice(0, h17Row.indexOf('</tr>')).matchAll(/<td[^>]*>(?:<a[^>]*>)?([^<]*)/g)].map((m) => m[1]);
    expect(cells).toEqual(['Series', 'R1', 'R2', '&middot;', '&middot;', 'R3']);
  });
});
