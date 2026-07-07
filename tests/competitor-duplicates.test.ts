import { describe, expect, test } from 'vitest';

import {
  duplicateDeletionIds,
  findDuplicateGroups,
  findPossibleDuplicateGroups,
  planDuplicateMerge,
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

describe('findPossibleDuplicateGroups', () => {
  test('groups different sail numbers with a matching boat name in the same fleet', () => {
    const groups = findPossibleDuplicateGroups(
      [
        competitor({ id: 'a', sailNumber: 'IRL100', boatName: 'White Mischief', name: 'J. Bloggs' }),
        competitor({ id: 'b', sailNumber: 'IRL150', boatName: 'white mischief', name: 'J. B.' }),
        competitor({ id: 'c', sailNumber: 'IRL200', boatName: 'Sea Biscuit', name: 'A. Nother' }),
      ],
      noFinishes,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].competitors.map((x) => x.id).sort()).toEqual(['a', 'b']);
    expect(groups[0].matchedOn).toEqual(['boat name']);
  });

  test('matches on person name across the primary and helm fields', () => {
    const groups = findPossibleDuplicateGroups(
      [
        competitor({ id: 'a', sailNumber: 'IRL100', name: 'J. Bloggs' }),
        competitor({ id: 'b', sailNumber: 'IRL150', name: 'A. Owner', helm: 'j. bloggs' }),
      ],
      noFinishes,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].matchedOn).toEqual(['name']);
  });

  test('same sail number is the exact tier, not a possible duplicate', () => {
    const groups = findPossibleDuplicateGroups(
      [
        competitor({ id: 'a', sailNumber: 'IRL100', boatName: 'White Mischief' }),
        competitor({ id: 'b', sailNumber: 'IRL100', boatName: 'White Mischief' }),
      ],
      noFinishes,
    );
    expect(groups).toEqual([]);
  });

  test('different fleet sets never group', () => {
    const groups = findPossibleDuplicateGroups(
      [
        competitor({ id: 'a', sailNumber: 'IRL100', boatName: 'White Mischief', fleetIds: ['f1'] }),
        competitor({ id: 'b', sailNumber: 'IRL150', boatName: 'White Mischief', fleetIds: ['f2'] }),
      ],
      noFinishes,
    );
    expect(groups).toEqual([]);
  });

  test('empty identity fields never match', () => {
    const groups = findPossibleDuplicateGroups(
      [
        competitor({ id: 'a', sailNumber: 'IRL100', name: '' }),
        competitor({ id: 'b', sailNumber: 'IRL150', name: '' }),
      ],
      noFinishes,
    );
    expect(groups).toEqual([]);
  });

  test('three copies fold into one group; keeper is the row with finishes', () => {
    const counts = new Map([['a', 3]]);
    const groups = findPossibleDuplicateGroups(
      [
        competitor({ id: 'a', sailNumber: 'IRL100', boatName: 'White Mischief', createdAt: 1 }),
        competitor({ id: 'b', sailNumber: 'IRL150', boatName: 'White Mischief', createdAt: 2 }),
        competitor({ id: 'c', sailNumber: 'IRL175', boatName: 'White Mischief', createdAt: 3 }),
      ],
      counts,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].competitors).toHaveLength(3);
    expect(groups[0].keeperId).toBe('a');
  });
});

