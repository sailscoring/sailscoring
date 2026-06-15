import { describe, expect, it } from 'vitest';

import { placementInStandings } from '@/lib/career-arc-placement';
import type { FleetStandingsResult } from '@/lib/scoring';
import type { Fleet, Standing } from '@/lib/types';

function standing(competitorId: string, rank: number): Standing {
  return { rank, competitor: { id: competitorId } } as unknown as Standing;
}

function fleet(id: string, name: string): Fleet {
  return { id, name } as unknown as Fleet;
}

function result(
  fleets: Array<{ fleet: Fleet; ids: Array<[string, number]> }>,
): FleetStandingsResult {
  return {
    fleetStandings: fleets.map((f) => ({
      fleet: f.fleet,
      standings: f.ids.map(([id, rank]) => standing(id, rank)),
      rejections: [],
    })),
    circularRedressRaces: [],
  };
}

describe('placementInStandings', () => {
  const single = result([
    {
      fleet: fleet('f1', 'Main Fleet'),
      ids: [
        ['a', 1],
        ['b', 2],
        ['c', 3],
      ],
    },
  ]);

  it('returns rank and fleet size, no fleet name for a single-fleet series', () => {
    expect(placementInStandings(single, 'b', { hasRaces: true, multiFleet: false })).toEqual({
      rank: 2,
      fleetSize: 3,
      fleetName: null,
    });
  });

  it('names the fleet for a multi-fleet series', () => {
    const multi = result([
      { fleet: fleet('gold', 'Gold'), ids: [['a', 1], ['b', 2]] },
      { fleet: fleet('silver', 'Silver'), ids: [['c', 1], ['d', 2]] },
    ]);
    expect(placementInStandings(multi, 'c', { hasRaces: true, multiFleet: true })).toEqual({
      rank: 1,
      fleetSize: 2,
      fleetName: 'Silver',
    });
  });

  it('is unplaced when the series has no races', () => {
    expect(placementInStandings(single, 'a', { hasRaces: false, multiFleet: false })).toEqual({
      rank: null,
      fleetSize: null,
      fleetName: null,
    });
  });

  it('is unplaced when the competitor is not in any fleet standings', () => {
    expect(placementInStandings(single, 'z', { hasRaces: true, multiFleet: false })).toEqual({
      rank: null,
      fleetSize: null,
      fleetName: null,
    });
  });
});
