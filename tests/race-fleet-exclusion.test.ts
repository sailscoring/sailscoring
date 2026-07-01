import { describe, it, expect } from 'vitest';
import { calculateFleetStandings, buildRaceFleetExclusionMap } from '@/lib/scoring';
import type { Competitor, Finish, Fleet, Race } from '@/lib/types';

function makeCompetitor(id: string, fleetIds: string[]): Competitor {
  return { id, seriesId: 's1', fleetIds, sailNumber: id, name: id, club: '', gender: '', age: null, createdAt: 0 };
}

function makeRace(id: string, raceNumber: number): Race {
  return { id, seriesId: 's1', raceNumber, name: null, date: '2025-01-01', createdAt: 0 };
}

function makeFinish(raceId: string, competitorId: string, sortOrder: number): Finish {
  return {
    id: `${raceId}-${competitorId}`, raceId, competitorId, sortOrder, resultCode: null,
    startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null,
    redressExcludeRaceIds: null, redressIncludeRaceIds: null, tiedWithPrevious: false,
    redressIncludeAllLater: false, redressPoints: null,
  };
}

const f1: Fleet = { id: 'f1', seriesId: 's1', name: 'Fleet One', displayOrder: 0, scoringSystem: 'scratch' };
const f2: Fleet = { id: 'f2', seriesId: 's1', name: 'Fleet Two', displayOrder: 1, scoringSystem: 'scratch' };

describe('buildRaceFleetExclusionMap', () => {
  it('returns undefined for an empty or absent list', () => {
    expect(buildRaceFleetExclusionMap(undefined)).toBeUndefined();
    expect(buildRaceFleetExclusionMap([])).toBeUndefined();
  });

  it('groups exclusions by fleet into sets of raceIds', () => {
    const map = buildRaceFleetExclusionMap([
      { raceId: 'r1', fleetId: 'f1' },
      { raceId: 'r3', fleetId: 'f1' },
      { raceId: 'r2', fleetId: 'f2' },
    ])!;
    expect([...map.get('f1')!].sort()).toEqual(['r1', 'r3']);
    expect([...map.get('f2')!]).toEqual(['r2']);
  });
});

// A whole-series race struck for one fleet behaves exactly like a sub-series
// exclusion: it scores 0 for that fleet, earns no discard credit, and never
// shifts the standings — while counting normally for every other fleet.
describe('calculateFleetStandings with whole-series raceFleetExclusions', () => {
  const competitors = [
    makeCompetitor('A', ['f1']),
    makeCompetitor('B', ['f1']),
    makeCompetitor('C', ['f2']),
    makeCompetitor('D', ['f2']),
  ];
  const races = [makeRace('r1', 1), makeRace('r2', 2), makeRace('r3', 3)];
  const finishes = ['r1', 'r2', 'r3'].flatMap((r) => [
    makeFinish(r, 'A', 1), makeFinish(r, 'B', 2), makeFinish(r, 'C', 3), makeFinish(r, 'D', 4),
  ]);

  const excluded = buildRaceFleetExclusionMap([{ raceId: 'r2', fleetId: 'f1' }]);
  const { fleetStandings } = calculateFleetStandings(
    [f1, f2], competitors, races, finishes, [], 'seriesEntries', [], [], undefined, excluded,
  );
  const fleet1 = fleetStandings.find((fs) => fs.fleet.id === 'f1')!;
  const fleet2 = fleetStandings.find((fs) => fs.fleet.id === 'f2')!;

  it('strikes the excluded race for the affected fleet (0 column, marked excluded)', () => {
    for (const s of fleet1.standings) {
      expect(s.raceExcluded).toEqual([false, true, false]);
      expect(s.racePoints[1]).toBe(0);
    }
  });

  it('leaves the race intact for every other fleet', () => {
    for (const s of fleet2.standings) expect(s.raceExcluded).toEqual([false, false, false]);
    const c = fleet2.standings.find((s) => s.competitor.id === 'C')!;
    expect(c.racePoints).toEqual([1, 1, 1]);
  });

  it('does not count the struck race toward the affected fleet total', () => {
    // A wins r1 and r3 (1 pt each) with r2 struck → total 2 over two counted races.
    const a = fleet1.standings.find((s) => s.competitor.id === 'A')!;
    expect(a.totalPoints).toBe(2);
  });
});
