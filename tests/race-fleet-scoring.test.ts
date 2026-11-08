/**
 * Scoring a boat that is out of a fleet for some races (`Race.fleetChanges`):
 * it is not in that fleet's race — no place, not one of high point's n, not a
 * starter — but stays one of the fleet's entries and scores the race as not
 * sailed in it.
 */
import { describe, expect, it } from 'vitest';

import { calculateFleetStandings, calculateSubSeriesFleetStandings } from '@/lib/scoring';
import { buildCodeTable } from '@/lib/scoring-codes';
import { highPointOf } from '@/lib/high-point';
import type { Competitor, Finish, Fleet, Race, RaceStart, Standing, SubSeries } from '@/lib/types';

const overall: Fleet = { id: 'ov', seriesId: 's1', name: 'Overall', displayOrder: 0, scoringSystem: 'scratch' };
const twoHanded: Fleet = { id: '2h', seriesId: 's1', name: 'Two-Handed', displayOrder: 1, scoringSystem: 'scratch' };

function boat(id: string, fleetIds: string[], extra: Partial<Competitor> = {}): Competitor {
  return { id, seriesId: 's1', fleetIds, sailNumber: id, names: [id], clubs: [], gender: '', age: null, createdAt: 0, ...extra };
}

function race(n: number, fleetChanges?: Race['fleetChanges']): Race {
  return { id: `r${n}`, seriesId: 's1', raceNumber: n, name: null, date: '2026-05-01', createdAt: 0, ...(fleetChanges ? { fleetChanges } : {}) };
}

function finish(raceId: string, competitorId: string, sortOrder: number | null, extra: Partial<Finish> = {}): Finish {
  return { id: `${raceId}-${competitorId}`, raceId, competitorId, sortOrder, tiedWithPrevious: false, resultCode: null, startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null, redressExcludeRaceIds: null, redressIncludeRaceIds: null, redressIncludeAllLater: false, redressPoints: null, ...extra };
}

function standingsOf(result: ReturnType<typeof calculateFleetStandings>, fleetId: string): (id: string) => Standing {
  const entry = result.fleetStandings.find((f) => f.fleet.id === fleetId)!;
  return (id) => entry.standings.find((s) => s.competitor.id === id)!;
}

const crewed = (competitorId: string) => [{ competitorId, drop: ['2h'] }];

