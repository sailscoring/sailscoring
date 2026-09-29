import { describe, it, expect } from 'vitest';

import {
  competitorsInRace,
  raceFleetIds,
  sailNumberInRace,
  withRaceSailNumbers,
} from '@/lib/race-membership';
import { resolveSailEntry } from '@/lib/finish-entry';
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

describe('boats drawn per fleet', () => {
  // The Champions' Cup shape: two qualifying fleets share boats 401-402, and
  // the final redraws them.
  const helm = (
    id: string,
    entry: string,
    fleetIds: string[],
    fleetSailNumbers?: Record<string, string>,
  ): Competitor =>
    ({ id, sailNumber: entry, fleetIds, fleetSailNumbers } as Competitor);
  const owens = helm('owens', '1', ['q1', 'final'], { q1: '401', final: '402' });
  const barry = helm('barry', '2', ['q2', 'final'], { q2: '401', final: '401' });
  const porter = helm('porter', '3', ['q1'], { q1: '402' });
  const late = helm('late', '4', ['q2']);

  it('is the boat drawn for the fleet racing', () => {
    expect(sailNumberInRace(owens, new Set(['q1']))).toBe('401');
    expect(sailNumberInRace(owens, new Set(['final']))).toBe('402');
    expect(sailNumberInRace(barry, new Set(['q2']))).toBe('401');
  });

  it('falls back to her own number when no boat is drawn yet', () => {
    expect(sailNumberInRace(late, new Set(['q2']))).toBe('4');
    expect(sailNumberInRace(helm('x', '9', ['q2'], { q2: '  ' }), new Set(['q2']))).toBe('9');
  });

  it('falls back to her own number in a race with no starts', () => {
    expect(sailNumberInRace(owens, new Set())).toBe('1');
    expect(withRaceSailNumbers([owens], [])).toEqual([owens]);
  });

  it('gives each fleet of a round its own helm in a shared boat', () => {
    const q1 = withRaceSailNumbers(competitorsInRace([owens, barry, porter, late], [start(['q1'])]), [start(['q1'])]);
    expect(q1.map((c) => [c.id, c.sailNumber])).toEqual([['owens', '401'], ['porter', '402']]);
    const q2 = withRaceSailNumbers(competitorsInRace([owens, barry, porter, late], [start(['q2'])]), [start(['q2'])]);
    expect(q2.map((c) => [c.id, c.sailNumber])).toEqual([['barry', '401'], ['late', '4']]);
  });

  it('follows the redraw into the final', () => {
    const f = withRaceSailNumbers([owens, barry], [start(['final'])]);
    expect(f.map((c) => c.sailNumber)).toEqual(['402', '401']);
  });

  it('returns an unchanged competitor as the same object', () => {
    expect(withRaceSailNumbers([late], [start(['q2'])])[0]).toBe(late);
  });
});

describe('finish entry against a race with drawn boats', () => {
  const helm = (id: string, entry: string, fleetIds: string[], boats: Record<string, string>) =>
    ({ id, sailNumber: entry, fleetIds, fleetSailNumbers: boats, names: [id] } as unknown as Competitor);
  // Both qualifying fleets sail boat 401; the final redraws it.
  const all = [
    helm('owens', '1', ['q1', 'final'], { q1: '401', final: '402' }),
    helm('barry', '2', ['q2', 'final'], { q2: '401', final: '401' }),
  ];

  it('finds the helm the boat carries in this race, not the one in the other fleet', () => {
    const q2 = withRaceSailNumbers(all, [start(['q2'])]);
    const hit = resolveSailEntry('401', q2, new Set());
    expect(hit.kind === 'commit' && hit.competitor.id).toBe('barry');
    const final = withRaceSailNumbers(all, [start(['final'])]);
    const f = resolveSailEntry('402', final, new Set());
    expect(f.kind === 'commit' && f.competitor.id).toBe('owens');
  });
});
