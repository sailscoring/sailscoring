import { describe, expect, test } from 'vitest';

import { findFleetOverlap } from '@/lib/race-start-fleets';

const start = (id: string, fleetIds: string[], startTime?: string) => ({ id, fleetIds, startTime });

describe('findFleetOverlap', () => {
  test('no overlap when each fleet starts once', () => {
    expect(findFleetOverlap([start('a', ['f1'])], [start('b', ['f2'])])).toBeNull();
  });

  test('an incoming start claiming a stored start\'s fleet', () => {
    const overlap = findFleetOverlap([start('a', ['f1'], '11:00:00')], [start('b', ['f2', 'f1'])]);
    expect(overlap).toEqual({
      fleetId: 'f1',
      first: start('a', ['f1'], '11:00:00'),
      second: start('b', ['f2', 'f1']),
    });
  });

  test('two incoming starts claiming the same fleet', () => {
    expect(findFleetOverlap([], [start('a', ['f1']), start('b', ['f1'])])?.fleetId).toBe('f1');
  });

  test('an incoming start replaces the stored start with its id', () => {
    expect(findFleetOverlap([start('a', ['f1'])], [start('a', ['f1', 'f2'])])).toBeNull();
    expect(
      findFleetOverlap([start('a', ['f1']), start('b', [])], [start('a', []), start('b', ['f1'])]),
    ).toBeNull();
  });

  test('a fleet listed twice in one start is not an overlap', () => {
    expect(findFleetOverlap([], [start('a', ['f1', 'f1'])])).toBeNull();
  });
});
