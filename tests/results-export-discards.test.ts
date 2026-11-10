/**
 * A published standings page says how many races count, in the Standings
 * tab's words ("Best 5 of 18 count", "2 discards", "No discards"), over the
 * races that page's fleet sailed — whatever the rule, and whether or not a
 * sub-series follows the series' rule.
 */
import { describe, expect, it } from 'vitest';

import { buildFleetHtmlFiles } from '@/lib/results-export';
import type { ExportRepos } from '@/lib/public-export';
import type { Competitor, Finish, Fleet, PublishingGroup, Race, Series, SubSeries } from '@/lib/types';

function makeSeries(overrides: Partial<Series> = {}): Series {
  return {
    id: 's1', name: 'Autumn League', venue: 'HYC',
    startDate: '2026-09-01', endDate: '2026-10-30',
    venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '',
    createdAt: 0, lastSavedAt: null, lastModifiedAt: 0,
    scoringMode: 'scratch', discardThresholds: [], dnfScoring: 'seriesEntries',
    ftpHost: '', ftpPath: '', ftpPaths: {}, includeJsonExport: false,
    enabledCompetitorFields: [], primaryPersonLabel: 'helm', subdivisionAxes: [],
    ...overrides,
  };
}

const FLEETS: Fleet[] = [
  { id: 'f-a', seriesId: 's1', name: 'Class A', displayOrder: 0, scoringSystem: 'scratch' },
  { id: 'f-b', seriesId: 's1', name: 'Class B', displayOrder: 1, scoringSystem: 'scratch' },
];

const COMPETITORS: Competitor[] = [
  ['a1', '101', 'f-a'], ['a2', '102', 'f-a'], ['b1', '201', 'f-b'], ['b2', '202', 'f-b'],
].map(([id, sail, fleet]) => ({
  id, seriesId: 's1', fleetIds: [fleet], sailNumber: sail, names: [`Helm ${sail}`],
  clubs: [], gender: '', age: null, createdAt: 0,
}));

const RACES: Race[] = [1, 2, 3, 4, 5, 6].map((n) => ({
  id: `r${n}`, seriesId: 's1', raceNumber: n, name: null, date: `2026-09-0${n}`, createdAt: 0,
}));

const FINISHES: Finish[] = RACES.flatMap((race) =>
  COMPETITORS.map((c, i) => ({
    id: `${race.id}-${c.id}`, raceId: race.id, competitorId: c.id, sortOrder: (i % 2) + 1,
    tiedWithPrevious: false, resultCode: null, startPresent: null, penaltyCode: null,
    penaltyOverride: null, redressMethod: null, redressExcludeRaceIds: null,
    redressIncludeRaceIds: null, redressIncludeAllLater: false, redressPoints: null,
  })),
);

function makeRepos(series: Series, subSeries: SubSeries[] = []): ExportRepos {
  return {
    seriesRepo: { get: async (id: string) => (id === series.id ? series : undefined) },
    competitorRepo: { listBySeries: async () => COMPETITORS },
    raceRepo: { listBySeries: async () => RACES },
    fleetRepo: { listBySeries: async () => FLEETS },
    subSeriesRepo: { listBySeries: async () => subSeries },
    finishRepo: { listBySeries: async () => FINISHES },
    raceStartRepo: { listBySeries: async () => [] },
    raceRatingOverrideRepo: { listBySeries: async () => [] },
  } as unknown as ExportRepos;
}

async function pages(series: Series, subSeries: SubSeries[] = []) {
  const built = await buildFleetHtmlFiles(makeRepos(series, subSeries), 's1');
  return built!.files;
}

/** The page's lines under the results, as text. */
function notes(html: string): string[] {
  const block = /<div class="scoringcodes pointsnote">(.*?)<\/div>/.exec(html)?.[1] ?? '';
  return [...block.matchAll(/<p>(.*?)<\/p>/g)].map((m) => m[1].replace(/&#39;|&#x27;/g, "'"));
}

describe('published standings state the discard rule', () => {
  it('states a count-best rule as the Standings tab does', async () => {
    const files = await pages(makeSeries({ countBest: 4 }));
    for (const f of files) expect(notes(f.html)).toEqual(['Best 4 of 6 count.']);
  });

  it('states a threshold rule as the number of discards', async () => {
    const files = await pages(makeSeries({
      discardThresholds: [{ minRaces: 3, discardCount: 1 }, { minRaces: 6, discardCount: 2 }],
    }));
    for (const f of files) expect(notes(f.html)).toEqual(['2 discards.']);
  });

  it('states a proportional rule as the number of discards', async () => {
    const files = await pages(makeSeries({ proportionalDiscard: { firstAt: 4, everyRaces: 4 } }));
    for (const f of files) expect(notes(f.html)).toEqual(['1 discard.']);
  });

  it('says so when nothing is discarded', async () => {
    const files = await pages(makeSeries());
    for (const f of files) expect(notes(f.html)).toEqual(['No discards.']);
  });

  it('counts over the races the fleet sailed', async () => {
    // Class B's race 6 was struck: it sailed five, so it counts 4 of 5.
    const files = await pages(makeSeries({
      countBest: 4,
      raceFleetExclusions: [{ raceId: 'r6', fleetId: 'f-b' }],
    }));
    const byFleet = Object.fromEntries(files.map((f) => [f.fleetName, notes(f.html)]));
    expect(byFleet['Class A']).toEqual(['Best 4 of 6 count.']);
    expect(byFleet['Class B']).toEqual(['Best 4 of 5 count.']);
  });

  it('a combined page names each fleet where they count differently, and says it once where they agree', async () => {
    const overall: PublishingGroup = {
      id: 'g', name: 'Overall', fleetMode: 'all', fleetIds: [], detail: 'standings',
    };
    const struck = await pages(makeSeries({
      countBest: 4,
      publishingGroups: [overall],
      raceFleetExclusions: [{ raceId: 'r6', fleetId: 'f-b' }],
    }));
    expect(notes(struck.find((f) => f.isCombined)!.html))
      .toEqual(['Class A: Best 4 of 6 count. Class B: Best 4 of 5 count.']);

    const even = await pages(makeSeries({ countBest: 4, publishingGroups: [overall] }));
    expect(notes(even.find((f) => f.isCombined)!.html)).toEqual(['Best 4 of 6 count.']);
  });

  it('a sub-series following the series rule states it over its own races', async () => {
    const files = await pages(makeSeries({ countBest: 2 }), [
      { id: 'ss-1', seriesId: 's1', name: 'September', displayOrder: 0, raceIds: ['r1', 'r2', 'r3'] },
    ]);
    const september = files.filter((f) => f.subSeriesName === 'September');
    expect(september.length).toBeGreaterThan(0);
    for (const f of september) expect(notes(f.html)).toEqual(['Best 2 of 3 count.']);
  });

  it('a sub-series with its own rule states the count and the rule', async () => {
    const files = await pages(makeSeries({ countBest: 5 }), [
      {
        id: 'ss-1', seriesId: 's1', name: 'Coastal', displayOrder: 0, raceIds: ['r1', 'r2', 'r3', 'r4'],
        discards: { kind: 'countBest', countBest: 3 },
      },
    ]);
    const coastal = files.filter((f) => f.subSeriesName === 'Coastal');
    expect(coastal.length).toBeGreaterThan(0);
    for (const f of coastal) {
      expect(notes(f.html)).toEqual([
        'Best 3 of 4 count.',
        "This sub-series counts each boat's best 3 races.",
      ]);
    }
  });
});
