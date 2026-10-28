import { describe, it, expect } from 'vitest';
import { courseLapsOf, fullCourseElapsed, lapsDiffer } from '@/lib/laps';
import { calculateFleetStandings } from '@/lib/scoring';
import type { Competitor, Finish, Fleet, Race, RaceStart } from '@/lib/types';

describe('courseLapsOf', () => {
  it('is the most laps any finish records', () => {
    expect(courseLapsOf([{ laps: 1 }, { laps: 3 }, {}, { laps: 2 }])).toBe(3);
  });
  it('is null when no finish records a count', () => {
    expect(courseLapsOf([{}, {}])).toBeNull();
  });
});

describe('lapsDiffer', () => {
  it('is false when every count is the same', () => {
    expect(lapsDiffer([{ laps: 2 }, { laps: 2 }])).toBe(false);
  });
  it('is false when no finish records a count', () => {
    expect(lapsDiffer([{}, {}])).toBe(false);
  });
  it('reads a row with no count as the full course', () => {
    expect(lapsDiffer([{ laps: 2 }, {}])).toBe(false);
    expect(lapsDiffer([{ laps: 1 }, { laps: 2 }, {}])).toBe(true);
  });
});

describe('fullCourseElapsed', () => {
  it('scales a boat on fewer laps up to the full course', () => {
    expect(fullCourseElapsed(1421, 1, 2)).toBe(2842);
    expect(fullCourseElapsed(2827, 2, 3)).toBe(4240.5);
  });
  it('leaves a boat on the full course, or with no count, alone', () => {
    expect(fullCourseElapsed(1575, 2, 2)).toBe(1575);
    expect(fullCourseElapsed(1575, undefined, 2)).toBe(1575);
    expect(fullCourseElapsed(1575, 1, null)).toBe(1575);
  });
});

describe('a fleet the lap counts cannot apply to', () => {
  const fleet: Fleet = { id: 'fl', seriesId: 's', name: 'Toppers', displayOrder: 0, scoringSystem: 'scratch' };
  const competitors: Competitor[] = ['1', '2', '3'].map((sail) => ({
    id: `c${sail}`, seriesId: 's', fleetIds: ['fl'], sailNumber: sail, names: [sail], clubs: [], gender: '', age: null, createdAt: 0,
  }));
  const races: Race[] = [
    { id: 'r1', seriesId: 's', raceNumber: 1, name: null, date: '2026-10-01', createdAt: 0 },
    { id: 'r2', seriesId: 's', raceNumber: 2, name: null, date: '2026-10-01', createdAt: 0 },
  ];
  const starts: RaceStart[] = races.map((r) => ({ id: `st-${r.id}`, raceId: r.id, fleetIds: ['fl'], startTime: '11:00:00' }));
  const finish = (raceId: string, cid: string, sortOrder: number, laps?: number): Finish => ({
    id: `${raceId}-${cid}`, raceId, competitorId: cid, sortOrder, tiedWithPrevious: false,
    ...(laps != null ? { laps } : {}),
    resultCode: null, startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null,
    redressExcludeRaceIds: null, redressIncludeRaceIds: null, redressIncludeAllLater: false, redressPoints: null,
  });

  it('reports a race ranked on finishing order with boats on different laps', () => {
    const finishes = [
      finish('r1', 'c1', 1, 2), finish('r1', 'c2', 2, 1), finish('r1', 'c3', 3, 2),
      finish('r2', 'c1', 1), finish('r2', 'c2', 2), finish('r2', 'c3', 3),
    ];
    const { fleetStandings } = calculateFleetStandings([fleet], competitors, races, finishes, [], 'seriesEntries', starts);
    expect(fleetStandings[0].raceGaps).toEqual([{ raceId: 'r1', fleetId: 'fl', reason: 'laps_not_applied' }]);
    // Scored on the order they crossed the line, as before.
    expect(fleetStandings[0].standings.find((s) => s.competitor.id === 'c2')!.racePoints[0]).toBe(2);
  });
});
