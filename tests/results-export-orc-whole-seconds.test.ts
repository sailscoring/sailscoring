/**
 * An ORC fleet is scored on elapsed times to the second (ORC 401.2), so its
 * page shows the times it was scored on: a boat timed at 2151.6 s after a
 * 14:00:00 gun finished at 14:35:52, with an elapsed time of 35:52, not at
 * 14:35:51 (the stopwatch reading of the time of day) beside 35:51.6. A fleet
 * on another system in the same start keeps the fraction.
 */
import { describe, it, expect } from 'vitest';

import { buildFleetHtmlFiles } from '@/lib/results-export';
import type { ExportRepos } from '@/lib/public-export';
import type { Competitor, Finish, Fleet, Race, RaceStart, Series } from '@/lib/types';

const FLEETS: Fleet[] = [
  { id: 'f-orc', seriesId: 's1', name: 'Class 1 (ORC)', displayOrder: 0, scoringSystem: 'orc', orcProfile: { option: 'APHT', kind: 'tot' } },
  { id: 'f-irc', seriesId: 's1', name: 'Class 1 (IRC)', displayOrder: 1, scoringSystem: 'irc' },
];

function comp(id: string, sail: string, apht: number, ircTcc: number): Competitor {
  return {
    id,
    seriesId: 's1',
    fleetIds: ['f-orc', 'f-irc'],
    sailNumber: sail,
    names: [`Helm ${sail}`],
    clubs: [],
    gender: '',
    age: null,
    createdAt: 0,
    ircTcc,
    orcCert: { record: { APHT: apht }, importedAt: 0 },
  };
}

const COMPETITORS: Competitor[] = [comp('c1', '101', 1.0089, 1.0), comp('c2', '102', 0.9631, 0.95)];

const RACES: Race[] = [
  { id: 'r1', seriesId: 's1', raceNumber: 1, name: null, date: '2026-09-05', createdAt: 0 },
];

const STARTS: RaceStart[] = [
  { id: 'rs1', raceId: 'r1', fleetIds: ['f-orc', 'f-irc'], startTime: '14:00:00' },
];

function finish(competitorId: string, sortOrder: number, elapsedSecs: number): Finish {
  return {
    id: `r1-${competitorId}`,
    raceId: 'r1',
    competitorId,
    sortOrder,
    elapsedSecs,
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

const FINISHES: Finish[] = [finish('c1', 1, 2151.6), finish('c2', 2, 2253.2)];

function makeSeries(): Series {
  return {
    id: 's1',
    name: 'Autumn League',
    venue: 'RCYC',
    startDate: '2026-09-01',
    endDate: '2026-10-30',
    venueLogoUrl: '',
    eventLogoUrl: '',
    venueUrl: '',
    eventUrl: '',
    createdAt: 0,
    lastSavedAt: null,
    lastModifiedAt: 0,
    scoringMode: 'handicap',
    discardThresholds: [],
    dnfScoring: 'seriesEntries',
    ftpHost: '',
    ftpPath: '',
    ftpPaths: {},
    includeJsonExport: false,
    enabledCompetitorFields: ['club'],
    primaryPersonLabel: 'helm',
    subdivisionAxes: [],
    publishIndividualFleetPages: true,
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
    raceStartRepo: { listBySeries: async () => STARTS },
    raceRatingOverrideRepo: { listBySeries: async () => [] },
  } as unknown as ExportRepos;
}

async function pages() {
  const build = await buildFleetHtmlFiles(makeRepos(makeSeries()), 's1');
  return new Map(build!.files.map((f) => [f.fleetName, f.html]));
}

describe('an ORC fleet timed to a fraction of a second', () => {
  it('shows the finish and elapsed times it was scored on, to the second', async () => {
    const html = (await pages()).get('Class 1 (ORC)')!;
    expect(html).toContain('>14:35:52<');
    expect(html).toContain('>35:52<');
    expect(html).not.toContain('35:51.6');
    // Corrected from the rounded time: 2152 × 1.0089 = 2171.15, so 36:11.
    expect(html).toContain('>36:11<');
  });

  it('leaves the fraction to a fleet on another system in the same start', async () => {
    const html = (await pages()).get('Class 1 (IRC)')!;
    expect(html).toContain('>35:51.6<');
  });
});
