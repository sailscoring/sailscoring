import { describe, it, expect } from 'vitest';
import {
  calculateFleetStandings,
  calculateSubSeriesFleetStandings,
  resolveEntrants,
  resolveEntryStatuses,
} from '@/lib/scoring';
import type { Competitor, Finish, Fleet, Race, SubSeries } from '@/lib/types';

/**
 * Entry resolution: which boats on the competitor list are entrants in a
 * scoring scope. A non-entrant is off the ranking and out of the RRS A5.2
 * entry count, and its finishes score nothing.
 */

const fleet: Fleet = { id: 'f1', seriesId: 's1', name: 'Fleet', displayOrder: 0, scoringSystem: 'scratch' };

function competitor(id: string, extra: Partial<Competitor> = {}): Competitor {
  return { id, seriesId: 's1', fleetIds: ['f1'], sailNumber: id, names: [id], club: '', gender: '', age: null, createdAt: 0, ...extra };
}
function race(id: string, raceNumber: number): Race {
  return { id, seriesId: 's1', raceNumber, name: null, date: '2026-01-01', createdAt: 0 };
}
function finish(raceId: string, competitorId: string, sortOrder: number | null, resultCode: Finish['resultCode'] = null): Finish {
  return { id: `${raceId}-${competitorId}`, raceId, competitorId, sortOrder, resultCode, startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null, redressExcludeRaceIds: null, redressIncludeRaceIds: null, tiedWithPrevious: false, redressIncludeAllLater: false, redressPoints: null };
}

const races = [race('r1', 1), race('r2', 2)];
// D never sails; E is excluded but crosses the line 2nd in race 2.
const competitors = [competitor('A'), competitor('B'), competitor('C'), competitor('D'), competitor('E', { excluded: true })];
const finishes = [
  finish('r1', 'A', 1), finish('r1', 'B', 2), finish('r1', 'C', 3),
  finish('r2', 'B', 1), finish('r2', 'E', 2), finish('r2', 'A', 3), finish('r2', 'C', 4),
];

describe('resolveEntryStatuses', () => {
  it('enters every boat by default and drops one the scorer excluded', () => {
    const statuses = resolveEntryStatuses(competitors, races, finishes);
    expect(statuses.get('A')).toEqual({ entered: true, via: 'default' });
    expect(statuses.get('D')).toEqual({ entered: true, via: 'default' });
    expect(statuses.get('E')).toEqual({ entered: false, via: 'competitor' });
  });

  it('drops an all-DNC boat only when the automatic rule is on', () => {
    const off = resolveEntryStatuses(competitors, races, finishes);
    expect(off.get('D')?.entered).toBe(true);
    const on = resolveEntryStatuses(competitors, races, finishes, { excludeDncOnlyCompetitors: true });
    expect(on.get('D')).toEqual({ entered: false, via: 'dncOnly' });
    // A boat with any result other than DNC took part.
    const withDns = [...finishes, finish('r1', 'D', null, 'DNS')];
    expect(resolveEntryStatuses(competitors, races, withDns, { excludeDncOnlyCompetitors: true }).get('D')?.entered).toBe(true);
    // An explicit DNC is still not taking part.
    const withDnc = [...finishes, finish('r1', 'D', null, 'DNC')];
    expect(resolveEntryStatuses(competitors, races, withDnc, { excludeDncOnlyCompetitors: true }).get('D')?.entered).toBe(false);
  });

  it('lets a per-scope override beat both the flag and the automatic rule', () => {
    const statuses = resolveEntryStatuses(competitors, races, finishes, {
      excludeDncOnlyCompetitors: true,
      competitorOverrides: [
        { competitorId: 'D', status: 'included' },
        { competitorId: 'E', status: 'included' },
        { competitorId: 'A', status: 'excluded' },
      ],
    });
    expect(statuses.get('D')).toEqual({ entered: true, via: 'override' });
    expect(statuses.get('E')).toEqual({ entered: true, via: 'override' });
    expect(statuses.get('A')).toEqual({ entered: false, via: 'override' });
  });

  it('resolveEntrants keeps the original order', () => {
    expect(resolveEntrants(competitors, races, finishes).map((c) => c.id)).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('calculateFleetStandings with excluded competitors', () => {
  const { fleetStandings } = calculateFleetStandings([fleet], competitors, races, finishes);
  const standings = fleetStandings[0].standings;
  const byId = (id: string) => standings.find((s) => s.competitor.id === id)!;

  it('leaves the excluded boat off the table', () => {
    expect(standings.map((s) => s.competitor.id).sort()).toEqual(['A', 'B', 'C', 'D']);
  });

  it('bases DNC on the entrants, not the list', () => {
    // Four entered boats: DNC = 4 + 1, not 5 + 1.
    expect(byId('D').racePoints[0]).toBe(5);
    expect(byId('D').raceCodes[0]).toBe('DNC');
  });

  it('scores nothing for the excluded boat, so the boats behind it move up', () => {
    expect(byId('A').racePoints[1]).toBe(2);
    expect(byId('C').racePoints[1]).toBe(3);
  });

  it('honours the automatic rule when asked', () => {
    const auto = calculateFleetStandings(
      [fleet], competitors, races, finishes, [], 'seriesEntries', [], [], undefined, undefined, undefined,
      { excludeDncOnlyCompetitors: true },
    ).fleetStandings[0].standings;
    expect(auto.map((s) => s.competitor.id).sort()).toEqual(['A', 'B', 'C']);
  });
});

describe('calculateSubSeriesFleetStandings with excluded competitors', () => {
  const block: SubSeries = { id: 'ss', seriesId: 's1', name: 'Block', displayOrder: 0, raceIds: ['r1', 'r2'] };

  it('a series-excluded boat is out of every block', () => {
    const [result] = calculateSubSeriesFleetStandings([block], [fleet], competitors, races, finishes);
    const ids = result.fleetStandings[0].standings.map((s) => s.competitor.id).sort();
    expect(ids).toEqual(['A', 'B', 'C', 'D']);
  });

  it('a block override includes an all-DNC boat, or excludes an entered one, for that block alone', () => {
    const [result] = calculateSubSeriesFleetStandings(
      [{
        ...block,
        excludeDncOnlyCompetitors: true,
        competitorOverrides: [
          { competitorId: 'D', status: 'included' },
          { competitorId: 'E', status: 'included' },
          { competitorId: 'A', status: 'excluded' },
        ],
      }],
      [fleet], competitors, races, finishes,
    );
    const standings = result.fleetStandings[0].standings;
    expect(standings.map((s) => s.competitor.id).sort()).toEqual(['B', 'C', 'D', 'E']);
    // Four entrants in the block: D's DNC is 5, and E's race-2 finish scores —
    // 2nd behind B, with A's crossing no longer in the order.
    const byId = (id: string) => standings.find((s) => s.competitor.id === id)!;
    expect(byId('D').racePoints).toEqual([5, 5]);
    expect(byId('B').racePoints[1]).toBe(1);
    expect(byId('E').racePoints[1]).toBe(2);
  });

  it('the block flag still drops all-DNC boats, and the count follows', () => {
    const [result] = calculateSubSeriesFleetStandings(
      [{ ...block, excludeDncOnlyCompetitors: true }], [fleet], competitors, races, finishes,
    );
    const standings = result.fleetStandings[0].standings;
    expect(standings.map((s) => s.competitor.id).sort()).toEqual(['A', 'B', 'C']);
  });
});
