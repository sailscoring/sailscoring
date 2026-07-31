import { describe, it, expect } from 'vitest';
import {
  getDiscardCount,
  calculateStandings,
  calculateFleetStandings,
  calculateSubSeriesFleetStandings,
} from '@/lib/scoring';
import type {
  Competitor, Fleet, Race, Finish, SubSeries, DiscardThreshold, ProportionalDiscard,
} from '@/lib/types';

/**
 * A discard allowance stated as a proportion (#341) — "one third of the results
 * are discarded", "one discard for every three races sailed" — in place of a
 * threshold list.
 */

function makeCompetitor(id: string, fleetId = 'f1'): Competitor {
  return { id, seriesId: 's1', fleetIds: [fleetId], sailNumber: id, names: [id], club: '', gender: '', age: null, createdAt: 0 };
}

function makeRace(id: string, raceNumber: number): Race {
  return { id, seriesId: 's1', raceNumber, name: null, date: '2026-01-01', createdAt: 0 };
}

function makeFinish(raceId: string, competitorId: string, sortOrder: number): Finish {
  return { id: `${raceId}-${competitorId}`, raceId, competitorId, sortOrder, resultCode: null, startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null, redressExcludeRaceIds: null, redressIncludeRaceIds: null, tiedWithPrevious: false, redressIncludeAllLater: false, redressPoints: null };
}

const oneEveryThree: ProportionalDiscard = { firstAt: 3, everyRaces: 3 };

describe('getDiscardCount — proportional rule', () => {
  it('gives one discard per three races sailed', () => {
    const counts = Array.from({ length: 15 }, (_, i) => getDiscardCount(i + 1, [], oneEveryThree));
    //                    1  2  3  4  5  6  7  8  9 10 11 12 13 14 15
    expect(counts).toEqual([0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5]);
  });

  it('rounds down, matching the Shanklin SC wording', () => {
    // "One third of the results … will be discarded (rounded down to the
    // nearest whole number - eg 7 races = 2 discards)."
    expect(getDiscardCount(7, [], oneEveryThree)).toBe(2);
  });

  it('starts the run wherever the SI puts the first discard', () => {
    // "First discard once 5 races are sailed, then one more every 3."
    const fiveThenThree: ProportionalDiscard = { firstAt: 5, everyRaces: 3 };
    expect(getDiscardCount(4, [], fiveThenThree)).toBe(0);
    expect(getDiscardCount(5, [], fiveThenThree)).toBe(1);
    expect(getDiscardCount(7, [], fiveThenThree)).toBe(1);
    expect(getDiscardCount(8, [], fiveThenThree)).toBe(2);
    expect(getDiscardCount(11, [], fiveThenThree)).toBe(3);
  });

  it('supersedes the thresholds the series also carries', () => {
    const thresholds: DiscardThreshold[] = [{ minRaces: 5, discardCount: 1 }];
    expect(getDiscardCount(6, thresholds)).toBe(1);
    expect(getDiscardCount(6, thresholds, oneEveryThree)).toBe(2);
  });

  it('falls back to the thresholds when there is no rule', () => {
    const thresholds: DiscardThreshold[] = [{ minRaces: 5, discardCount: 1 }];
    expect(getDiscardCount(6, thresholds, undefined)).toBe(1);
  });

  it('yields nothing for a zero interval rather than dividing by it', () => {
    expect(getDiscardCount(10, [], { firstAt: 1, everyRaces: 0 })).toBe(0);
  });

  it('shows where the hand-typed HYC profile drifts from the rule', () => {
    // The 2026 HYC file lists this 24-entry approximation of "one discard per
    // three races". It tracks the rule to 11 races, then holds 3 for a fourth
    // race — and never catches up: every later step-up lands one race late, so
    // the profile stays one discard behind for the rest of the series and ends
    // at 7 where the rule gives 8.
    const hycList = [0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7, 7];
    const differing = hycList
      .map((v, i) => (v === getDiscardCount(i + 1, [], oneEveryThree) ? null : i + 1))
      .filter((n): n is number => n !== null);
    expect(differing).toEqual([12, 15, 18, 21, 24]);
    expect(getDiscardCount(24, [], oneEveryThree)).toBe(8);
  });
});

// ─── Every public entry point honours the rule ───────────────────────────────
//
// The rule rides as an optional trailing argument, so a call site that forgets
// it still compiles and scores with the thresholds instead. These pin each
// entry point so a missed one fails here rather than in published results.

describe('proportional discards reach every scoring entry point', () => {
  const competitors = ['A', 'B'].map((id) => makeCompetitor(id));
  const fleets: Fleet[] = [{ id: 'f1', seriesId: 's1', name: 'Fleet', displayOrder: 0, scoringSystem: 'scratch' }];
  const races = [1, 2, 3].map((n) => makeRace(`r${n}`, n));
  // A wins every race; B is second twice and last-but-scoring 2 in race 3, so
  // one discard changes B's net and nobody else's.
  const finishes: Finish[] = [
    makeFinish('r1', 'A', 1), makeFinish('r1', 'B', 2),
    makeFinish('r2', 'A', 1), makeFinish('r2', 'B', 2),
    makeFinish('r3', 'A', 1), makeFinish('r3', 'B', 2),
  ];

  // Three races sailed → one discard under the rule, none under the thresholds
  // (which only start at 5), so the two are distinguishable.
  const thresholds: DiscardThreshold[] = [{ minRaces: 5, discardCount: 1 }];

  it('calculateStandings', () => {
    const { standings } = calculateStandings(
      competitors, races, finishes, thresholds, 'seriesEntries', undefined, undefined, oneEveryThree,
    );
    const b = standings.find((s) => s.competitor.id === 'B')!;
    expect(b.raceDiscards.filter(Boolean)).toHaveLength(1);
    expect(b.netPoints).toBe(4); // 2 + 2 + 2, worst dropped
  });

  it('calculateFleetStandings', () => {
    const { fleetStandings } = calculateFleetStandings(
      fleets, competitors, races, finishes, thresholds, 'seriesEntries',
      [], [], undefined, undefined, oneEveryThree,
    );
    const b = fleetStandings[0].standings.find((s) => s.competitor.id === 'B')!;
    expect(b.raceDiscards.filter(Boolean)).toHaveLength(1);
  });

  it('calculateSubSeriesFleetStandings', () => {
    const subSeries: SubSeries[] = [{
      id: 'ss1', seriesId: 's1', name: 'Block', displayOrder: 0,
      raceIds: races.map((r) => r.id), startingHandicapSource: 'series',
      continueFromSubSeriesId: null, createdAt: 0,
    }];
    const blocks = calculateSubSeriesFleetStandings(
      subSeries, fleets, competitors, races, finishes, thresholds, 'seriesEntries',
      [], [], false, oneEveryThree,
    );
    const b = blocks[0].fleetStandings[0].standings.find((s) => s.competitor.id === 'B')!;
    expect(b.raceDiscards.filter(Boolean)).toHaveLength(1);
  });

  it('caps the allowance at the races actually sailed', () => {
    // firstAt 0 makes the rule outrun the race count: at 3 races it asks for 4.
    const greedy: ProportionalDiscard = { firstAt: 0, everyRaces: 1 };
    expect(getDiscardCount(3, [], greedy)).toBe(4);
    const { standings } = calculateStandings(
      competitors, races, finishes, [], 'seriesEntries', undefined, undefined, greedy,
    );
    const b = standings.find((s) => s.competitor.id === 'B')!;
    expect(b.raceDiscards.filter(Boolean)).toHaveLength(3);
    expect(b.netPoints).toBe(0);
  });
});