describe('a boat out of a fleet for a race', () => {
  const boats = [boat('A', ['ov', '2h']), boat('B', ['ov', '2h']), boat('C', ['ov', '2h'])];

  it("is not one of high point's n in that fleet's race", () => {
    // Boats beaten: n + 1 − place. A sails race 1 crewed and wins it; race 2
    // is yet to be sailed, two-handed.
    const codes = buildCodeTable('seriesEntries', [], highPointOf({ pointsSystem: 'highPoint', highPointFormula: 'boatsBeaten' }));
    const races = [race(1, crewed('A')), race(2)];
    const finishes = [finish('r1', 'A', 1), finish('r1', 'B', 2), finish('r1', 'C', 3)];
    const result = calculateFleetStandings([overall, twoHanded], boats, races, finishes, [], codes);
    const ov = standingsOf(result, 'ov');
    const th = standingsOf(result, '2h');
    // Overall: n = 3, so 3, 2, 1. Two-Handed: n = 2, B 1st and C 2nd.
    expect([ov('A'), ov('B'), ov('C')].map((s) => s.racePoints[0])).toEqual([3, 2, 1]);
    expect([th('B'), th('C')].map((s) => s.racePoints[0])).toEqual([2, 1]);
    expect(th('A').racePoints[0]).toBe(0);
    expect(th('A').raceCodes[0]).toBeNull();
    expect(th('A').raceNotInFleet).toEqual([true, false]);
    expect(th('B').raceNotInFleet).toBeUndefined();
  });

  it('takes no place in a handicap fleet, and the boats behind it move up', () => {
    const irc: Fleet = { ...twoHanded, scoringSystem: 'irc' };
    const rated = boats.map((b) => ({ ...b, ircTcc: 1 }));
    const starts: RaceStart[] = [{ id: 's1', raceId: 'r1', fleetIds: ['ov', '2h'], startTime: '10:00:00' }];
    const finishes = [
      finish('r1', 'A', null, { finishTime: '11:00:00' }),
      finish('r1', 'B', null, { finishTime: '11:05:00' }),
      finish('r1', 'C', null, { finishTime: '11:10:00' }),
    ];
    const result = calculateFleetStandings([irc], rated, [race(1, crewed('A')), race(2)], finishes, [], 'seriesEntries', starts);
    const th = standingsOf(result, '2h');
    expect([th('B'), th('C')].map((s) => s.racePoints[0])).toEqual([1, 2]);
    // Entries + 1: A is still one of the fleet's three entries.
    expect(th('A').racePoints[0]).toBe(4);
    expect(th('A').raceNotInFleet).toEqual([true, false]);
  });

  it('can be discarded, and stays out of the boat\'s redress average', () => {
    const races = [race(1), race(2, crewed('A')), race(3)];
    const finishes = [
      finish('r1', 'A', 1), finish('r1', 'B', 2), finish('r1', 'C', 3),
      finish('r2', 'A', 1), finish('r2', 'B', 2), finish('r2', 'C', 3),
      finish('r3', 'B', 1), finish('r3', 'C', 2),
      finish('r3', 'A', null, { resultCode: 'RDG', redressMethod: 'all_races' }),
    ];
    const result = calculateFleetStandings([twoHanded], boats, races, finishes, [{ minRaces: 3, discardCount: 1 }]);
    const a = standingsOf(result, '2h')('A');
    // Race 2 is not sailed in the fleet: entries + 1 = 4, and the discard.
    expect(a.racePoints[1]).toBe(4);
    expect(a.raceDiscards).toEqual([false, true, false]);
    // The redress in race 3 averages race 1 only, not the race-2 dash.
    expect(a.racePoints[2]).toBe(1);
    expect(a.raceRedressFlags[2]).toBe(true);
  });

  it("is left off a fleet's standings when it is out of the fleet for every race", () => {
    const races = [race(1, crewed('A')), race(2, crewed('A'))];
    const finishes = [finish('r1', 'A', 1), finish('r1', 'B', 2), finish('r2', 'A', 1), finish('r2', 'B', 2)];
    const result = calculateFleetStandings([overall, twoHanded], boats, races, finishes, []);
    const th = result.fleetStandings.find((f) => f.fleet.id === '2h')!;
    expect(th.standings.map((s) => s.competitor.id).sort()).toEqual(['B', 'C']);
    // B and C both sailed in Two-Handed; C is DNC, and two entries make 3.
    expect(th.standings.find((s) => s.competitor.id === 'C')!.racePoints).toEqual([3, 3]);
  });
});

describe('a boat added to a fleet for a race', () => {
  it('is in a sub-series scoped to that fleet when the race is one of its races', () => {
    const boats = [boat('A', ['ov', '2h']), boat('D', ['ov'])];
    const races = [race(1), race(2, [{ competitorId: 'D', add: ['2h'] }])];
    const finishes = [finish('r1', 'A', 1), finish('r1', 'D', 2), finish('r2', 'D', 1), finish('r2', 'A', 2)];
    const scoped = (raceIds: string[]): SubSeries => ({ id: 'ss', seriesId: 's1', name: 'Two-Handed Trophy', displayOrder: 0, raceIds, fleetIds: ['2h'] });

    const [withRace2] = calculateSubSeriesFleetStandings([scoped(['r1', 'r2'])], [overall, twoHanded], boats, races, finishes);
    const d = withRace2.fleetStandings[0].standings.find((s) => s.competitor.id === 'D')!;
    expect(d.racePoints).toEqual([3, 1]);
    expect(d.raceNotInFleet).toEqual([true, false]);

    const [race1Only] = calculateSubSeriesFleetStandings([scoped(['r1'])], [overall, twoHanded], boats, races, finishes);
    expect(race1Only.fleetStandings[0].standings.map((s) => s.competitor.id)).toEqual(['A']);
  });
});
