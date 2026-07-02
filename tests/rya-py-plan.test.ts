import { describe, expect, it } from 'vitest';

import { createClassMatcher, classKey } from '@/lib/rya-py/class-match';
import { planRyaPyUpdates } from '@/lib/source-handicaps';
import type { RyaPyClass } from '@/lib/rya-py/types';
import type { Competitor, Fleet } from '@/lib/types';

function comp(id: string, fleetIds: string[], extras: Partial<Competitor> = {}): Competitor {
  return {
    id,
    seriesId: 's',
    fleetIds,
    sailNumber: id,
    name: id,
    club: '',
    gender: '',
    age: null,
    createdAt: 0,
    ...extras,
  };
}

function fleet(id: string, system: Fleet['scoringSystem'], name = id): Fleet {
  return { id, seriesId: 's', name, displayOrder: 0, scoringSystem: system };
}

const cls = (c: Partial<RyaPyClass> & { name: string; number: number }): RyaPyClass => ({
  tier: 'base',
  ...c,
});

const classes: RyaPyClass[] = [
  cls({ classId: 191, name: 'ILCA 7 / Laser', slug: 'ilca_7', number: 1103 }),
  cls({ classId: 135, name: 'Firefly', slug: 'firefly', number: 1178 }),
  cls({ classId: 69, name: 'Comet Trio MK 1', slug: 'comet_trio', number: 1082 }),
  cls({ classId: 70, name: 'Comet Trio MK 2', slug: 'comet_trio', number: 1053 }),
  cls({ classId: 549, name: 'Melges 15', number: 994, tier: 'experimental' }),
];
const matcher = createClassMatcher(classes);

const pyFleet = fleet('f-py', 'py', 'Handicap');
const scratchFleet = fleet('f-scr', 'scratch');

describe('planRyaPyUpdates', () => {
  it('returns nothing when the series has no PY fleet', () => {
    const out = planRyaPyUpdates({
      targetCompetitors: [comp('A', ['f-scr'], { boatClass: 'Laser' })],
      targetFleets: [scratchFleet],
      matcher,
    });
    expect(out).toEqual([]);
  });

  it('groups boats of the same class (case-insensitively) into one proposal', () => {
    const out = planRyaPyUpdates({
      targetCompetitors: [
        comp('A', ['f-py'], { boatClass: 'Laser', pyNumber: 1100 }),
        comp('B', ['f-py'], { boatClass: 'laser', pyNumber: 1103 }),
        comp('C', ['f-py'], { boatClass: 'Firefly' }),
      ],
      targetFleets: [pyFleet],
      matcher,
    });
    expect(out.map((p) => p.enteredClass)).toEqual(['Firefly', 'Laser']);

    const laser = out.find((p) => p.enteredKey === 'laser')!;
    expect(laser.matchStatus).toBe('matched');
    expect(laser.via).toBe('alias');
    expect(laser.resolved?.classId).toBe(191);
    expect(laser.affected.map((a) => a.competitorId).sort()).toEqual(['A', 'B']);
    expect(laser.affected.find((a) => a.competitorId === 'A')?.currentNumber).toBe(1100);

    const firefly = out.find((p) => p.enteredKey === 'firefly')!;
    expect(firefly.resolved?.number).toBe(1178);
    expect(firefly.affected[0].currentNumber).toBeNull();
  });

  it('ignores boats with no class and non-PY fleet memberships', () => {
    const out = planRyaPyUpdates({
      targetCompetitors: [
        comp('A', ['f-py'], {}), // no class
        comp('B', ['f-scr'], { boatClass: 'Laser' }), // not a PY fleet
      ],
      targetFleets: [pyFleet, scratchFleet],
      matcher,
    });
    expect(out).toEqual([]);
  });

  it('marks a class that resolves to several rigs ambiguous, with candidates', () => {
    const out = planRyaPyUpdates({
      targetCompetitors: [comp('A', ['f-py'], { boatClass: 'Comet Trio' })],
      targetFleets: [pyFleet],
      matcher,
    });
    expect(out[0].matchStatus).toBe('ambiguous');
    expect(out[0].resolved).toBeNull();
    expect(out[0].candidates.map((c) => c.classId).sort()).toEqual([69, 70]);
  });

  it('resolves an ambiguous class via a manual pick', () => {
    const out = planRyaPyUpdates({
      targetCompetitors: [comp('A', ['f-py'], { boatClass: 'Comet Trio' })],
      targetFleets: [pyFleet],
      matcher,
      chosenByClass: { comettrio: classKey(classes[3]) }, // MK 2
    });
    expect(out[0].resolved?.classId).toBe(70);
    expect(out[0].resolved?.number).toBe(1053);
  });

  it('honours an explicit skip even for a unique match', () => {
    const out = planRyaPyUpdates({
      targetCompetitors: [comp('A', ['f-py'], { boatClass: 'Firefly' })],
      targetFleets: [pyFleet],
      matcher,
      chosenByClass: { firefly: '__skip__' },
    });
    expect(out[0].matchStatus).toBe('matched');
    expect(out[0].resolved).toBeNull();
  });

  it('reports an unknown class as none with no resolution', () => {
    const out = planRyaPyUpdates({
      targetCompetitors: [comp('A', ['f-py'], { boatClass: 'Wonderboat 9000' })],
      targetFleets: [pyFleet],
      matcher,
    });
    expect(out[0].matchStatus).toBe('none');
    expect(out[0].resolved).toBeNull();
    expect(out[0].manualNumber).toBeNull();
    expect(out[0].candidates).toEqual([]);
  });

  it('resolves an unmatched class via a typed-in local PY number', () => {
    const out = planRyaPyUpdates({
      targetCompetitors: [comp('A', ['f-py'], { boatClass: 'IDRA 14' })],
      targetFleets: [pyFleet],
      matcher,
      manualNumberByClass: { idra14: 1234 },
    });
    expect(out[0].matchStatus).toBe('none');
    expect(out[0].resolved).toBeNull();
    expect(out[0].manualNumber).toBe(1234);
  });

  it('lets a picked class win over a stale local number', () => {
    const out = planRyaPyUpdates({
      targetCompetitors: [comp('A', ['f-py'], { boatClass: 'Comet Trio' })],
      targetFleets: [pyFleet],
      matcher,
      chosenByClass: { comettrio: classKey(classes[3]) }, // MK 2
      manualNumberByClass: { comettrio: 1234 },
    });
    expect(out[0].resolved?.classId).toBe(70);
    expect(out[0].manualNumber).toBeNull();
  });

  it('ignores a local number for an explicitly skipped class', () => {
    const out = planRyaPyUpdates({
      targetCompetitors: [comp('A', ['f-py'], { boatClass: 'IDRA 14' })],
      targetFleets: [pyFleet],
      matcher,
      chosenByClass: { idra14: '__skip__' },
      manualNumberByClass: { idra14: 1234 },
    });
    expect(out[0].resolved).toBeNull();
    expect(out[0].manualNumber).toBeNull();
  });

  it('ignores a local number on an auto-matched class', () => {
    const out = planRyaPyUpdates({
      targetCompetitors: [comp('A', ['f-py'], { boatClass: 'Firefly' })],
      targetFleets: [pyFleet],
      matcher,
      manualNumberByClass: { firefly: 1234 },
    });
    expect(out[0].resolved?.classId).toBe(135);
    expect(out[0].manualNumber).toBeNull();
  });
});
