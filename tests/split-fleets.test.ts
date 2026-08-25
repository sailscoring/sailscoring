import { describe, expect, it } from 'vitest';
import {
  assignByRankPattern,
  assignFromInitialFleet,
  ilcaSplitFleetConfig,
  iodaSplitFleetConfig,
  ilca2026SplitFleetConfig,
  normalizeSplitFleetConfig,
  resolveVocabulary,
  stageRaceLabel,
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

describe('assignFromInitialFleet', () => {
  const QUALIFYING = [
    { label: 'Yellow', color: '' },
    { label: 'Blue', color: '' },
    { label: 'Red', color: '' },
  ];

  function assigned(id: string, sail: number, initialFleet?: string): Competitor {
    const c = competitor(id, [], sail);
    return { ...c, ...(initialFleet != null ? { initialFleet } : {}) };
  }

  it('matches the committee\u2019s labels to the configured fleets', () => {
    const { assignments, unassigned, unknownLabels } = assignFromInitialFleet(
      [assigned('c1', 1, 'Yellow'), assigned('c2', 2, 'Red'), assigned('c3', 3, 'Blue')],
      QUALIFYING,
    );
    expect(assignments).toEqual({ c1: 0, c2: 2, c3: 1 });
    expect(unassigned).toEqual([]);
    expect(unknownLabels).toEqual([]);
  });

  it('ignores case and spacing, which an entry list never keeps consistent', () => {
    const { assignments } = assignFromInitialFleet(
      [assigned('c1', 1, ' yellow '), assigned('c2', 2, 'BLUE')],
      QUALIFYING,
    );
    expect(assignments).toEqual({ c1: 0, c2: 1 });
  });

  it('reads a plain number as a position in the fleet list', () => {
    const { assignments, unassigned } = assignFromInitialFleet(
      [assigned('c1', 1, '1'), assigned('c2', 2, '3'), assigned('c3', 3, '4')],
      QUALIFYING,
    );
    expect(assignments).toEqual({ c1: 0, c2: 2 });
    // 4 is past the end of a three-fleet championship — not a fleet at all.
    expect(unassigned).toEqual(['c3']);
  });

  it('a fleet label wins over the positional reading', () => {
    const numbered = [
      { label: '3', color: '' },
      { label: '2', color: '' },
      { label: '1', color: '' },
    ];
    const { assignments } = assignFromInitialFleet([assigned('c1', 1, '1')], numbered);
    expect(assignments).toEqual({ c1: 2 });
  });

  it('reports a boat the entry list placed nowhere', () => {
    const { assignments, unassigned, unknownLabels } = assignFromInitialFleet(
      [assigned('c1', 1, 'Yellow'), assigned('c2', 2), assigned('c3', 3, '  ')],
      QUALIFYING,
    );
    expect(assignments).toEqual({ c1: 0 });
    expect(unassigned).toEqual(['c2', 'c3']);
    expect(unknownLabels).toEqual([]);
  });

  it('reports a label no fleet answers to, once, as written', () => {
    const { unassigned, unknownLabels } = assignFromInitialFleet(
      [assigned('c1', 1, 'Green'), assigned('c2', 2, 'green'), assigned('c3', 3, 'Yellow')],
      QUALIFYING,
    );
    expect(unassigned).toEqual(['c1', 'c2']);
    expect(unknownLabels).toEqual(['Green']);
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

  it('a tie RRS A8 cannot break shares the rank, and the next boat skips it', () => {
    const rows = splitFleetStandings(qualifyingData());
    const rank = Object.fromEntries(rows.map((r) => [r.competitor.id, r.rank]));
    // c1 (1st in Yellow) and c4 (1st in Blue) hold identical score lists and
    // count back equal, as do c3 (DNC 4) and c5 (DNF 4): joint 1st and joint
    // 4th, with c2 alone on 3rd.
    expect(rank).toEqual({ c1: 1, c4: 1, c2: 3, c3: 4, c5: 4 });
  });

  it('a tie A8.2 breaks does not share the rank', () => {
    const competitors = [competitor('c1', ['fy'], 1), competitor('c2', ['fy'], 2)];
    const round: SplitRound = {
      id: 'r1', seriesId: 's1', stage: 'qualifying', fromStageRace: 1,
      fleetIds: ['fy'], method: 'seeded', basis: null, createdAt: 0,
    };
    const data: SplitFleetData = {
      config,
      rounds: [round],
      fleets: [fleet('fy', 'Yellow')],
      competitors,
      races: [race('q1'), race('q2')],
      raceStarts: [start('q1', ['fy'], 'qualifying', 1), start('q2', ['fy'], 'qualifying', 2)],
      finishes: [
        // c1: 1, 2 — c2: 2, 1. Equal nets, equal sorted lists; the last race
        // separates them.
        finish('q1', 'c1', 0), finish('q1', 'c2', 1),
        finish('q2', 'c2', 0), finish('q2', 'c1', 1),
      ],
    };
    const rows = splitFleetStandings(data);
    expect(rows.map((r) => [r.competitor.id, r.rank])).toEqual([
      ['c2', 1],
      ['c1', 2],
    ]);
  });

  it('boats in different tiers never share a rank, even on identical scores', () => {
    const competitors = [
      competitor('c1', ['fy', 'fg'], 1),
      competitor('c2', ['fy', 'fg'], 2),
      competitor('c3', ['fy', 'fs'], 3),
    ];
    const qRound: SplitRound = {
      id: 'r1', seriesId: 's1', stage: 'qualifying', fromStageRace: 1,
      fleetIds: ['fy'], method: 'seeded', basis: null, createdAt: 0,
    };
    const fRound: SplitRound = {
      id: 'r2', seriesId: 's1', stage: 'final', fromStageRace: 1,
      fleetIds: ['fg', 'fs'], method: 'split', basis: null, createdAt: 1,
    };
    const data: SplitFleetData = {
      config,
      rounds: [qRound, fRound],
      fleets: [fleet('fy', 'Yellow'), fleet('fg', 'Gold'), fleet('fs', 'Silver')],
      competitors,
      races: [race('f1g'), race('f1s')],
      raceStarts: [
        start('f1g', ['fg'], 'final', 1),
        // Silver scored below Gold: its winner takes 2 — the same score line
        // as Gold's second place.
        start('f1s', ['fs'], 'final', 1, 1),
      ],
      finishes: [
        finish('f1g', 'c1', 0),
        finish('f1g', 'c2', 1),
        finish('f1s', 'c3', 0),
      ],
    };
    const rows = splitFleetStandings(data);
    const c2 = rows.find((r) => r.competitor.id === 'c2')!;
    const c3 = rows.find((r) => r.competitor.id === 'c3')!;
    // Identical nets and score lines, but Gold ranks above Silver: no shared
    // rank across the tier boundary.
    expect(c2.net).toBe(c3.net);
    expect(c2.rank).toBe(2);
    expect(c3.rank).toBe(3);
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

describe('scoring penalties (RRS 44.3(c))', () => {
  /** One qualifying fleet of `size` boats sailing one race; the first
   *  finisher carries `penalty`. Returns her points. */
  function penalizedWinner(size: number, penalty: Partial<Finish>, place = 0): number {
    const config = defaultSplitFleetConfig(2);
    const competitors = Array.from({ length: size }, (_, i) =>
      competitor(`c${i}`, ['fy'], i + 1),
    );
    const round: SplitRound = {
      id: 'r1', seriesId: 's1', stage: 'qualifying', fromStageRace: 1,
      fleetIds: ['fy'], method: 'seeded', basis: null, createdAt: 0,
    };
    const data: SplitFleetData = {
      config,
      rounds: [round],
      fleets: [fleet('fy', 'Yellow')],
      competitors,
      races: [race('q1')],
      raceStarts: [start('q1', ['fy'], 'qualifying', 1)],
      finishes: competitors.map((c, i) => ({
        ...finish('q1', c.id, i),
        ...(i === place ? penalty : {}),
      })),
    };
    const row = splitFleetStandings(data).find((r) => r.competitor.id === `c${place}`)!;
    return row.cells[0].points;
  }

  it('adds a percentage of the DNF score to the nearest tenth, not the nearest point', () => {
    // 10 boats → DNF score 11. 10% of 11 is 1.1, so the winner scores 2.1 —
    // whole-point rounding would say 2.
    expect(penalizedWinner(10, { penaltyCode: 'SCP', penaltyOverride: 10 })).toBe(2.1);
    // 30% of 11 = 3.3 (SI 17.10's centreboard-stopper penalty shape).
    expect(penalizedWinner(10, { penaltyCode: 'SCP', penaltyOverride: 30 })).toBe(4.3);
  });

  it('never makes a boat worse than the DNF score', () => {
    // 4 boats → DNF score 5. Last place (4) + 50% of 5 = 6.5, capped at 5.
    expect(penalizedWinner(4, { penaltyCode: 'SCP', penaltyOverride: 50 }, 3)).toBe(5);
  });

  it('defaults ZFP to 20% of the DNF score', () => {
    // 10 boats → DNF score 11; 20% = 2.2.
    expect(penalizedWinner(10, { penaltyCode: 'ZFP' })).toBe(3.2);
  });

  it('adds DPI as stated points, still capped at the DNF score', () => {
    expect(penalizedWinner(10, { penaltyCode: 'DPI', penaltyOverride: 1 })).toBe(2);
    expect(penalizedWinner(4, { penaltyCode: 'DPI', penaltyOverride: 9 })).toBe(5);
  });
});


describe('stageRaceLabel', () => {
  it('restarts each stage under its own prefix by default', () => {
    const config = defaultSplitFleetConfig(3);
    expect(stageRaceLabel(config, 'qualifying', 3, 5)).toBe('Q3');
    expect(stageRaceLabel(config, 'final', 1, 5)).toBe('F1');
    expect(stageRaceLabel(config, 'medal', 1, 5)).toBe('M1');
  });

  it('numbers the 2026 ILCA final stage on from the qualifying stage', () => {
    // Their Preliminary and Elimination series run Q1…Q12 straight through,
    // and only the Final series restarts — so the first Gold race is Q6, not
    // F1, and the first Final series race is F1, not M1.
    const config = ilca2026SplitFleetConfig(3);
    expect(stageRaceLabel(config, 'qualifying', 5, 5)).toBe('Q5');
    expect(stageRaceLabel(config, 'final', 1, 5)).toBe('Q6');
    expect(stageRaceLabel(config, 'final', 6, 5)).toBe('Q11');
    expect(stageRaceLabel(config, 'medal', 1, 5)).toBe('F1');
  });

  it('labels the carried scores rather than numbering them', () => {
    const config = defaultSplitFleetConfig(2);
    expect(stageRaceLabel(config, 'final', 0)).toBe('QS');
    expect(stageRaceLabel(config, 'medal', 0)).toBe('Carried');
  });
});


describe('vocabulary', () => {
  it('gives the generic wording by default and ILCA’s under its preset', () => {
    expect(resolveVocabulary(defaultSplitFleetConfig(3)).stages).toMatchObject({
      qualifying: { name: 'qualifying series' },
      final: { name: 'final series' },
      medal: { name: 'medal races' },
    });
    const ilca = resolveVocabulary(ilca2026SplitFleetConfig(3));
    expect(ilca.seriesName).toBe('Qualification series');
    expect(ilca.stages).toMatchObject({
      qualifying: { name: 'Preliminary series' },
      final: { name: 'Elimination series' },
      medal: { name: 'Final series' },
    });
  });

  it('never lets the two vocabularies' + "'" + ' shared words mean the same stage', () => {
    // "final series" exists in both and names a different stage in each —
    // which is the whole reason this is one choice rather than three labels.
    const generic = resolveVocabulary(defaultSplitFleetConfig(2));
    const ilca = resolveVocabulary(ilca2026SplitFleetConfig(2));
    expect(generic.stages.final.name.toLowerCase()).toBe('final series');
    expect(ilca.stages.medal.name.toLowerCase()).toBe('final series');
    expect(ilca.stages.final.name.toLowerCase()).not.toBe('final series');
  });

  it('derives the carried-score column header from the vocabulary', () => {
    expect(stageRaceLabel(defaultSplitFleetConfig(2), 'final', 0)).toBe('QS');
    expect(stageRaceLabel(ilca2026SplitFleetConfig(2), 'final', 0)).toBe('QS');
    expect(stageRaceLabel(defaultSplitFleetConfig(2), 'medal', 0)).toBe('Carried');
  });

  describe('reading a v33 config, which authored the words directly', () => {
    const legacy = (labels: Record<string, string>, prefixes: Record<string, string>, cont: boolean) =>
      normalizeSplitFleetConfig({
        ...defaultSplitFleetConfig(2),
        vocabulary: undefined,
        stageNaming: { labels, prefixes, continuousOpeningNumbers: cont },
      } as never);

    it('recognises a block that matches a tabulated vocabulary', () => {
      const config = legacy(
        { qualifying: 'Preliminary series', final: 'Elimination series', medal: 'Final series' },
        { qualifying: 'Q', final: 'Q', medal: 'F' },
        true,
      );
      expect(config.vocabulary).toBe('qualification-final');
      expect(config.vocabularyOverride).toBeUndefined();
    });

    it('keeps hand-edited wording as an override rather than losing it', () => {
      const config = legacy(
        { qualifying: 'Series A', final: 'Series B', medal: 'Series C' },
        { qualifying: 'A', final: 'B', medal: 'C' },
        false,
      );
      expect(config.vocabulary).toBe('opening-medal');
      expect(resolveVocabulary(config).stages.qualifying.name).toBe('Series A');
      expect(stageRaceLabel(config, 'final', 2)).toBe('B2');
    });

    it('falls back to the generic wording when there is nothing to read', () => {
      const config = normalizeSplitFleetConfig({ carry: 'points' });
      expect(config.vocabulary).toBe('opening-medal');
      expect(resolveVocabulary(config).stages.medal.name).toBe('medal races');
    });
  });
});


describe('presets survive normalisation unchanged', () => {
  // The config editor decides whether a series is still its class format by
  // rebuilding the format and comparing. A preset that came back from the
  // server differing from a freshly built one — a default filled in, a field
  // reordered into existence — would leave every such series reading
  // "Custom" the moment it was reopened.
  const presets = {
    'ilca-2026': ilca2026SplitFleetConfig(3),
    'ilca-2025': ilcaSplitFleetConfig(3),
    ioda: iodaSplitFleetConfig(4),
    'net-plus-net': { ...defaultSplitFleetConfig(2), carry: 'net-plus-net' as const, medal: undefined },
    'rank-seed': { ...defaultSplitFleetConfig(2), carry: 'rank-seed' as const, medal: undefined },
  };

  it.each(Object.entries(presets))('%s', (_name, config) => {
    expect(normalizeSplitFleetConfig(config)).toEqual(config);
  });
});

describe('one race per fleet scores the same as one combined sheet', () => {
  /**
   * `SplitFleetConfig.finishSheets` decides whether a stage race's fleets
   * share a `Race` or get one each. That is a difference in how the races are
   * laid out, and it must not be a difference in points: a boat is ranked
   * among her own fleet by the boats' relative order, so an interleaved sheet
   * and a sheet per fleet describe the same result.
   *
   * The same Q1 below is expressed both ways — combined, where the three
   * fleets cross one line and hold a single sortOrder sequence 0..8; and per
   * fleet, where each fleet's sheet starts again at 0.
   */
  const config = defaultSplitFleetConfig(3);
  const competitors = [
    competitor('y1', ['fy'], 1), competitor('y2', ['fy'], 2), competitor('y3', ['fy'], 3),
    competitor('b1', ['fb'], 4), competitor('b2', ['fb'], 5), competitor('b3', ['fb'], 6),
    competitor('r1', ['fr'], 7), competitor('r2', ['fr'], 8), competitor('r3', ['fr'], 9),
  ];
  const round: SplitRound = {
    id: 'r1', seriesId: 's1', stage: 'qualifying', fromStageRace: 1,
    fleetIds: ['fy', 'fb', 'fr'], method: 'seeded', basis: null, createdAt: 0,
  };
  const fleets = [fleet('fy', 'Yellow'), fleet('fb', 'Blue'), fleet('fr', 'Red')];

  /** One sheet, fleets interleaved as they crossed: b1 y1 r1 y2 … */
  function combined(): SplitFleetData {
    return {
      config, rounds: [round], fleets, competitors,
      races: [race('q1')],
      raceStarts: [start('q1', ['fy', 'fb', 'fr'], 'qualifying', 1)],
      finishes: [
        finish('q1', 'b1', 0),
        finish('q1', 'y1', 1),
        finish('q1', 'r1', 2),
        finish('q1', 'y2', 3),
        finish('q1', 'b2', 4),
        finish('q1', 'r2', 5),
        finish('q1', 'y3', 6),
        finish('q1', 'r3', 7),
        finish('q1', 'b3', null, 'DNF'),
      ],
    };
  }

  /** The same finishing order, split across a race per fleet. */
  function perFleet(): SplitFleetData {
    return {
      config, rounds: [round], fleets, competitors,
      races: [race('q1y'), race('q1b'), race('q1r')],
      raceStarts: [
        start('q1y', ['fy'], 'qualifying', 1),
        start('q1b', ['fb'], 'qualifying', 1),
        start('q1r', ['fr'], 'qualifying', 1),
      ],
      finishes: [
        finish('q1y', 'y1', 0), finish('q1y', 'y2', 1), finish('q1y', 'y3', 2),
        finish('q1b', 'b1', 0), finish('q1b', 'b2', 1), finish('q1b', 'b3', null, 'DNF'),
        finish('q1r', 'r1', 0), finish('q1r', 'r2', 1), finish('q1r', 'r3', 2),
      ],
    };
  }

  const points = (data: SplitFleetData) =>
    Object.fromEntries(splitFleetStandings(data).map((r) => [r.competitor.id, r.net]));

  it('gives every boat the same score either way', () => {
    expect(points(perFleet())).toEqual(points(combined()));
  });

  it('and the score is the one the fleets’ own orders imply', () => {
    // Three boats a fleet, so a DNF scores 4 (largest fleet + 1).
    expect(points(combined())).toEqual({
      y1: 1, y2: 2, y3: 3,
      b1: 1, b2: 2, b3: 4,
      r1: 1, r2: 2, r3: 3,
    });
  });

  it('counts the logical race as complete whichever shape it took', () => {
    for (const data of [combined(), perFleet()]) {
      const [logical] = logicalRaces(data, 'qualifying');
      expect(logical.stageRaceNumber).toBe(1);
      expect([...logical.races.keys()].sort()).toEqual(['fb', 'fr', 'fy']);
      expect(logical.valid).toBe(true);
    }
  });
});
