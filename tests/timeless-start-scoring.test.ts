import { describe, it, expect } from 'vitest';

import { calculateFleetStandings } from '@/lib/scoring';
import type { Competitor, Finish, Fleet, Race, RaceStart } from '@/lib/types';

// An IRC fleet where the crossing order (A then B) disagrees with the
// corrected-time order (B's lower TCC pulls it ahead once a gun time exists).
const fleet: Fleet = { id: 'f1', seriesId: 's1', name: 'IRC', displayOrder: 0, scoringSystem: 'irc' };

const compA: Competitor = {
  id: 'a', seriesId: 's1', fleetIds: ['f1'], sailNumber: 'A', name: 'A', club: '',
  gender: '', age: null, createdAt: 0, ircTcc: 1.100,
};
const compB: Competitor = {
  id: 'b', seriesId: 's1', fleetIds: ['f1'], sailNumber: 'B', name: 'B', club: '',
  gender: '', age: null, createdAt: 0, ircTcc: 0.900,
};
const competitors = [compA, compB];
const races: Race[] = [{ id: 'r1', seriesId: 's1', raceNumber: 1, name: null, date: '2025-01-01', createdAt: 0 }];

const finish = (competitorId: string, sortOrder: number, finishTime: string): Finish => ({
  id: `r1-${competitorId}`, raceId: 'r1', competitorId, sortOrder, finishTime, resultCode: null,
  startPresent: true, penaltyCode: null, penaltyOverride: null, tiedWithPrevious: false,
  redressMethod: null, redressExcludeRaces: null, redressIncludeRaces: null,
  redressIncludeAllLater: false, redressPoints: null,
});
// A crosses first, B second.
const finishes = [finish('a', 1, '14:30:00'), finish('b', 2, '14:35:00')];

const timelessStart: RaceStart = { id: 'rs1', raceId: 'r1', fleetIds: ['f1'] };
const timedStart: RaceStart = { id: 'rs1', raceId: 'r1', fleetIds: ['f1'], startTime: '14:00:00' };

function rankOrder(starts: RaceStart[]): string[] {
  const result = calculateFleetStandings([fleet], competitors, races, finishes, [], 'seriesEntries', starts);
  return result.fleetStandings[0].standings
    .slice()
    .sort((x, y) => x.rank - y.rank)
    .map((s) => s.competitor.id);
}

describe('membership-only (timeless) starts in scoring', () => {
  it('a timeless start scores identically to no start (scratch fallback)', () => {
    expect(rankOrder([timelessStart])).toEqual(rankOrder([]));
  });

  it('falls back to crossing order, not corrected time', () => {
    // Scratch fallback ranks by finish order: A (crossed first) ahead of B.
    expect(rankOrder([timelessStart])).toEqual(['a', 'b']);
  });

  it('a timed start does apply the handicap (B corrects out ahead)', () => {
    // With a gun time, B's lower TCC wins on corrected time — proving the
    // timeless case really is the no-gun branch, not starts being ignored.
    expect(rankOrder([timedStart])).toEqual(['b', 'a']);
  });
});
