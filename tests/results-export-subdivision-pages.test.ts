/**
 * Per-division published pages (#390) in the shared page builder: a series
 * with a subdivision axis can publish an extra page whose sections are that
 * axis's values — the KSC GP14 Munsters case, where one scoring pool was
 * published both as one standing and as Gold / Silver / Bronze.
 */
import { describe, it, expect } from 'vitest';

import { buildFleetHtmlFiles } from '@/lib/results-export';
import type { ExportRepos } from '@/lib/public-export';
import type {
  Competitor,
  Finish,
  Fleet,
  PublishingGroup,
  Race,
  Series,
} from '@/lib/types';

const AXIS = 'axis-div';

function makeSeries(publishingGroups: PublishingGroup[]): Series {
  return {
    id: 's1',
    name: 'GP14 Munsters',
    venue: 'Lough Derg',
    startDate: '2026-06-06',
    endDate: '2026-06-07',
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
    enabledCompetitorFields: ['subdivision'],
    primaryPersonLabel: 'helm',
    subdivisionAxes: [{ id: AXIS, label: 'Division' }],
    publishingGroups,
    publishIndividualFleetPages: true,
  };
}

const ONE_FLEET: Fleet[] = [
  { id: 'f-default', seriesId: 's1', name: 'Default', displayOrder: 0, scoringSystem: 'scratch' },
];

const TWO_FLEETS: Fleet[] = [
  { id: 'f-default', seriesId: 's1', name: 'Dinghies', displayOrder: 0, scoringSystem: 'scratch' },
  { id: 'f-keel', seriesId: 's1', name: 'Keelboats', displayOrder: 1, scoringSystem: 'scratch' },
];

function makeCompetitor(
  id: string,
  sail: string,
  division: string | undefined,
  fleetIds = ['f-default'],
): Competitor {
  return {
    id,
    seriesId: 's1',
    fleetIds,
    sailNumber: sail,
    names: [`Helm ${sail}`],
    club: '',
    gender: '',
    age: null,
    createdAt: 0,
    ...(division !== undefined ? { subdivisions: { [AXIS]: division } } : {}),
  };
}

// Finish order 1..5, so the series order is Gold, Silver, Gold, Bronze, (none).
const COMPETITORS = [
  makeCompetitor('c1', '14256', 'Gold'),
  makeCompetitor('c2', '14203', 'Silver'),
  makeCompetitor('c3', '14', 'Gold'),
  makeCompetitor('c4', '14171', 'Bronze'),
  makeCompetitor('c5', '13677', undefined),
];

const RACES: Race[] = [
  { id: 'r1', seriesId: 's1', raceNumber: 1, name: null, date: '2026-06-06', createdAt: 0 },
];

