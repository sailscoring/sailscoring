/**
 * A sub-series' own discard rule: in place of the series', over the
 * sub-series' own races. ISORA's coastal series count their best 3 inside a
 * season counting its best 5, and its Points Series counts every race.
 */
import { describe, it, expect } from 'vitest';
import { calculateSubSeriesFleetStandings, subSeriesDiscardsOf } from '@/lib/scoring';
import type { Competitor, Finish, Fleet, Race, SubSeries } from '@/lib/types';

const fleet: Fleet = { id: 'f1', seriesId: 's1', name: 'Fleet', displayOrder: 0, scoringSystem: 'scratch' };

function boat(id: string): Competitor {
  return { id, seriesId: 's1', fleetIds: ['f1'], sailNumber: id, names: [id], clubs: [], gender: '', age: null, createdAt: 0 };
}

function race(n: number): Race {
  return { id: `r${n}`, seriesId: 's1', raceNumber: n, name: null, date: '2026-05-01', createdAt: 0 };
}

function finish(raceId: string, competitorId: string, sortOrder: number): Finish {
  return { id: `${raceId}-${competitorId}`, raceId, competitorId, sortOrder, tiedWithPrevious: false, resultCode: null, startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null, redressExcludeRaceIds: null, redressIncludeRaceIds: null, redressIncludeAllLater: false, redressPoints: null };
}

// Seven races; A wins the odd ones and is 2nd in the even ones, B the reverse.
const races = [1, 2, 3, 4, 5, 6, 7].map(race);
const competitors = [boat('A'), boat('B')];
const finishes = races.flatMap((r) =>
  r.raceNumber % 2 === 1
    ? [finish(r.id, 'A', 1), finish(r.id, 'B', 2)]
    : [finish(r.id, 'B', 1), finish(r.id, 'A', 2)],
);

function block(discards: SubSeries['discards'], raceIds = ['r1', 'r2', 'r3', 'r4', 'r5']): SubSeries {
  return { id: 'ss', seriesId: 's1', name: 'Coastal', displayOrder: 0, raceIds, ...(discards ? { discards } : {}) };
}

/** Scored inside a series counting its best 5 races. */
function score(ss: SubSeries) {
  const [result] = calculateSubSeriesFleetStandings(
    [ss], [fleet], competitors, races, finishes, [], 'seriesEntries', [], [], false, { countBest: 5 },
  );
  const standings = result.fleetStandings[0].standings;
  const of = (id: string) => standings.find((s) => s.competitor.id === id)!;
  return { a: of('A'), b: of('B') };
}

const discardCount = (s: { raceDiscards: boolean[] }) => s.raceDiscards.filter(Boolean).length;

describe('subSeriesDiscardsOf', () => {
  const thresholds = [{ minRaces: 4, discardCount: 1 }];
  it('is the series\' rule when the sub-series states none', () => {
    expect(subSeriesDiscardsOf({}, thresholds, { countBest: 5 })).toEqual({ thresholds, rule: { countBest: 5 } });
  });
  it('replaces both the series\' thresholds and its rule', () => {
    expect(subSeriesDiscardsOf({ discards: { kind: 'none' } }, thresholds, { countBest: 5 })).toEqual({ thresholds: [], rule: undefined });
    expect(subSeriesDiscardsOf({ discards: { kind: 'countBest', countBest: 3 } }, thresholds, undefined)).toEqual({ thresholds: [], rule: { countBest: 3 } });
    expect(subSeriesDiscardsOf({ discards: { kind: 'steps', thresholds: [{ minRaces: 2, discardCount: 1 }] } }, thresholds, { countBest: 5 }))
      .toEqual({ thresholds: [{ minRaces: 2, discardCount: 1 }], rule: undefined });
    expect(subSeriesDiscardsOf({ discards: { kind: 'proportional', firstAt: 3, everyRaces: 3 } }, thresholds, { countBest: 5 }))
      .toEqual({ thresholds: [], rule: { firstAt: 3, everyRaces: 3 } });
  });
});

describe('a sub-series scores with its own discard rule', () => {
  it('as the series, best 5 of a five-race block discards nothing', () => {
    const { a, b } = score(block(undefined));
    expect(discardCount(a)).toBe(0);
    expect(discardCount(b)).toBe(0);
  });

  it('best 3 of five races discards two, each boat its worst', () => {
    const { a, b } = score(block({ kind: 'countBest', countBest: 3 }));
    // A: 1,2,1,2,1 → drops both 2s; B: 2,1,2,1,2 → drops two of its 2s.
    expect(a.raceDiscards).toEqual([false, true, false, true, false]);
    expect(a.netPoints).toBe(3);
    expect(discardCount(b)).toBe(2);
    expect(b.netPoints).toBe(4);
  });

  it('no discards counts every race of the block, whatever the series says', () => {
    const { a } = score(block({ kind: 'none' }, races.map((r) => r.id)));
    expect(discardCount(a)).toBe(0);
    expect(a.netPoints).toBe(a.totalPoints);
    expect(a.totalPoints).toBe(10);
  });

  it('a threshold list of its own', () => {
    const { a } = score(block({ kind: 'steps', thresholds: [{ minRaces: 4, discardCount: 1 }] }));
    expect(discardCount(a)).toBe(1);
  });

  it('a proportional rule of its own', () => {
    const { a } = score(block({ kind: 'proportional', firstAt: 2, everyRaces: 2 }));
    // 5 sailed: 1 + floor((5 − 2) / 2) = 2.
    expect(discardCount(a)).toBe(2);
  });
});
