import { describe, it, expect } from 'vitest';

import { makeFinish } from '@/lib/finish-entry';
import { oneFinishPerCompetitor } from '@/lib/finish-rows';
import { calculateHandicapRaceScores, calculateRaceScores } from '@/lib/scoring';
import type { Competitor, RaceStart } from '@/lib/types';

function comp(id: string): Competitor {
  return { id, seriesId: 's1', fleetIds: ['f1'], sailNumber: id, names: [id], clubs: [], gender: '', age: null, createdAt: 0 };
}

describe('oneFinishPerCompetitor', () => {
  it('returns the rows unchanged when no boat has two', () => {
    const rows = [
      makeFinish('r1', { id: 'a', competitorId: 'A', sortOrder: 1 }),
      makeFinish('r1', { id: 'u', competitorId: null, unknownSailNumber: '99', sortOrder: 2 }),
      makeFinish('r1', { id: 'b', competitorId: 'B', resultCode: 'DNF' }),
    ];
    expect(oneFinishPerCompetitor(rows)).toEqual(rows);
  });

  it('keeps the placed row over a coded or check-in row, whichever comes last', () => {
    const placed = makeFinish('r1', { id: 'p', competitorId: 'A', sortOrder: 3 });
    const coded = makeFinish('r1', { id: 'c', competitorId: 'A', resultCode: 'DNF', finishTime: '12:31:10' });
    const checkIn = makeFinish('r1', { id: 'k', competitorId: 'B', startPresent: true });
    const placedB = makeFinish('r1', { id: 'pb', competitorId: 'B', sortOrder: 1, finishTime: '12:20:00' });
    expect(oneFinishPerCompetitor([coded, placed, checkIn, placedB]).map((f) => f.id)).toEqual(['p', 'pb']);
    expect(oneFinishPerCompetitor([placed, coded, placedB, checkIn]).map((f) => f.id)).toEqual(['p', 'pb']);
  });

  it('keeps the later of two rows equally placed', () => {
    const first = makeFinish('r1', { id: 'x', competitorId: 'A', startPresent: true });
    const second = makeFinish('r1', { id: 'y', competitorId: 'A', resultCode: 'DNF' });
    expect(oneFinishPerCompetitor([first, second]).map((f) => f.id)).toEqual(['y']);
  });

  it('keeps every unknown row', () => {
    const rows = [
      makeFinish('r1', { id: 'u1', competitorId: null, unknownSailNumber: '99', sortOrder: 1 }),
      makeFinish('r1', { id: 'u2', competitorId: null, unknownSailNumber: '99', sortOrder: 2 }),
      makeFinish('r1', { id: 'a', competitorId: 'A', sortOrder: 3 }),
      makeFinish('r1', { id: 'a2', competitorId: 'A', resultCode: 'DNF' }),
    ];
    expect(oneFinishPerCompetitor(rows).map((f) => f.id)).toEqual(['u1', 'u2', 'a']);
  });
});

describe('scoring a boat stored with two rows', () => {
  it('scores her placed row, not a stray coded row after it', () => {
    const cs = ['A', 'B', 'C'].map(comp);
    const finishes = [
      makeFinish('r1', { id: 'a', competitorId: 'A', sortOrder: 1 }),
      makeFinish('r1', { id: 'b', competitorId: 'B', sortOrder: 2 }),
      makeFinish('r1', { id: 'c', competitorId: 'C', sortOrder: 3 }),
      makeFinish('r1', { id: 'b2', competitorId: 'B', resultCode: 'DNF' }),
    ];
    const scores = calculateRaceScores(finishes, cs, 'startingArea');
    expect(scores.get('B')).toMatchObject({ points: 2, resultCode: null });
  });

  it('does not count her twice towards the starting area', () => {
    const cs = ['A', 'B', 'C', 'D'].map(comp);
    const finishes = [
      makeFinish('r1', { id: 'a', competitorId: 'A', sortOrder: 1 }),
      makeFinish('r1', { id: 'a2', competitorId: 'A', startPresent: true }),
      makeFinish('r1', { id: 'b', competitorId: 'B', resultCode: 'DNF' }),
    ];
    // Came to the starting area: A and B. A DNF scores starters + 1 = 3.
    const scores = calculateRaceScores(finishes, cs, 'startingArea');
    expect(scores.get('B')!.points).toBe(3);
  });

  it('times a handicap boat off her placed row', () => {
    const cs = ['A', 'B'].map(comp);
    const tcf = new Map([['A', 1], ['B', 1]]);
    const start: RaceStart = { id: 'rs', raceId: 'r1', fleetIds: ['f1'], startTime: '11:53:00' };
    const finishes = [
      makeFinish('r1', { id: 'a', competitorId: 'A', sortOrder: 1, finishTime: '12:28:24' }),
      makeFinish('r1', { id: 'b2', competitorId: 'B', resultCode: 'DNF', finishTime: '12:20:00' }),
      makeFinish('r1', { id: 'b', competitorId: 'B', sortOrder: 2, finishTime: '12:31:10' }),
      makeFinish('r1', { id: 'a2', competitorId: 'A', resultCode: 'DNF' }),
    ];
    const { scores } = calculateHandicapRaceScores(finishes, cs, start, tcf, 'startingArea');
    expect(scores.get('A')).toMatchObject({ place: 1, resultCode: null });
    expect(scores.get('B')).toMatchObject({ place: 2, resultCode: null });
  });
});
