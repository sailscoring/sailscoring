import { describe, it, expect } from 'vitest';

import { adjacentRaces } from '@/lib/race-navigation';
import type { Race } from '@/lib/types';

function race(id: string, raceNumber: number): Race {
  return {
    id,
    seriesId: 's1',
    raceNumber,
    name: null,
    date: '2026-04-18',
    createdAt: 0,
  };
}

describe('adjacentRaces', () => {
  const races = [race('a', 1), race('b', 2), race('c', 3)];

  it('returns both neighbours for a middle race', () => {
    const { prev, next } = adjacentRaces(races, 'b');
    expect(prev?.id).toBe('a');
    expect(next?.id).toBe('c');
  });

  it('has no previous for the first race', () => {
    const { prev, next } = adjacentRaces(races, 'a');
    expect(prev).toBeUndefined();
    expect(next?.id).toBe('b');
  });

  it('has no next for the last race', () => {
    const { prev, next } = adjacentRaces(races, 'c');
    expect(prev?.id).toBe('b');
    expect(next).toBeUndefined();
  });

  it('returns neither neighbour for a single-race list', () => {
    expect(adjacentRaces([race('a', 1)], 'a')).toEqual({ prev: undefined, next: undefined });
  });

  it('returns neither neighbour when the id is not in the list', () => {
    expect(adjacentRaces(races, 'z')).toEqual({ prev: undefined, next: undefined });
  });
});
