import { describe, expect, it } from 'vitest';
import {
  assignByRankPattern,
  defaultSplitFleetConfig,
  finalBlockSizes,
  logicalRaces,
  physicalRaceCompleted,
  provisionalCutIndexes,
  rankPatternFleetIndex,
  seedOrder,
  splitFleetStandings,
  type SplitFleetData,
  type SplitRound,
} from '@/lib/split-fleets';
import type { Competitor, Finish, Fleet, Race, RaceStart } from '@/lib/types';

function competitor(id: string, fleetIds: string[], sail: number): Competitor {
  return {
    id,
    seriesId: 's1',
    fleetIds,
    sailNumber: `IRL ${sail}`,
    names: [`Helm ${id}`],
    club: '',
    gender: '',
    age: null,
    createdAt: sail,
  };
}

function fleet(id: string, name: string): Fleet {
  return { id, seriesId: 's1', name, displayOrder: 0, scoringSystem: 'scratch' };
}

function race(id: string): Race {
  return {
    id,
    seriesId: 's1',
    raceNumber: 1,
    name: null,
    date: '2026-08-24',
    createdAt: 0,
  };
}

/** One start in a race's sequence: `fleetIds` sail stage race `n`. */
function start(
  raceId: string,
  fleetIds: string[],
  stage: 'qualifying' | 'final' | 'medal',
  n: number,
  firstPlaceOffset?: number,
): RaceStart {
  return {
    id: `${raceId}-start-${fleetIds.join('-')}`,
    raceId,
    fleetIds,
    stage,
    stageRaceNumber: n,
    ...(firstPlaceOffset != null ? { firstPlaceOffset } : {}),
  };
}

function finish(raceId: string, competitorId: string, sortOrder: number | null, code: Finish['resultCode'] = null): Finish {
  return {
    id: `${raceId}-${competitorId}`,
    raceId,
    competitorId,
    sortOrder,
    tiedWithPrevious: false,
    resultCode: code,
    startPresent: null,
    penaltyCode: null,
    penaltyOverride: null,
    redressMethod: null,
    redressExcludeRaceIds: null,
    redressIncludeRaceIds: null,
    redressIncludeAllLater: false,
    redressPoints: null,
  };
}

describe('rankPatternFleetIndex', () => {
  it('matches the ILCA 3-fleet table (Y B R R B Y | Y B R)', () => {
    const pattern = [0, 1, 2, 2, 1, 0, 0, 1, 2].map((_, i) => rankPatternFleetIndex(i, 3));
    expect(pattern).toEqual([0, 1, 2, 2, 1, 0, 0, 1, 2]);
  });

  it('matches the ILCA 2-fleet table (Y B B Y | Y B B Y Y)', () => {
    const pattern = Array.from({ length: 9 }, (_, i) => rankPatternFleetIndex(i, 2));
    expect(pattern).toEqual([0, 1, 1, 0, 0, 1, 1, 0, 0]);
  });

  it('matches the LE 4-fleet table (Y B R G G R B Y | Y)', () => {
    const pattern = Array.from({ length: 9 }, (_, i) => rankPatternFleetIndex(i, 4));
    expect(pattern).toEqual([0, 1, 2, 3, 3, 2, 1, 0, 0]);
  });
});

describe('assignByRankPattern', () => {
  it('produces near-equal fleets from any count', () => {
    const ids = Array.from({ length: 141 }, (_, i) => `c${i}`);
    const fleets = assignByRankPattern(ids, 3);
    expect(fleets.map((f) => f.length)).toEqual([47, 47, 47]);
    expect(fleets[0][0]).toBe('c0'); // rank 1 → Yellow
    expect(fleets[2][1]).toBe('c3'); // rank 4 → Red
  });
});

