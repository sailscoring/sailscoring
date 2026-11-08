import { describe, expect, it } from 'vitest';

import {
  describeFleetChanges,
  fleetsInRace,
  liveFleetChanges,
  remapFleetChanges,
  setFleetInRace,
  withRaceFleets,
} from '@/lib/race-fleets';
import type { RaceFleetChange } from '@/lib/types';

const loinnir = { id: 'c1', fleetIds: ['overall', 'two-handed'] };
const paradox = { id: 'c2', fleetIds: ['overall'] };

describe('fleetsInRace', () => {
  it('is the series fleets when the race changes nothing for the boat', () => {
    expect(fleetsInRace(loinnir, { fleetChanges: [{ competitorId: 'c2', drop: ['overall'] }] })).toEqual([
      'overall',
      'two-handed',
    ]);
    expect(fleetsInRace(loinnir, undefined)).toEqual(['overall', 'two-handed']);
  });

  it('takes out the fleets dropped for the race and adds the ones added', () => {
    const race = { fleetChanges: [{ competitorId: 'c1', drop: ['two-handed'], add: ['class-2'] }] };
    expect(fleetsInRace(loinnir, race)).toEqual(['overall', 'class-2']);
  });
});

describe('withRaceFleets', () => {
  it('returns the same objects when the race has no changes', () => {
    const list = [loinnir, paradox];
    expect(withRaceFleets(list, {})).toBe(list);
  });

  it('gives a changed boat its fleets in the race and leaves the others alone', () => {
    const [l, p] = withRaceFleets([loinnir, paradox], {
      fleetChanges: [{ competitorId: 'c1', drop: ['two-handed'] }],
    });
    expect(l.fleetIds).toEqual(['overall']);
    expect(p).toBe(paradox);
    expect(loinnir.fleetIds).toEqual(['overall', 'two-handed']);
  });
});

describe('setFleetInRace', () => {
  it('records a drop from a series fleet, and removes it when the boat is put back', () => {
    const dropped = setFleetInRace(undefined, loinnir, 'two-handed', false);
    expect(dropped).toEqual([{ competitorId: 'c1', drop: ['two-handed'] }]);
    expect(setFleetInRace(dropped, loinnir, 'two-handed', true)).toBeUndefined();
  });

  it('records an add to a fleet outside the series fleets', () => {
    expect(setFleetInRace(undefined, paradox, 'two-handed', true)).toEqual([
      { competitorId: 'c2', add: ['two-handed'] },
    ]);
  });

  it('records nothing for a change that is already the default', () => {
    expect(setFleetInRace(undefined, loinnir, 'overall', true)).toBeUndefined();
    expect(setFleetInRace(undefined, paradox, 'two-handed', false)).toBeUndefined();
  });

  it("keeps other boats' changes", () => {
    const start: RaceFleetChange[] = [{ competitorId: 'c2', add: ['two-handed'] }];
    expect(setFleetInRace(start, loinnir, 'two-handed', false)).toEqual([
      { competitorId: 'c2', add: ['two-handed'] },
      { competitorId: 'c1', drop: ['two-handed'] },
    ]);
  });
});

describe('remapFleetChanges and liveFleetChanges', () => {
  const changes: RaceFleetChange[] = [
    { competitorId: 'c1', drop: ['two-handed'], add: ['gone'] },
    { competitorId: 'removed', drop: ['overall'] },
    { competitorId: 'c2', add: ['gone'] },
  ];

  it('moves boats and fleets to new ids, dropping what does not resolve', () => {
    expect(
      remapFleetChanges(changes, new Map([['c1', 'n1'], ['c2', 'n2']]), new Map([['two-handed', 'nth']])),
    ).toEqual([{ competitorId: 'n1', drop: ['nth'] }]);
  });

  it('keeps only boats and fleets that still exist', () => {
    expect(liveFleetChanges(changes, new Set(['c1', 'c2']), new Set(['overall', 'two-handed']))).toEqual([
      { competitorId: 'c1', drop: ['two-handed'] },
    ]);
  });
});

describe('describeFleetChanges', () => {
  const names = (id: string) => ({ c1: 'Loinnir', c2: 'Paradox' })[id] ?? id;
  const fleets = (id: string) => ({ 'two-handed': 'Two-Handed', 'class-2': 'IRC Class 2' })[id] ?? id;

  it('says what each boat is in or out of now', () => {
    expect(
      describeFleetChanges(
        [{ competitorId: 'c2', drop: ['two-handed'] }, { competitorId: 'c1', add: ['class-2'] }],
        [{ competitorId: 'c1', drop: ['two-handed'] }],
        names,
        fleets,
      ),
    ).toEqual(['Paradox: back in Two-Handed', 'Loinnir: not in IRC Class 2', 'Loinnir: not in Two-Handed']);
  });

  it('says nothing when nothing changed', () => {
    const same = [{ competitorId: 'c1', drop: ['two-handed'] }];
    expect(describeFleetChanges(same, same, names, fleets)).toEqual([]);
  });
});
