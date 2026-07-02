import { describe, expect, test } from 'vitest';

import {
  duplicateDeletionIds,
  findDuplicateGroups,
} from '@/lib/competitor-duplicates';
import type { Competitor } from '@/lib/types';

function competitor(overrides: Partial<Competitor> & { id: string }): Competitor {
  return {
    seriesId: 's1',
    fleetIds: ['f1'],
    sailNumber: 'IRL100',
    name: 'Jane Doe',
    club: '',
    gender: '',
    age: null,
    createdAt: 1000,
    ...overrides,
  };
}

const noFinishes = new Map<string, number>();

describe('findDuplicateGroups', () => {
  test('no duplicates → no groups', () => {
    const groups = findDuplicateGroups(
      [
        competitor({ id: 'a', sailNumber: 'IRL100' }),
        competitor({ id: 'b', sailNumber: 'IRL200' }),
      ],
      noFinishes,
    );
    expect(groups).toEqual([]);
  });

  test('same sail number and fleet set group together, case- and whitespace-insensitively', () => {
    const groups = findDuplicateGroups(
      [
        competitor({ id: 'a', sailNumber: 'irl100 ' }),
        competitor({ id: 'b', sailNumber: 'IRL100' }),
      ],
      noFinishes,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].competitors.map((c) => c.id).sort()).toEqual(['a', 'b']);
  });

  test('fleet-id order does not matter, but membership does', () => {
    const sameSet = findDuplicateGroups(
      [
        competitor({ id: 'a', fleetIds: ['f1', 'f2'] }),
        competitor({ id: 'b', fleetIds: ['f2', 'f1'] }),
      ],
      noFinishes,
    );
    expect(sameSet).toHaveLength(1);

    // Same sail number in different fleets can be two genuinely different
    // boats (class-scoped numbering) — not a duplicate.
    const differentSet = findDuplicateGroups(
      [
        competitor({ id: 'a', fleetIds: ['f1'] }),
        competitor({ id: 'b', fleetIds: ['f2'] }),
      ],
      noFinishes,
    );
    expect(differentSet).toEqual([]);
  });

  test('keeper prefers the row with recorded finishes', () => {
    const groups = findDuplicateGroups(
      [
        // The finish-less copy is more complete AND older — finishes still win.
        competitor({ id: 'a', boatName: 'Windshift', club: 'HYC', createdAt: 1 }),
        competitor({ id: 'b', createdAt: 2 }),
      ],
      new Map([['b', 3]]),
    );
    expect(groups[0].keeperId).toBe('b');
  });

  test('without finishes, keeper prefers the most complete row', () => {
    const groups = findDuplicateGroups(
      [
        competitor({ id: 'a', createdAt: 1 }),
        competitor({ id: 'b', boatName: 'Windshift', club: 'HYC', createdAt: 2 }),
      ],
      noFinishes,
    );
    expect(groups[0].keeperId).toBe('b');
  });

  test('all else equal, keeper is the earliest-created row', () => {
    const groups = findDuplicateGroups(
      [
        competitor({ id: 'b', createdAt: 2 }),
        competitor({ id: 'a', createdAt: 1 }),
      ],
      noFinishes,
    );
    expect(groups[0].keeperId).toBe('a');
  });

  test('groups are ordered by sail number', () => {
    const groups = findDuplicateGroups(
      [
        competitor({ id: 'z1', sailNumber: 'Z9' }),
        competitor({ id: 'z2', sailNumber: 'Z9' }),
        competitor({ id: 'a1', sailNumber: 'A1' }),
        competitor({ id: 'a2', sailNumber: 'A1' }),
      ],
      noFinishes,
    );
    expect(groups.map((g) => g.competitors[0].sailNumber)).toEqual(['A1', 'Z9']);
  });
});

describe('duplicateDeletionIds', () => {
  test('selects every row except each group keeper', () => {
    const groups = findDuplicateGroups(
      [
        competitor({ id: 'a', createdAt: 1 }),
        competitor({ id: 'b', createdAt: 2 }),
        competitor({ id: 'c', createdAt: 3 }),
        competitor({ id: 'x', sailNumber: 'IRL200', createdAt: 1 }),
        competitor({ id: 'y', sailNumber: 'IRL200', createdAt: 2 }),
        competitor({ id: 'solo', sailNumber: 'IRL300' }),
      ],
      noFinishes,
    );
    expect(duplicateDeletionIds(groups).sort()).toEqual(['b', 'c', 'y']);
  });
});