describe('seedOrder', () => {
  function seeded(id: string, sail: number, seed?: number, nationality?: string): Competitor {
    const c = competitor(id, [], sail);
    return { ...c, ...(seed != null ? { seed } : {}), ...(nationality ? { nationality } : {}) };
  }

  it('orders by the ranking’s own numbers, unranked sailors last', () => {
    // Global ranks, not a densified 1..n — 240 still sorts after 17.
    const order = seedOrder(
      [seeded('a', 10), seeded('b', 20, 240), seeded('c', 30, 17)],
      'seed-rank',
    );
    expect(order).toEqual(['c', 'b', 'a']);
  });

  it('spreads the unranked tail by nation when asked', () => {
    // Sail numbers mean nothing at a charter event; ordering the tail by
    // nation stops the pattern handing one fleet a national bloc.
    const tail = [
      seeded('irl1', 1, undefined, 'IRL'),
      seeded('gbr1', 2, undefined, 'GBR'),
      seeded('irl2', 3, undefined, 'IRL'),
      seeded('gbr2', 4, undefined, 'GBR'),
    ];
    expect(seedOrder(tail, 'seed-rank', 'nationality-spread')).toEqual([
      'gbr1', 'gbr2', 'irl1', 'irl2',
    ]);
    // The historical default leaves them in sail-number order.
    expect(seedOrder(tail, 'seed-rank')).toEqual(['irl1', 'gbr1', 'irl2', 'gbr2']);
  });

  it('keeps ranked sailors above the tail whichever tail order is used', () => {
    const order = seedOrder(
      [seeded('unranked', 1, undefined, 'AUS'), seeded('ranked', 99, 500, 'IRL')],
      'seed-rank',
      'nationality-spread',
    );
    expect(order).toEqual(['ranked', 'unranked']);
  });
});

describe('finalBlockSizes / provisionalCutIndexes', () => {
  it('never lets a later fleet outgrow an earlier one', () => {
    expect(finalBlockSizes(141, 3)).toEqual([47, 47, 47]);
    expect(finalBlockSizes(140, 3)).toEqual([47, 47, 46]);
    expect(finalBlockSizes(8, 3)).toEqual([3, 3, 2]);
  });

  it('cut indexes fall after each block', () => {
    expect(provisionalCutIndexes(8, 3)).toEqual([2, 5]);
  });
});

