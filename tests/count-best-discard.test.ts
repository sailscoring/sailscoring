import { describe, it, expect } from 'vitest';
import {
  getDiscardCount,
  discardRuleOf,
  calculateStandings,
  calculateFleetStandings,
  calculateSubSeriesFleetStandings,
} from '@/lib/scoring';
import { buildPublicExportFromSnapshot } from '@/lib/public-export';
import type { SeriesSnapshot } from '@/lib/series-snapshot';
import type {
  Competitor, CountBestDiscard, DiscardThreshold, Finish, Fleet, Race, RaceStart, Series, SubSeries,
} from '@/lib/types';

/**
 * A discard allowance stated as the number of races that count — ISORA's
 * "best 5 results out of all sailed races", Sailwave's `s-5`.
 */

function makeCompetitor(id: string, fleetIds = ['f1']): Competitor {
  return { id, seriesId: 's1', fleetIds, sailNumber: id, names: [id], clubs: [], gender: '', age: null, createdAt: 0 };
}

function makeRace(id: string, raceNumber: number): Race {
  return { id, seriesId: 's1', raceNumber, name: null, date: '2026-01-01', createdAt: 0 };
}

function makeFinish(raceId: string, competitorId: string, sortOrder: number | null, resultCode: Finish['resultCode'] = null): Finish {
  return { id: `${raceId}-${competitorId}`, raceId, competitorId, sortOrder, resultCode, startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null, redressExcludeRaceIds: null, redressIncludeRaceIds: null, tiedWithPrevious: false, redressIncludeAllLater: false, redressPoints: null };
}

const bestThree: CountBestDiscard = { countBest: 3 };

describe('getDiscardCount — count the best N', () => {
  it('discards every race sailed past N, and nothing before', () => {
    const counts = Array.from({ length: 8 }, (_, i) => getDiscardCount(i + 1, [], { countBest: 5 }));
    //                    1  2  3  4  5  6  7  8
    expect(counts).toEqual([0, 0, 0, 0, 0, 1, 2, 3]);
  });

  it('gives ISORA 2026 its 13 discards over 18 races', () => {
    expect(getDiscardCount(18, [], { countBest: 5 })).toBe(13);
    expect(getDiscardCount(0, [], { countBest: 5 })).toBe(0);
  });

  it('supersedes the thresholds the series also carries', () => {
    expect(getDiscardCount(4, [{ minRaces: 1, discardCount: 3 }], bestThree)).toBe(1);
  });
});

describe('discardRuleOf', () => {
  it('prefers the count-best rule over a proportional one kept beside it', () => {
    expect(discardRuleOf({ countBest: 5, proportionalDiscard: { firstAt: 3, everyRaces: 3 } })).toEqual({ countBest: 5 });
  });

  it('falls back to the proportional rule, then to none', () => {
    expect(discardRuleOf({ proportionalDiscard: { firstAt: 3, everyRaces: 3 } })).toEqual({ firstAt: 3, everyRaces: 3 });
    expect(discardRuleOf({})).toBeUndefined();
  });
});

// The rule rides as an optional trailing argument, so a caller that forgets it
// still compiles and scores with the thresholds instead. These pin each entry
// point so a missed one fails here rather than in published results.

