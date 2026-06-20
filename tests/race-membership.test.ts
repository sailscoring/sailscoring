import { describe, it, expect } from 'vitest';

import { competitorsInRace, raceFleetIds } from '@/lib/race-membership';
import type { Competitor, RaceStart } from '@/lib/types';

const competitor = (id: string, fleetIds: string[]): Competitor =>
  ({ id, fleetIds } as Competitor);

const start = (fleetIds: string[], startTime?: string): RaceStart =>
  ({ id: `s-${fleetIds.join('-')}`, raceId: 'r1', fleetIds, startTime } as RaceStart);

const A = competitor('a', ['fleet-1']);
const B = competitor('b', ['fleet-2']);
const C = competitor('c', ['fleet-1', 'fleet-2']);
const all = [A, B, C];

describe('raceFleetIds', () => {
  it('is empty when there are no starts', () => {
    expect(raceFleetIds([]).size).toBe(0);
  });

  it('unions fleet ids across timed and timeless starts', () => {
    const ids = raceFleetIds([start(['fleet-1'], '14:00:00'), start(['fleet-2'])]);
    expect([...ids].sort()).toEqual(['fleet-1', 'fleet-2']);
  });
});

describe('competitorsInRace', () => {
  it('returns all competitors when no starts are recorded (all fleets implied)', () => {
    expect(competitorsInRace(all, [])).toEqual(all);
  });

  it('scopes to the started fleet', () => {
    expect(competitorsInRace(all, [start(['fleet-1'], '14:00:00')])).toEqual([A, C]);
  });

  it('scopes by a membership-only start with no gun time', () => {
    expect(competitorsInRace(all, [start(['fleet-2'])])).toEqual([B, C]);
  });

  it('includes a multi-fleet competitor if any of its fleets started', () => {
    expect(competitorsInRace(all, [start(['fleet-1'])])).toEqual([A, C]);
  });

  it('unions fleets across several starts', () => {
    const result = competitorsInRace(all, [start(['fleet-1'], '14:00:00'), start(['fleet-2'])]);
    expect(result).toEqual(all);
  });
});