describe('splitFleetStandings', () => {
  const config = defaultSplitFleetConfig(2);

  function qualifyingData(): SplitFleetData {
    // Yellow: c1 c2 c3 (largest, 3) — Blue: c4 c5. DNC base = 4.
    const competitors = [
      competitor('c1', ['fy'], 1),
      competitor('c2', ['fy'], 2),
      competitor('c3', ['fy'], 3),
      competitor('c4', ['fb'], 4),
      competitor('c5', ['fb'], 5),
    ];
    const round: SplitRound = {
      id: 'r1',
      seriesId: 's1',
      stage: 'qualifying',
      fromStageRace: 1,
      fleetIds: ['fy', 'fb'],
      method: 'seeded',
      basis: null,
      createdAt: 0,
    };
    return {
      config,
      rounds: [round],
      fleets: [fleet('fy', 'Yellow'), fleet('fb', 'Blue')],
      competitors,
      races: [race('q1y'), race('q1b'), race('q2y')],
      raceStarts: [
        start('q1y', ['fy'], 'qualifying', 1),
        start('q1b', ['fb'], 'qualifying', 1),
        start('q2y', ['fy'], 'qualifying', 2),
      ],
      finishes: [
        finish('q1y', 'c1', 0),
        finish('q1y', 'c2', 1),
        // c3 absent from Q1·Y → DNC
        finish('q1b', 'c4', 0),
        finish('q1b', 'c5', null, 'DNF'),
        // Q2·Y completed, Q2·B doesn't exist yet → Q2 not valid
        finish('q2y', 'c3', 0),
      ],
    };
  }

  it('scores a valid logical race per fleet, with largest-fleet code base', () => {
    const rows = splitFleetStandings(qualifyingData());
    const net = Object.fromEntries(rows.map((r) => [r.competitor.id, r.net]));
    // Q1 counts: c1=1, c2=2, c3=DNC 4, c4=1, c5=DNF 4. Q2 does not count yet.
    expect(net).toEqual({ c1: 1, c2: 2, c3: 4, c4: 1, c5: 4 });
    const c3cells = rows.find((r) => r.competitor.id === 'c3')!.cells;
    expect(c3cells.find((c) => c.stageRaceNumber === 1)!.code).toBe('DNC');
    expect(c3cells.find((c) => c.stageRaceNumber === 2)!.counts).toBe(false);
  });

  it('ranks by net with A8.1 comparison on ties', () => {
    const rows = splitFleetStandings(qualifyingData());
    // c1 and c4 tie on 1 point with identical score lists — stable order,
    // both ahead of c2.
    expect(rows[0].net).toBe(1);
    expect(rows[1].net).toBe(1);
    expect(rows[2].competitor.id).toBe('c2');
  });

  it('caps final-series discards at maxFinalDiscards', () => {
    // One competitor, 4 counting races (3 qualifying + 2 final would exceed
    // threshold): worst scores are the final ones, but only one final race
    // may be discarded.
    const competitors = [competitor('c1', ['fy', 'fg'], 1), competitor('c2', ['fy', 'fg'], 2)];
    const qRound: SplitRound = {
      id: 'r1', seriesId: 's1', stage: 'qualifying', fromStageRace: 1,
      fleetIds: ['fy'], method: 'seeded', basis: null, createdAt: 0,
    };
    const fRound: SplitRound = {
      id: 'r2', seriesId: 's1', stage: 'final', fromStageRace: 1,
      fleetIds: ['fg'], method: 'split', basis: null, createdAt: 1,
    };
    const data: SplitFleetData = {
      config: { ...config, discardThresholds: [{ minRaces: 4, discardCount: 2 }] },
      rounds: [qRound, fRound],
      fleets: [fleet('fy', 'Yellow'), fleet('fg', 'Gold')],
      competitors,
      races: [race('q1'), race('q2'), race('f1'), race('f2')],
      raceStarts: [
        start('q1', ['fy'], 'qualifying', 1),
        start('q2', ['fy'], 'qualifying', 2),
        start('f1', ['fg'], 'final', 1),
        start('f2', ['fg'], 'final', 2),
      ],
      finishes: [
        // c1 wins both qualifying races (1, 1), is last in both final races (2, 2)
        finish('q1', 'c1', 0), finish('q1', 'c2', 1),
        finish('q2', 'c1', 0), finish('q2', 'c2', 1),
        finish('f1', 'c2', 0), finish('f1', 'c1', 1),
        finish('f2', 'c2', 0), finish('f2', 'c1', 1),
      ],
    };
    const rows = splitFleetStandings(data);
    const c1 = rows.find((r) => r.competitor.id === 'c1')!;
    const discardedStages = c1.cells.filter((c) => c.discarded).map((c) => c.stage).sort();
    // 2 discards allowed; c1's worst are the two final 2-pointers, but only
    // one final discard is permitted — the second discard falls on a
    // qualifying 1-pointer.
    expect(discardedStages).toEqual(['final', 'qualifying']);
    expect(c1.net).toBe(1 + 2); // one qualifying 1 + one final 2
  });

  it('scores per-fleet places from one combined sheet (sequenced starts)', () => {
    // Yellow and Blue start in sequence and finish onto one interleaved
    // sheet: crossing order c1(Y), c4(B), c2(Y), c5(B). Places are per
    // fleet, so both fleets get a 1st and a 2nd.
    const competitors = [
      competitor('c1', ['fy'], 1),
      competitor('c2', ['fy'], 2),
      competitor('c3', ['fy'], 3),
      competitor('c4', ['fb'], 4),
      competitor('c5', ['fb'], 5),
    ];
    const round: SplitRound = {
      id: 'r1', seriesId: 's1', stage: 'qualifying', fromStageRace: 1,
      fleetIds: ['fy', 'fb'], method: 'seeded', basis: null, createdAt: 0,
    };
    const data: SplitFleetData = {
      config,
      rounds: [round],
      fleets: [fleet('fy', 'Yellow'), fleet('fb', 'Blue')],
      competitors,
      races: [race('q1')],
      raceStarts: [
        start('q1', ['fy'], 'qualifying', 1),
        start('q1', ['fb'], 'qualifying', 1),
      ],
      finishes: [
        finish('q1', 'c1', 0),
        finish('q1', 'c4', 1),
        finish('q1', 'c2', 2),
        finish('q1', 'c5', 3),
        // c3 absent from the sheet → DNC at largest-fleet base (3 + 1)
      ],
    };
    const rows = splitFleetStandings(data);
    const net = Object.fromEntries(rows.map((r) => [r.competitor.id, r.net]));
    expect(net).toEqual({ c1: 1, c4: 1, c2: 2, c5: 2, c3: 4 });
    // Both fleets have rows on the sheet, so Q1 is valid across fleets.
    expect(logicalRaces(data, 'qualifying')[0].valid).toBe(true);
  });

  it('lets one sequence span stage race numbers (Gold F2 + Silver F1)', () => {
    const competitors = [
      competitor('c1', ['fg'], 1),
      competitor('c2', ['fg'], 2),
      competitor('c3', ['fs'], 3),
      competitor('c4', ['fs'], 4),
    ];
    const fRound: SplitRound = {
      id: 'r2', seriesId: 's1', stage: 'final', fromStageRace: 1,
      fleetIds: ['fg', 'fs'], method: 'split', basis: null, createdAt: 1,
    };
    const data: SplitFleetData = {
      config,
      rounds: [fRound],
      fleets: [fleet('fg', 'Gold'), fleet('fs', 'Silver')],
      competitors,
      // Gold sailed F1 alone; the next sequence holds Gold F2 + Silver F1.
      races: [race('f1g'), race('seq2')],
      raceStarts: [
        start('f1g', ['fg'], 'final', 1),
        start('seq2', ['fg'], 'final', 2),
        start('seq2', ['fs'], 'final', 1),
      ],
      finishes: [
        finish('f1g', 'c1', 0),
        finish('f1g', 'c2', 1),
        // seq2 interleaved: c3(S), c1(G), c4(S), c2(G)
        finish('seq2', 'c3', 0),
        finish('seq2', 'c1', 1),
        finish('seq2', 'c4', 2),
        finish('seq2', 'c2', 3),
      ],
    };
    const rows = splitFleetStandings(data);
    const c1 = rows.find((r) => r.competitor.id === 'c1')!;
    const c3 = rows.find((r) => r.competitor.id === 'c3')!;
    // Gold's cells are F1 and F2; Silver's one race is F1 — same sequence,
    // different stage race numbers.
    expect(c1.cells.map((c) => c.stageRaceNumber).sort()).toEqual([1, 2]);
    expect(c1.cells.every((c) => c.points === 1)).toBe(true);
    expect(c3.cells).toHaveLength(1);
    expect(c3.cells[0].stageRaceNumber).toBe(1);
    expect(c3.cells[0].points).toBe(1);
  });

  it('completes a sequence per fleet as its rows land on the sheet', () => {
    const competitors = [
      competitor('c1', ['fy'], 1),
      competitor('c2', ['fb'], 2),
    ];
    const round: SplitRound = {
      id: 'r1', seriesId: 's1', stage: 'qualifying', fromStageRace: 1,
      fleetIds: ['fy', 'fb'], method: 'seeded', basis: null, createdAt: 0,
    };
    const data: SplitFleetData = {
      config,
      rounds: [round],
      fleets: [fleet('fy', 'Yellow'), fleet('fb', 'Blue')],
      competitors,
      races: [race('q1')],
      raceStarts: [
        start('q1', ['fy'], 'qualifying', 1),
        start('q1', ['fb'], 'qualifying', 1),
      ],
      finishes: [finish('q1', 'c1', 0)], // only Yellow has crossed so far
    };
    const [lr] = logicalRaces(data, 'qualifying');
    expect(lr.valid).toBe(false);
    expect(physicalRaceCompleted(lr.races.get('fy')!, competitors, data.finishes)).toBe(true);
    expect(physicalRaceCompleted(lr.races.get('fb')!, competitors, data.finishes)).toBe(false);
    // Blue's first row lands → the logical race becomes valid.
    data.finishes.push(finish('q1', 'c2', 1));
    expect(logicalRaces(data, 'qualifying')[0].valid).toBe(true);
  });

  it('prefers the completed resail when an abandoned start lingers', () => {
    // Red's Q1 was abandoned (start still on the sequence race, no rows) and
    // resailed as its own one-start race. Whichever order the starts arrive
    // in, the logical race must key Red to the completed resail.
    const competitors = [
      competitor('c1', ['fy'], 1),
      competitor('c2', ['fr'], 2),
    ];
    const round: SplitRound = {
      id: 'r1', seriesId: 's1', stage: 'qualifying', fromStageRace: 1,
      fleetIds: ['fy', 'fr'], method: 'seeded', basis: null, createdAt: 0,
    };
    const base: SplitFleetData = {
      config,
      rounds: [round],
      fleets: [fleet('fy', 'Yellow'), fleet('fr', 'Red')],
      competitors,
      races: [{ ...race('q1'), raceNumber: 1 }, { ...race('q1r'), raceNumber: 2 }],
      raceStarts: [],
      finishes: [
        finish('q1', 'c1', 0), // Yellow finished on the original sheet
        finish('q1r', 'c2', 0), // Red finished the resail
      ],
    };
    const abandoned = start('q1', ['fy', 'fr'], 'qualifying', 1);
    const resail = start('q1r', ['fr'], 'qualifying', 1);
    for (const raceStarts of [[abandoned, resail], [resail, abandoned]]) {
      const [lr] = logicalRaces({ ...base, raceStarts }, 'qualifying');
      expect(lr.valid).toBe(true);
      expect(lr.races.get('fr')!.race.id).toBe('q1r');
    }
  });

  it('orders tiers after the split and pins medal boats on top', () => {
    const competitors = [
      competitor('c1', ['fg', 'fm'], 1),
      competitor('c2', ['fg'], 2),
      competitor('c3', ['fs'], 3),
    ];
    const fRound: SplitRound = {
      id: 'r2', seriesId: 's1', stage: 'final', fromStageRace: 1,
      fleetIds: ['fg', 'fs'], method: 'split', basis: null, createdAt: 1,
    };
    const mRound: SplitRound = {
      id: 'r3', seriesId: 's1', stage: 'medal', fromStageRace: 1,
      fleetIds: ['fm'], method: 'medal-select', basis: null, createdAt: 2,
    };
    const data: SplitFleetData = {
      config,
      rounds: [fRound, mRound],
      fleets: [fleet('fg', 'Gold'), fleet('fs', 'Silver'), fleet('fm', 'Medal')],
      competitors,
      races: [race('f1g'), race('f1s'), race('m1')],
      raceStarts: [
        start('f1g', ['fg'], 'final', 1),
        start('f1s', ['fs'], 'final', 1),
        start('m1', ['fm'], 'medal', 1),
      ],
      finishes: [
        finish('f1g', 'c2', 0),
        finish('f1g', 'c1', 1),
        finish('f1s', 'c3', 0),
        finish('m1', 'c1', 0),
      ],
    };
    const rows = splitFleetStandings(data);
    // c1 is the medal boat → ranked 1 despite worse Gold score; c3 (Silver
    // winner, 1pt) still ranks below c2 (Gold, 1pt... c2 scored 1 in gold).
    expect(rows.map((r) => r.competitor.id)).toEqual(['c1', 'c2', 'c3']);
    // Medal race doubled: c1's medal cell is 2 points and non-discardable.
    const medalCell = rows[0].cells.find((c) => c.stage === 'medal')!;
    expect(medalCell.points).toBe(2);
    expect(medalCell.discardable).toBe(false);
  });
});