describe('count-best discards reach every scoring entry point', () => {
  const competitors = ['A', 'B'].map((id) => makeCompetitor(id));
  const fleets: Fleet[] = [{ id: 'f1', seriesId: 's1', name: 'Fleet', displayOrder: 0, scoringSystem: 'scratch' }];
  const races = [1, 2, 3, 4].map((n) => makeRace(`r${n}`, n));
  const finishes: Finish[] = races.flatMap((r) => [makeFinish(r.id, 'A', 1), makeFinish(r.id, 'B', 2)]);
  // Four races with no thresholds: one discard under the rule, none without it.
  const thresholds: DiscardThreshold[] = [];

  it('calculateStandings', () => {
    const { standings } = calculateStandings(
      competitors, races, finishes, thresholds, 'seriesEntries', undefined, undefined, bestThree,
    );
    const b = standings.find((s) => s.competitor.id === 'B')!;
    expect(b.raceDiscards.filter(Boolean)).toHaveLength(1);
    expect(b.netPoints).toBe(6);
  });

  it('calculateFleetStandings', () => {
    const { fleetStandings } = calculateFleetStandings(
      fleets, competitors, races, finishes, thresholds, 'seriesEntries',
      [], [], undefined, undefined, bestThree,
    );
    const b = fleetStandings[0].standings.find((s) => s.competitor.id === 'B')!;
    expect(b.raceDiscards.filter(Boolean)).toHaveLength(1);
  });

  it('calculateSubSeriesFleetStandings', () => {
    const subSeries: SubSeries[] = [{
      id: 'ss1', seriesId: 's1', name: 'Block', displayOrder: 0,
      raceIds: races.map((r) => r.id), startingHandicapSource: 'base',
      continueFromSubSeriesId: null,
    }];
    const blocks = calculateSubSeriesFleetStandings(
      subSeries, fleets, competitors, races, finishes, thresholds, 'seriesEntries',
      [], [], false, bestThree,
    );
    const b = blocks[0].fleetStandings[0].standings.find((s) => s.competitor.id === 'B')!;
    expect(b.raceDiscards.filter(Boolean)).toHaveLength(1);
  });

  it('a published export scores with the series’ rule', () => {
    const series = {
      id: 's1', name: 'Coastal', venue: '', startDate: '2026-04-01', endDate: '', venueLogoUrl: '',
      eventLogoUrl: '', venueUrl: '', eventUrl: '', createdAt: 0, lastSavedAt: null, lastModifiedAt: 0,
      scoringMode: 'scratch', discardThresholds: [], countBest: 3, dnfScoring: 'seriesEntries',
      ftpHost: '', ftpPath: '', ftpPaths: {}, includeJsonExport: true, enabledCompetitorFields: [],
      primaryPersonLabel: 'helm', subdivisionAxes: [],
    } as Series;
    const snapshot: SeriesSnapshot = {
      series, competitors, fleets, races, subSeries: [], finishes, raceStarts: [], ratingOverrides: [],
    };
    const data = buildPublicExportFromSnapshot(snapshot)!;
    const b = data.standings[0].rows.find((r) => r.sailNumber === 'B')!;
    expect(b.netPoints).toBe(6);
  });
});

describe('each fleet counts its own races', () => {
  // Modelled on ISORA 2026: the Two-Handed fleet had starts in fewer races
  // than the series. Six races, best 3: the crewed fleet discards 3, the
  // two-handed fleet — in races 1, 3, 5 and 6 only — discards 1.
  const fleets: Fleet[] = [
    { id: 'crewed', seriesId: 's1', name: 'Crewed', displayOrder: 0, scoringSystem: 'scratch' },
    { id: 'dh', seriesId: 's1', name: 'Two-Handed', displayOrder: 1, scoringSystem: 'scratch' },
  ];
  const competitors = [
    makeCompetitor('C1', ['crewed']), makeCompetitor('C2', ['crewed']),
    makeCompetitor('D1', ['dh']), makeCompetitor('D2', ['dh']),
  ];
  const races = [1, 2, 3, 4, 5, 6].map((n) => makeRace(`r${n}`, n));
  const dhRaces = new Set(['r1', 'r3', 'r5', 'r6']);
  const raceStarts: RaceStart[] = races.map((r) => ({
    id: `${r.id}-s`, raceId: r.id, startNumber: 1,
    fleetIds: dhRaces.has(r.id) ? ['crewed', 'dh'] : ['crewed'],
    startTime: '10:00:00',
  } as RaceStart));
  const finishes: Finish[] = races.flatMap((r) => [
    makeFinish(r.id, 'C1', 1), makeFinish(r.id, 'C2', 2),
    ...(dhRaces.has(r.id) ? [makeFinish(r.id, 'D1', 1), makeFinish(r.id, 'D2', 2)] : []),
  ]);

  it('discards (races the fleet sailed − N)', () => {
    const { fleetStandings } = calculateFleetStandings(
      fleets, competitors, races, finishes, [], 'seriesEntries', raceStarts, [], undefined, undefined, bestThree,
    );
    const byFleet = new Map(fleetStandings.map((fs) => [fs.fleet.id, fs.standings]));
    const c2 = byFleet.get('crewed')!.find((s) => s.competitor.id === 'C2')!;
    const d2 = byFleet.get('dh')!.find((s) => s.competitor.id === 'D2')!;
    expect(c2.raceDiscards.filter(Boolean)).toHaveLength(3);
    expect(c2.netPoints).toBe(6);
    expect(d2.raceDiscards.filter(Boolean)).toHaveLength(1);
    expect(d2.netPoints).toBe(6);
  });
});