describe('planDuplicateMerge', () => {
  function group(...competitors: Competitor[]) {
    const groups = findPossibleDuplicateGroups(competitors, noFinishes);
    expect(groups).toHaveLength(1);
    return groups[0];
  }

  test('keeper keeps its id; the newest row wins the fields', () => {
    const keeper = competitor({
      id: 'old', sailNumber: 'IRL100', boatName: 'White Mischief',
      club: 'HYC', createdAt: 1, ircTcc: 0.95, version: 4,
    });
    const newer = competitor({
      id: 'new', sailNumber: 'IRL150', boatName: 'White Mischief',
      club: '', createdAt: 2, ircTcc: 0.97,
    });
    const plan = planDuplicateMerge(group(keeper, newer), []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.survivor.id).toBe('old');
    expect(plan.survivor.version).toBe(4);
    expect(plan.survivor.createdAt).toBe(1);
    expect(plan.survivor.sailNumber).toBe('IRL150'); // newest wins
    expect(plan.survivor.ircTcc).toBe(0.97);         // newest wins
    expect(plan.survivor.club).toBe('HYC');          // empty never blanks
    expect(plan.deleteIds).toEqual(['new']);
  });

  test('a newer keeper (the one with finishes) still wins the fields', () => {
    // The renumbered copy collected the finishes: it is the keeper AND the
    // newest data, so the survivor is essentially that row.
    const original = competitor({
      id: 'orig', sailNumber: 'IRL100', boatName: 'White Mischief', createdAt: 1,
    });
    const renumbered = competitor({
      id: 'renum', sailNumber: 'IRL150', boatName: 'White Mischief', createdAt: 2,
    });
    const groups = findPossibleDuplicateGroups(
      [original, renumbered],
      new Map([['renum', 5]]),
    );
    const plan = planDuplicateMerge(groups[0], [
      { id: 'fin1', raceId: 'r1', competitorId: 'renum' },
    ]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.survivor.id).toBe('renum');
    expect(plan.survivor.sailNumber).toBe('IRL150');
    expect(plan.deleteIds).toEqual(['orig']);
    expect(plan.reassignFinishIds).toEqual([]); // already the keeper's
  });

  test("reassigns the other rows' finishes to the keeper", () => {
    const keeper = competitor({ id: 'a', sailNumber: 'IRL100', boatName: 'WM', createdAt: 1 });
    const dupe = competitor({ id: 'b', sailNumber: 'IRL150', boatName: 'WM', createdAt: 2 });
    const groups = findPossibleDuplicateGroups([keeper, dupe], new Map([['a', 2]]));
    const plan = planDuplicateMerge(groups[0], [
      { id: 'fin1', raceId: 'r1', competitorId: 'a' },
      { id: 'fin2', raceId: 'r2', competitorId: 'a' },
      { id: 'fin3', raceId: 'r3', competitorId: 'b' },
      { id: 'other', raceId: 'r3', competitorId: 'unrelated' },
    ]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.reassignFinishIds).toEqual(['fin3']);
  });

  test('refuses when two members hold a finish in the same race', () => {
    const keeper = competitor({ id: 'a', sailNumber: 'IRL100', boatName: 'WM', createdAt: 1 });
    const dupe = competitor({ id: 'b', sailNumber: 'IRL150', boatName: 'WM', createdAt: 2 });
    const plan = planDuplicateMerge(group(keeper, dupe), [
      { id: 'fin1', raceId: 'r1', competitorId: 'a' },
      { id: 'fin2', raceId: 'r1', competitorId: 'b' },
    ]);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.conflictRaceIds).toEqual(['r1']);
  });

  test('unresolved finishes (null competitorId) are ignored', () => {
    const keeper = competitor({ id: 'a', sailNumber: 'IRL100', boatName: 'WM' });
    const dupe = competitor({ id: 'b', sailNumber: 'IRL150', boatName: 'WM', createdAt: 2 });
    const plan = planDuplicateMerge(group(keeper, dupe), [
      { id: 'fin1', raceId: 'r1', competitorId: null },
    ]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.reassignFinishIds).toEqual([]);
  });

  test('reassigns rating overrides, skipping slots the keeper already fills', () => {
    const keeper = competitor({ id: 'a', sailNumber: 'IRL100', boatName: 'WM', createdAt: 1 });
    const dupe = competitor({ id: 'b', sailNumber: 'IRL150', boatName: 'WM', createdAt: 2 });
    const groups = findPossibleDuplicateGroups([keeper, dupe], new Map([['a', 1]]));
    const plan = planDuplicateMerge(
      groups[0],
      [{ id: 'fin1', raceId: 'r1', competitorId: 'a' }],
      [
        { id: 'ov1', raceId: 'r1', competitorId: 'a', field: 'ircTcc' },
        { id: 'ov2', raceId: 'r1', competitorId: 'b', field: 'ircTcc' }, // collides — dropped
        { id: 'ov3', raceId: 'r2', competitorId: 'b', field: 'ircTcc' }, // free slot
      ],
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.reassignOverrideIds).toEqual(['ov3']);
  });

  test('merges subdivisions with the newest value winning per axis', () => {
    const keeper = competitor({
      id: 'a', sailNumber: 'IRL100', boatName: 'WM', createdAt: 1,
      subdivisions: { axis1: 'Gold', axis2: 'Master' },
    });
    const dupe = competitor({
      id: 'b', sailNumber: 'IRL150', boatName: 'WM', createdAt: 2,
      subdivisions: { axis1: 'Silver' },
    });
    const plan = planDuplicateMerge(group(keeper, dupe), []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.survivor.subdivisions).toEqual({ axis1: 'Silver', axis2: 'Master' });
  });
});
