/**
 * A race nobody has sailed is not published (#513).
 *
 * A split-fleet round advance used to create its stage races up front, and
 * those empty races became columns of DNCs on the published standings —
 * against every boat, adding up to nothing, which reads to a competitor as a
 * scoring error against a race that has not happened. Any route to an empty
 * race does the same, so the build drops them rather than the ceremony alone
 * being fixed.
 *
 * What counts as sailed is a boat row — a finisher, a code, or a start-area
 * check-in. A gun time is not one (#556): it can be a scheduled start typed
 * in ahead of the day, or race two's real start on a two-race day, fired
 * while race one is still being entered.
 */
import { describe, it, expect } from 'vitest';

import { buildFleetHtmlFiles } from '@/lib/results-export';
import type { ExportRepos } from '@/lib/public-export';
import type { Competitor, Finish, Fleet, Race, RaceStart, Series } from '@/lib/types';

const SERIES: Series = {
  id: 's1',
  name: 'Worlds',
  venue: 'Dun Laoghaire',
  startDate: '2026-08-23',
  endDate: '2026-08-30',
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
};

const FLEETS: Fleet[] = [
  { id: 'f1', seriesId: 's1', name: 'Fleet', displayOrder: 0, scoringSystem: 'scratch' },
];

const COMPETITORS: Competitor[] = ['101', '102'].map((sail) => ({
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

/** R1 was sailed; R2 is a slot in the schedule and nothing more. */
const RACES: Race[] = [1, 2].map((n) => ({
  id: `r${n}`,
  seriesId: 's1',
  raceNumber: n,
  name: null,
  date: '2026-08-24',
  createdAt: 0,
}));

function finish(raceId: string, competitorId: string, sortOrder: number | null, resultCode: Finish['resultCode'] = null): Finish {
  return {
    id: `${raceId}-${competitorId}`,
    raceId,
    competitorId,
    sortOrder,
    tiedWithPrevious: false,
    resultCode,
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

/** A boat seen in the starting area and nothing more: no place, no code.
 *  The engine reads it as a starter (and scores it DNF). */
function checkIn(raceId: string, competitorId: string): Finish {
  return { ...finish(raceId, competitorId, null), startPresent: true };
}

const R1_FINISHES = [finish('r1', 'c101', 1), finish('r1', 'c102', 2)];

function makeRepos(finishes: Finish[], raceStarts: RaceStart[] = []): ExportRepos {
  return {
    seriesRepo: { get: async (id: string) => (id === 's1' ? SERIES : undefined) },
    competitorRepo: { listBySeries: async () => COMPETITORS },
    raceRepo: { listBySeries: async () => RACES },
    fleetRepo: { listBySeries: async () => FLEETS },
    subSeriesRepo: { listBySeries: async () => [] },
    finishRepo: { listBySeries: async () => finishes },
    raceStartRepo: { listBySeries: async () => raceStarts },
    raceRatingOverrideRepo: { listBySeries: async () => [] },
  } as unknown as ExportRepos;
}

const standingsHtml = async (repos: ExportRepos) =>
  (await buildFleetHtmlFiles(repos, 's1'))!.files[0].html;

describe('buildFleetHtmlFiles — races nobody has sailed', () => {
  it('leaves an unsailed race off the published standings', async () => {
    const html = await standingsHtml(makeRepos(R1_FINISHES));
    expect(html).toContain('>R1<');
    expect(html).not.toContain('>R2<');
    // And no DNC arrives with it: R1's two finishers are all the page says.
    expect(html).not.toContain('DNC');
  });

  it('drops a race whose only mark is a gun time (#556)', async () => {
    // A start time on its own says nothing about whether the race happened:
    // it may be the scheduled gun typed in from the SIs when the schedule was
    // set up, or — on a two-race day — race two's real start, fired while
    // race one's results are being entered. Neither is a result to publish.
    const starts: RaceStart[] = [
      { id: 'st2', raceId: 'r2', fleetIds: ['f1'], startTime: '11:00:00' },
    ];
    const html = await standingsHtml(makeRepos(R1_FINISHES, starts));
    expect(html).not.toContain('>R2<');
    expect(html).not.toContain('DNC');
  });

  it('keeps a race the committee started and boats checked into', async () => {
    // Started, then abandoned — or everyone retired. Nobody finished, but the
    // boats were seen in the starting area, and that check-in is the boat row
    // that makes the race real. The engine already counts such a row as a
    // starter; the column belongs on the page.
    const checkedIn = [checkIn('r2', 'c101'), checkIn('r2', 'c102')];
    const html = await standingsHtml(makeRepos([...R1_FINISHES, ...checkedIn]));
    expect(html).toContain('>R2<');
  });

  it('keeps a race whose only rows are codes the scorer entered', async () => {
    // Two boats came to the line and retired: no finisher, but a scorer sat
    // down and recorded what happened.
    const coded = [finish('r2', 'c101', null, 'DNF'), finish('r2', 'c102', null, 'DNF')];
    const html = await standingsHtml(makeRepos([...R1_FINISHES, ...coded]));
    expect(html).toContain('>R2<');
  });

  it('publishes nothing when every race is unsailed', async () => {
    // The same window as a series before race one: there is no result to
    // show, and without the entry list opted in there is no page either.
    expect(await buildFleetHtmlFiles(makeRepos([]), 's1')).toBeNull();
    const withEntries = await buildFleetHtmlFiles(makeRepos([]), 's1', undefined, {
      includeEntryList: true,
    });
    expect(withEntries!.files.map((f) => f.fleetName)).toEqual(['Entries']);
  });

  it('leaves it out of the data file published beside the pages', async () => {
    // ADR-012: the sidecar is the data behind the page, so the two agree on
    // which races exist.
    const build = await buildFleetHtmlFiles(makeRepos(R1_FINISHES), 's1');
    const exported = JSON.parse(build!.exportJson!);
    expect(exported.races.map((r: { raceNumber: number }) => r.raceNumber)).toEqual([1]);
  });
});
