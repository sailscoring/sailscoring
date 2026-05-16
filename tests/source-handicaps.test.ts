import { describe, it, expect } from 'vitest';

import {
  endOfSeriesTcfKey,
  endOfSeriesTcfs,
} from '@/lib/source-handicaps';
import type { Competitor, Fleet, Race, TcfRecord } from '@/lib/types';

function comp(id: string, fleetIds: string[]): Competitor {
  return {
    id,
    seriesId: 's-source',
    fleetIds,
    sailNumber: id,
    name: id,
    club: '',
    gender: '',
    age: null,
    createdAt: 0,
  };
}

function fleet(id: string, system: Fleet['scoringSystem']): Fleet {
  return {
    id,
    seriesId: 's-source',
    name: id,
    displayOrder: 0,
    scoringSystem: system,
  };
}

function race(id: string, raceNumber: number, date: string): Race {
  return { id, seriesId: 's-source', raceNumber, date, createdAt: 0 };
}

function tcf(raceId: string, competitorId: string, fleetId: string, newTcf: number): TcfRecord {
  return {
    id: `${raceId}-${competitorId}-${fleetId}`,
    raceId,
    competitorId,
    fleetId,
    tcfApplied: newTcf, // value irrelevant for these tests; resolver only reads newTcf
    newTcf,
  };
}

describe('endOfSeriesTcfs', () => {
  it('returns empty when no progressive fleets exist', () => {
    const fleets = [fleet('f-scratch', 'scratch'), fleet('f-irc', 'irc')];
    const result = endOfSeriesTcfs([comp('A', ['f-scratch'])], fleets, [], []);
    expect(result.size).toBe(0);
  });

  it('returns the newTcf of the latest race per (competitor, fleet)', () => {
    const fleets = [fleet('f-nhc', 'nhc')];
    const races = [
      race('r1', 1, '2026-05-01'),
      race('r2', 2, '2026-05-08'),
      race('r3', 3, '2026-05-15'),
    ];
    const history = [
      tcf('r1', 'A', 'f-nhc', 1.005),
      tcf('r2', 'A', 'f-nhc', 1.010),
      tcf('r3', 'A', 'f-nhc', 1.020),
      tcf('r1', 'B', 'f-nhc', 0.995),
      tcf('r2', 'B', 'f-nhc', 0.985),
    ];
    const result = endOfSeriesTcfs([comp('A', ['f-nhc']), comp('B', ['f-nhc'])], fleets, races, history);
    expect(result.get(endOfSeriesTcfKey('A', 'f-nhc'))).toMatchObject({
      endTcf: 1.020,
      lastRaceId: 'r3',
      lastRaceNumber: 3,
      system: 'nhc',
    });
    // Boat B's latest record is r2 — r3 has no row for B (e.g. DNC and
    // outside the rating-update fleet).
    expect(result.get(endOfSeriesTcfKey('B', 'f-nhc'))).toMatchObject({
      endTcf: 0.985,
      lastRaceId: 'r2',
      lastRaceNumber: 2,
    });
  });

  it('orders races by date first, raceNumber second', () => {
    // raceNumber order would pick r1 (1.111) as latest; date order picks r2 (1.222).
    const fleets = [fleet('f-nhc', 'nhc')];
    const races = [
      race('r1', 1, '2026-06-01'),
      race('r2', 2, '2026-05-01'), // out-of-order date
      race('r3', 3, '2026-06-01'), // same date as r1; higher raceNumber wins
    ];
    const history = [
      tcf('r1', 'A', 'f-nhc', 1.111),
      tcf('r2', 'A', 'f-nhc', 1.222),
      tcf('r3', 'A', 'f-nhc', 1.333),
    ];
    const result = endOfSeriesTcfs([comp('A', ['f-nhc'])], fleets, races, history);
    expect(result.get(endOfSeriesTcfKey('A', 'f-nhc'))?.endTcf).toBe(1.333);
  });

  it('keeps NHC and ECHO records for the same boat separate (multi-fleet)', () => {
    const fleets = [fleet('f-nhc', 'nhc'), fleet('f-echo', 'echo')];
    const races = [race('r1', 1, '2026-05-01')];
    const history = [
      tcf('r1', 'A', 'f-nhc', 1.234),
      tcf('r1', 'A', 'f-echo', 0.987),
    ];
    const result = endOfSeriesTcfs(
      [comp('A', ['f-nhc', 'f-echo'])],
      fleets,
      races,
      history,
    );
    expect(result.size).toBe(2);
    expect(result.get(endOfSeriesTcfKey('A', 'f-nhc'))?.system).toBe('nhc');
    expect(result.get(endOfSeriesTcfKey('A', 'f-nhc'))?.endTcf).toBe(1.234);
    expect(result.get(endOfSeriesTcfKey('A', 'f-echo'))?.system).toBe('echo');
    expect(result.get(endOfSeriesTcfKey('A', 'f-echo'))?.endTcf).toBe(0.987);
  });

  it('ignores history rows whose fleet is static-TCF', () => {
    // A stale record pointing at an IRC fleet — should never have existed,
    // but if it does we drop it on the floor rather than fabricating an
    // EndOfSeriesTcf entry.
    const fleets = [fleet('f-irc', 'irc'), fleet('f-nhc', 'nhc')];
    const races = [race('r1', 1, '2026-05-01')];
    const history = [
      tcf('r1', 'A', 'f-irc', 0.999),
      tcf('r1', 'A', 'f-nhc', 1.050),
    ];
    const result = endOfSeriesTcfs(
      [comp('A', ['f-irc', 'f-nhc'])],
      fleets,
      races,
      history,
    );
    expect(result.size).toBe(1);
    expect(result.get(endOfSeriesTcfKey('A', 'f-nhc'))?.endTcf).toBe(1.050);
  });

  it('drops history records whose race is unknown', () => {
    const fleets = [fleet('f-nhc', 'nhc')];
    const races = [race('r1', 1, '2026-05-01')];
    const history = [
      tcf('r1', 'A', 'f-nhc', 1.000),
      tcf('r-ghost', 'A', 'f-nhc', 9.999), // race not in input
    ];
    const result = endOfSeriesTcfs([comp('A', ['f-nhc'])], fleets, races, history);
    expect(result.get(endOfSeriesTcfKey('A', 'f-nhc'))?.endTcf).toBe(1.000);
  });

  it('drops history records for competitors no longer in the series', () => {
    const fleets = [fleet('f-nhc', 'nhc')];
    const races = [race('r1', 1, '2026-05-01')];
    const history = [
      tcf('r1', 'A', 'f-nhc', 1.000),
      tcf('r1', 'B-deleted', 'f-nhc', 1.234),
    ];
    const result = endOfSeriesTcfs([comp('A', ['f-nhc'])], fleets, races, history);
    expect(result.size).toBe(1);
    expect(result.has(endOfSeriesTcfKey('B-deleted', 'f-nhc'))).toBe(false);
  });
});