function makeFinish(competitorId: string, sortOrder: number): Finish {
  return {
    id: `r1-${competitorId}`,
    raceId: 'r1',
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

const FINISHES = COMPETITORS.map((c, i) => makeFinish(c.id, i + 1));

function makeRepos(series: Series, fleets: Fleet[], competitors = COMPETITORS): ExportRepos {
  return {
    seriesRepo: { get: async (id: string) => (id === series.id ? series : undefined) },
    competitorRepo: { listBySeries: async () => competitors },
    raceRepo: { listBySeries: async () => RACES },
    fleetRepo: { listBySeries: async () => fleets },
    subSeriesRepo: { listBySeries: async () => [] },
    finishRepo: { listBySeries: async () => FINISHES },
    raceStartRepo: { listBySeries: async () => [] },
    raceRatingOverrideRepo: { listBySeries: async () => [] },
  } as unknown as ExportRepos;
}

/** Section headings on a built page. The document chrome contributes the
 *  venue and the page's own name as the first two `h2`s. */
function sectionHeadings(html: string): string[] {
  return [...html.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1]).slice(2);
}

/** The rank cell of every standings row in a slice of a page. */
function ranks(html: string): string[] {
  return [...html.matchAll(/summaryrow">\s*<td>([^<]+)<\/td>/g)].map((m) => m[1]);
}

const BY_DIVISION: PublishingGroup = {
  id: 'g-div',
  name: 'By division',
  fleetMode: 'all',
  fleetIds: [],
  detail: 'standings',
  sectionAxisId: AXIS,
};

describe('buildFleetHtmlFiles — pages sectioned by a subdivision axis', () => {
  it('publishes one section per division from a single-fleet series', async () => {
    const files = await buildFleetHtmlFiles(
      makeRepos(makeSeries([BY_DIVISION]), ONE_FLEET),
      's1',
    );
    expect(files!.map((f) => f.fleetName)).toEqual(['By division', 'Default']);
    const page = files![0];
    expect(page.isCombined).toBe(true);
    // Sections lead with the division of the leading boat.
    expect(sectionHeadings(page.html)).toEqual(['Gold', 'Silver', 'Bronze']);
    expect(page.html.match(/class="summarytable"/g)).toHaveLength(3);
  });

  it('ranks each division 1..n rather than carrying the series place', async () => {
    const files = await buildFleetHtmlFiles(
      makeRepos(makeSeries([BY_DIVISION]), ONE_FLEET),
      's1',
    );
    const gold = files![0].html.split('<h2>Gold</h2>')[1].split('<h2>')[0];
    // Two Gold boats, 1st and 2nd in Gold though 1st and 3rd overall.
    expect(ranks(gold)).toEqual(['1st', '2nd']);
    // …on the points they actually scored in the series.
    expect(gold).toContain('14256');
    expect(gold).toContain('>14<');
  });

  it('drops the axis column inside the sections — the heading carries it', async () => {
    const files = await buildFleetHtmlFiles(
      makeRepos(makeSeries([BY_DIVISION]), ONE_FLEET),
      's1',
    );
    const page = files![0];
    expect(page.html).not.toContain('<th>Division</th>');
    // The fleet's own page still shows it.
    expect(files![1].html).toContain('<th>Division</th>');
  });

  it('leaves competitors with no division off the page entirely', async () => {
    const files = await buildFleetHtmlFiles(
      makeRepos(makeSeries([BY_DIVISION]), ONE_FLEET),
      's1',
    );
    expect(files![0].html).not.toContain('13677');
    expect(files![1].html).toContain('13677');
  });

  it('publishes standings only, whatever detail the page asks for', async () => {
    const fullDetail = { ...BY_DIVISION, detail: 'full' as const };
    const files = await buildFleetHtmlFiles(
      makeRepos(makeSeries([fullDetail]), ONE_FLEET),
      's1',
    );
    // Race tables would otherwise be printed once per division, all identical.
    expect(files![0].html).not.toContain('class="racetable"');
  });

  it('keeps divisions of different fleets apart when the page spans fleets', async () => {
    const competitors = [
      makeCompetitor('c1', '14256', 'Gold'),
      makeCompetitor('c2', '14203', 'Silver'),
      makeCompetitor('k1', '3001', 'Gold', ['f-keel']),
    ];
    const files = await buildFleetHtmlFiles(
      makeRepos(makeSeries([BY_DIVISION]), TWO_FLEETS, competitors),
      's1',
    );
    expect(sectionHeadings(files![0].html)).toEqual([
      'Dinghies — Gold',
      'Dinghies — Silver',
      'Keelboats — Gold',
    ]);
  });

  it('publishes no page at all when nobody carries a value for the axis', async () => {
    const competitors = [makeCompetitor('c1', '14256', undefined)];
    const files = await buildFleetHtmlFiles(
      makeRepos(makeSeries([BY_DIVISION]), ONE_FLEET, competitors),
      's1',
    );
    expect(files!.map((f) => f.fleetName)).toEqual(['Default']);
  });
});
