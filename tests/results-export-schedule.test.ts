/**
 * The Schedule page (ADR-014, Decision 4) through the shared build: every
 * race, sailed or not, from the full series; publishable before any entry;
 * and offered only when asked for.
 */
import { describe, expect, it } from 'vitest';

import type { ExportRepos } from '@/lib/public-export';
import { buildFleetHtmlFiles } from '@/lib/results-export';
import type { Competitor, Finish, Fleet, Race, RaceStart, Series } from '@/lib/types';

const SERIES: Series = {
  id: 's1', name: 'Autumn League', venue: 'Galway', startDate: '2026-10-01', endDate: '2026-11-30',
  venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '',
  createdAt: 0, lastSavedAt: null, lastModifiedAt: 0, scoringMode: 'scratch',
  discardThresholds: [], dnfScoring: 'seriesEntries', ftpHost: '', ftpPath: '', ftpPaths: {},
  includeJsonExport: false, enabledCompetitorFields: [], primaryPersonLabel: 'helm',
  subdivisionAxes: [], publishingGroups: [], publishIndividualFleetPages: true,
};

const FLEETS: Fleet[] = [
  { id: 'f1', seriesId: 's1', name: 'Cruisers 1', displayOrder: 0, scoringSystem: 'scratch' },
  { id: 'f2', seriesId: 's1', name: 'White Sails', displayOrder: 1, scoringSystem: 'scratch' },
];

const RACES: Race[] = [
  { id: 'r1', seriesId: 's1', raceNumber: 1, name: null, date: '2026-10-11', createdAt: 0 },
  { id: 'r2', seriesId: 's1', raceNumber: 2, name: 'Round the Islands', date: '2026-11-08', createdAt: 0 },
];

const STARTS: RaceStart[] = [
  { id: 'a', raceId: 'r1', fleetIds: ['f1'], startTime: '10:55:00' },
  { id: 'b', raceId: 'r1', fleetIds: ['f2'], startTime: '11:00:00' },
  { id: 'c', raceId: 'r2', fleetIds: ['f1', 'f2'] },
];

const COMPETITOR: Competitor = {
  id: 'c1', seriesId: 's1', fleetIds: ['f1'], sailNumber: '7', names: ['Helm 7'],
  clubs: [], gender: '', age: null, createdAt: 0,
};

const FINISH: Finish = {
  id: 'x', raceId: 'r1', competitorId: 'c1', sortOrder: 1, tiedWithPrevious: false, resultCode: null,
  startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null,
  redressExcludeRaceIds: null, redressIncludeRaceIds: null, redressIncludeAllLater: false, redressPoints: null,
};

function repos(competitors: Competitor[], finishes: Finish[]): ExportRepos {
  return {
    seriesRepo: { get: async () => SERIES },
    competitorRepo: { listBySeries: async () => competitors },
    raceRepo: { listBySeries: async () => RACES },
    fleetRepo: { listBySeries: async () => FLEETS },
    subSeriesRepo: { listBySeries: async () => [] },
    finishRepo: { listBySeries: async () => finishes },
    raceStartRepo: { listBySeries: async () => STARTS },
    raceRatingOverrideRepo: { listBySeries: async () => [] },
  } as unknown as ExportRepos;
}

describe('buildFleetHtmlFiles — the Schedule page', () => {
  it('publishes the schedule alone for a series with races and no entries', async () => {
    const build = await buildFleetHtmlFiles(repos([], []), 's1', undefined, { includeSchedule: true });
    expect(build!.files.map((f) => f.fleetName)).toEqual(['Schedule']);
    const page = build!.files[0];
    expect(page).toMatchObject({ isSchedule: true, isAuxiliary: true });
    expect(page.html).toContain('October 2026');
    expect(page.html).toContain('November 2026');
    expect(page.html).toContain('Round the Islands');
    expect(page.html).toContain('10:55</span> Cruisers 1');
    expect(page.html).toContain('time to be confirmed');
  });

  it('is not built unless asked for, so an entry-less series publishes nothing', async () => {
    expect(await buildFleetHtmlFiles(repos([], []), 's1')).toBeNull();
  });

  it('closes the page list once racing starts, every race on it, sailed or not', async () => {
    const build = await buildFleetHtmlFiles(repos([COMPETITOR], [FINISH]), 's1', undefined, { includeSchedule: true });
    const names = build!.files.map((f) => f.fleetName);
    expect(names.at(-1)).toBe('Schedule');
    const view = build!.files.at(-1)!.view;
    expect(view?.kind).toBe('schedule');
    if (view?.kind !== 'schedule') return;
    expect(view.races.map((r) => [r.race, r.sailed])).toEqual([[1, true], [2, false]]);
    // The results pages still publish only the race that was sailed.
    const fleetPage = build!.files.find((f) => f.fleetName === 'Cruisers 1')!;
    expect(fleetPage.html).not.toContain('Round the Islands');
  });
});
