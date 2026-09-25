import { describe, expect, it } from 'vitest';
import {
  assignByRankPattern,
  assignFromInitialFleet,
  VOCABULARIES,
  normalizeSplitFleetConfig,
  resolveVocabulary,
  stageRaceLabel,
  defaultSplitFleetConfig,
  boatsOutsideCompanionRace,
  resizeFleets,
  UNBANDED_FLEET,
  finishSheetsInUse,
  finalBlockSizes,
  logicalRaces,
  physicalRaceCompleted,
  provisionalCutIndexes,
  rankPatternFleetIndex,
  seedOrder,
  splitFleetStandings,
  type SplitFleetConfig,
  type SplitFleetData,
  type SplitRound,
} from '@/lib/split-fleets';
import { ilca2026Config, openingSeriesMedalConfig } from './fixtures/split-fleet-configs';
import type { Competitor, Finish, Fleet, Race, RaceStart } from '@/lib/types';

/** What the 2026 ILCA 6 Women's Worlds notice board wrote. */

function competitor(id: string, fleetIds: string[], sail: number): Competitor {
  return {
    id,
    seriesId: 's1',
    fleetIds,
    sailNumber: `IRL ${sail}`,
    names: [`Helm ${id}`],
    clubs: [],
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

  it('scores no excluded competitor, and does not count her in the base', () => {
    // A boat on the list but never entered. Adding her to Yellow would make it
    // the largest fleet at 4 and push every replacement score to 5.
    const data = qualifyingData();
    data.competitors.push({ ...competitor('c6', ['fy'], 6), excluded: true });
    const rows = splitFleetStandings(data);
    expect(rows.map((r) => r.competitor.id)).not.toContain('c6');
    const net = Object.fromEntries(rows.map((r) => [r.competitor.id, r.net]));
    expect(net).toEqual({ c1: 1, c2: 2, c3: 4, c4: 1, c5: 4 });
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

  it('lets at most one discard fall on the final series', () => {
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

  describe('per-race scoring options', () => {
    // One qualifying fleet of three, split into Gold (c1, c2) and Silver (c3).
    function splitData(opts: {
      qualifying: number;
      finalRace?: Partial<Race>;
      finals?: number;
      thresholds?: SplitFleetConfig['discardThresholds'];
    }): SplitFleetData {
      const competitors = [
        competitor('c1', ['fq', 'fg'], 1),
        competitor('c2', ['fq', 'fg'], 2),
        competitor('c3', ['fq', 'fs'], 3),
      ];
      const rounds: SplitRound[] = [
        {
          id: 'r1', seriesId: 's1', stage: 'qualifying', fromStageRace: 1,
          fleetIds: ['fq'], method: 'seeded', basis: null, createdAt: 0,
        },
        {
          id: 'r2', seriesId: 's1', stage: 'final', fromStageRace: 1,
          fleetIds: ['fg', 'fs'], method: 'split', basis: null, createdAt: 1,
        },
      ];
      const races: Race[] = [];
      const raceStarts: RaceStart[] = [];
      const finishes: Finish[] = [];
      for (let n = 1; n <= opts.qualifying; n++) {
        races.push(race(`q${n}`));
        raceStarts.push(start(`q${n}`, ['fq'], 'qualifying', n));
        // c1 1st, c2 2nd, c3 3rd — except c2 last in Q1.
        const order = n === 1 ? ['c1', 'c3', 'c2'] : ['c1', 'c2', 'c3'];
        order.forEach((id, i) => finishes.push(finish(`q${n}`, id, i)));
      }
      for (let n = 1; n <= (opts.finals ?? 1); n++) {
        races.push({ ...race(`f${n}g`), ...opts.finalRace });
        races.push({ ...race(`f${n}s`), ...opts.finalRace });
        raceStarts.push(start(`f${n}g`, ['fg'], 'final', n));
        raceStarts.push(start(`f${n}s`, ['fs'], 'final', n));
        finishes.push(finish(`f${n}g`, 'c2', 0), finish(`f${n}g`, 'c1', 1));
        finishes.push(finish(`f${n}s`, 'c3', 0));
      }
      return {
        config: {
          ...defaultSplitFleetConfig(1),
          finalFleets: [
            { label: 'Gold', color: '#d4a017' },
            { label: 'Silver', color: '#c0c0c0' },
          ],
          split: { kind: 'equal-blocks' },
          discardThresholds: opts.thresholds ?? [],
        },
        rounds,
        fleets: [fleet('fq', 'Fleet'), fleet('fg', 'Gold'), fleet('fs', 'Silver')],
        competitors,
        races,
        raceStarts,
        finishes,
      };
    }
    const row = (rows: ReturnType<typeof splitFleetStandings>, id: string) =>
      rows.find((r) => r.competitor.id === id)!;

    it('weights a race by its points multiplier', () => {
      const rows = splitFleetStandings(splitData({ qualifying: 1, finalRace: { pointsMultiplier: 2 } }));
      const f1 = (id: string) => row(rows, id).cells.find((c) => c.stage === 'final')!;
      expect(f1('c2').points).toBe(2);
      expect(f1('c1').points).toBe(4);
      expect(f1('c1').raceWeight).toBe(2);
      expect(row(rows, 'c1').net).toBe(1 + 4);
      expect(row(rows, 'c1').cells.find((c) => c.stage === 'qualifying')!.raceWeight).toBeUndefined();
    });

    it('weights a code score and a penalty with the race', () => {
      const data = splitData({ qualifying: 1, finalRace: { pointsMultiplier: 2 } });
      // c1 DNF in Gold's F1: own fleet (2) + 1 = 3, doubled. c2 takes 1st
      // with a 2-point DPI: 1 + 2, doubled.
      data.finishes = data.finishes.filter((f) => f.raceId !== 'f1g');
      const dpi = { ...finish('f1g', 'c2', 0), penaltyCode: 'DPI' as const, penaltyOverride: 2 };
      data.finishes.push(dpi, finish('f1g', 'c1', null, 'DNF'));
      const rows = splitFleetStandings(data);
      const f1 = (id: string) => row(rows, id).cells.find((c) => c.stage === 'final')!;
      expect(f1('c1').points).toBe(6);
      expect(f1('c2').points).toBe(6);
    });

    it('averages redress over the other races unweighted, then weights it', () => {
      const data = splitData({ qualifying: 2, finalRace: { pointsMultiplier: 2 } });
      // c1 scored 1 and 1 in qualifying; redress in F1 averages those to 1,
      // and the doubled race makes it 2.
      data.finishes = data.finishes.filter((f) => !(f.raceId === 'f1g' && f.competitorId === 'c1'));
      data.finishes.push({ ...finish('f1g', 'c1', null, 'RDG'), redressMethod: 'all_races' });
      const rows = splitFleetStandings(data);
      expect(row(rows, 'c1').cells.find((c) => c.stage === 'final')!.points).toBe(2);
    });

    const LADDER = [
      { minRaces: 5, discardCount: 1 },
      { minRaces: 10, discardCount: 2 },
    ];

    it('never discards a must-count race, nor counts it toward the ladder', () => {
      // Eight qualifying races and two final races make ten, which would
      // unlock a second discard; must-count final races are not among the
      // races the ladder counts, so one discard it stays.
      const rows = splitFleetStandings(
        splitData({ qualifying: 8, finals: 2, finalRace: { discardPolicy: 'mustCount' }, thresholds: LADDER }),
      );
      const c1 = row(rows, 'c1');
      expect(c1.cells.filter((c) => c.discarded)).toHaveLength(1);
      expect(c1.cells.filter((c) => c.stage === 'final').every((c) => !c.discarded && !c.discardable)).toBe(true);
      // c1: eight 1s, two 2s in Gold. Nothing to discard but a 1 or a 2 —
      // and the 2s are protected.
      expect(c1.net).toBe(7 + 4);
    });

    it('counts ordinary final races toward the ladder, as before', () => {
      const rows = splitFleetStandings(splitData({ qualifying: 8, finals: 2, thresholds: LADDER }));
      expect(row(rows, 'c1').cells.filter((c) => c.discarded)).toHaveLength(2);
    });

    it('discards a discard-first race before any other', () => {
      const data = splitData({ qualifying: 5, thresholds: LADDER });
      // c2 was last in Q1 (3 points) and 2nd elsewhere; Q2 marked discard-first.
      data.races = data.races.map((r) => (r.id === 'q2' ? { ...r, discardPolicy: 'discardFirst' } : r));
      const rows = splitFleetStandings(data);
      const discarded = row(rows, 'c2').cells.filter((c) => c.discarded);
      expect(discarded.map((c) => c.stageRaceNumber)).toEqual([2]);
    });
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
    expect(stageRaceLabel(config, 'qualifying', 3)).toBe('Q3');
    expect(stageRaceLabel(config, 'final', 1)).toBe('F1');
    expect(stageRaceLabel(config, 'medal', 1)).toBe('M1');
  });

  it('labels the 2026 ILCA stages QP, QE and F, as their notice boards did', () => {
    const config = ilca2026Config(3);
    expect(stageRaceLabel(config, 'qualifying', 5)).toBe('QP5');
    expect(stageRaceLabel(config, 'final', 1)).toBe('QE1');
    expect(stageRaceLabel(config, 'medal', 1)).toBe('F1');
  });

  it('labels an undivided opening series Q under either wording', () => {
    const undivided = openingSeriesMedalConfig();
    expect(stageRaceLabel(undivided, 'qualifying', 3)).toBe('Q3');
    expect(stageRaceLabel({ ...undivided, vocabulary: 'qualification-final' }, 'qualifying', 3)).toBe(
      'Q3',
    );
    expect(stageRaceLabel({ ...undivided, vocabulary: 'qualification-final' }, 'medal', 1)).toBe('F1');
  });

  it('labels the carried score rather than numbering it', () => {
    expect(stageRaceLabel(defaultSplitFleetConfig(2), 'medal', 0)).toBe('Carried');
  });

});

describe('vocabulary', () => {
  it('gives the generic wording by default and ILCA’s under its preset', () => {
    expect(resolveVocabulary(defaultSplitFleetConfig(3)).stages).toMatchObject({
      qualifying: { name: 'qualifying series' },
      final: { name: 'final series' },
      medal: { name: 'medal races' },
    });
    const ilca = resolveVocabulary(ilca2026Config(3));
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
    const ilca = resolveVocabulary(ilca2026Config(2));
    expect(generic.stages.final.name.toLowerCase()).toBe('final series');
    expect(ilca.stages.medal.name.toLowerCase()).toBe('final series');
    expect(ilca.stages.final.name.toLowerCase()).not.toBe('final series');
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
    });

    it('falls back to the generic wording when there is nothing to read', () => {
      const config = normalizeSplitFleetConfig({});
      expect(config.vocabulary).toBe('opening-medal');
      expect(resolveVocabulary(config).stages.medal.name).toBe('medal races');
    });
  });
});


describe('one race per fleet scores the same as one combined sheet', () => {
  /**
   * The finish-sheet layout decides whether a stage race's fleets
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

describe('a halved carry waits for a medal race', () => {
  /** A medal fleet selected on a halved carry, and no medal race sailed:
   *  y1 nets 7 and b1 nets 8, which halve to 4 apiece. Both medal boats hold
   *  DNF in every final race. */
  function heldDivisionData(): SplitFleetData {
    const config: SplitFleetConfig = {
      ...defaultSplitFleetConfig(2),
      medal: {
        size: 2,
        multiplier: 1,
        carryTransform: { kind: 'divide', by: 2, rounding: 'half-up' },
        tieBreak: 'last-race',
      },
    };
    const competitors = [
      competitor('y1', ['fy', 'fg', 'fm'], 1), competitor('y2', ['fy', 'fg'], 2),
      competitor('b1', ['fb', 'fg', 'fm'], 3), competitor('b2', ['fb'], 4),
    ];
    const qRound: SplitRound = {
      id: 'r1', seriesId: 's1', stage: 'qualifying', fromStageRace: 1,
      fleetIds: ['fy', 'fb'], method: 'seeded', basis: null, createdAt: 0,
    };
    const fRound: SplitRound = {
      id: 'r2', seriesId: 's1', stage: 'final', fromStageRace: 1,
      fleetIds: ['fg'], method: 'split', basis: null, createdAt: 1,
    };
    const mRound: SplitRound = {
      id: 'r3', seriesId: 's1', stage: 'medal', fromStageRace: 1,
      fleetIds: ['fm'], method: 'seeded', basis: null, createdAt: 2,
    };
    const q3Blue = [finish('q3', 'b2', 1), finish('q3', 'b1', 2)];
    return {
      config,
      rounds: [qRound, fRound, mRound],
      fleets: [
        fleet('fy', 'Yellow'), fleet('fb', 'Blue'),
        fleet('fg', 'Gold'), fleet('fm', 'Medal'),
      ],
      competitors,
      races: [race('q1'), race('q2'), race('q3'), race('f1'), race('f2')],
      raceStarts: [
        start('q1', ['fy', 'fb'], 'qualifying', 1),
        start('q2', ['fy', 'fb'], 'qualifying', 2),
        start('q3', ['fy', 'fb'], 'qualifying', 3),
        start('f1', ['fg'], 'final', 1),
        start('f2', ['fg'], 'final', 2),
      ],
      finishes: [
        finish('q1', 'y1', 0), finish('q1', 'b1', 1), finish('q1', 'y2', 2), finish('q1', 'b2', 3),
        finish('q2', 'y1', 0), finish('q2', 'b1', 1), finish('q2', 'y2', 2), finish('q2', 'b2', 3),
        finish('q3', 'y1', 0), finish('q3', 'y2', 3), ...q3Blue,
        // The medal boats hold DNF in both final races: identical score
        // lists the final-series ranking cannot separate.
        finish('f1', 'y2', 0), finish('f1', 'y1', null, 'DNF'), finish('f1', 'b1', null, 'DNF'),
        finish('f2', 'y2', 0), finish('f2', 'y1', null, 'DNF'), finish('f2', 'b1', null, 'DNF'),
      ],
    };
  }

  it('holding the division until a medal race sails leaves the opening scores undivided', () => {
    // 2026 ILCA SI 18.7.5 as Amendment 5 wrote it: the medal fleet is
    // selected, no medal race is completed, and the boats are ranked on what
    // they actually scored — y1's 7 and b1's 8 — rather than on the 4 each
    // that halving them produces. The
    // carried cell is still synthesised, so the boats can see the scores the
    // medal races will add to, but it does not count: their race scores
    // still drive the ranking.
    const rows = splitFleetStandings(heldDivisionData());
    const medal = rows.filter((r) => r.medal);
    expect(Object.fromEntries(medal.map((r) => [r.competitor.id, r.net]))).toEqual({
      y1: 7,
      b1: 8,
    });
    for (const r of medal) {
      const carried = r.cells.filter((c) => c.carriedTransform);
      expect(carried).toHaveLength(1);
      expect(carried[0].counts).toBe(false);
      expect(carried[0].points).toBe(4);
    }
    expect(medal.some((r) => r.cells.some((c) => c.superseded))).toBe(false);
    expect(Object.fromEntries(rows.map((r) => [r.competitor.id, r.rank]))).toEqual({
      y1: 1, b1: 2, y2: 3, b2: 4,
    });
  });

});

describe('the medal tie-break waits for a medal-stage score', () => {
  /** Medal fleet selected, the carry held until a medal race sails, and no
   *  medal race sailed: the ranking on display is the opening series' own,
   *  so a tie between two medal boats belongs to RRS A8, not to the SI
   *  tie-break that governs the medal-stage score.
   *
   *  y1 and b1 both net 5 over four qualifying races (one discard). A8.1
   *  ranks y1 ahead ([1,1,3] against [1,2,2]); the last race ranks b1 ahead
   *  (1 against 3). The two orderings disagree, so the test can tell which
   *  rule was applied. */
  function heldCarryData(): SplitFleetData {
    const config: SplitFleetConfig = {
      ...defaultSplitFleetConfig(2),
      medal: {
        size: 2,
        multiplier: 1,
        carryTransform: {
          kind: 'divide',
          by: 2,
          rounding: 'half-up',
        },
        tieBreak: 'last-race',
      },
    };
    const competitors = [
      competitor('y1', ['fy', 'fg', 'fm'], 1), competitor('y2', ['fy', 'fg'], 2),
      competitor('b1', ['fb', 'fg', 'fm'], 3), competitor('b2', ['fb'], 4),
    ];
    const rounds: SplitRound[] = [
      {
        id: 'r1', seriesId: 's1', stage: 'qualifying', fromStageRace: 1,
        fleetIds: ['fy', 'fb'], method: 'seeded', basis: null, createdAt: 0,
      },
      {
        id: 'r2', seriesId: 's1', stage: 'final', fromStageRace: 1,
        fleetIds: ['fg'], method: 'split', basis: null, createdAt: 1,
      },
      {
        id: 'r3', seriesId: 's1', stage: 'medal', fromStageRace: 1,
        fleetIds: ['fm'], method: 'medal-select', basis: null, createdAt: 2,
      },
    ];
    return {
      config,
      rounds,
      fleets: [
        fleet('fy', 'Yellow'), fleet('fb', 'Blue'),
        fleet('fg', 'Gold'), fleet('fm', 'Medal'),
      ],
      competitors,
      races: [race('q1'), race('q2'), race('q3'), race('q4'), race('m1')],
      raceStarts: [
        start('q1', ['fy', 'fb'], 'qualifying', 1),
        start('q2', ['fy', 'fb'], 'qualifying', 2),
        start('q3', ['fy', 'fb'], 'qualifying', 3),
        start('q4', ['fy', 'fb'], 'qualifying', 4),
        // The medal race exists from the ceremony; nobody has sailed it.
        start('m1', ['fm'], 'medal', 1),
      ],
      finishes: [
        // y1: 1, 1, DNF, DNF (net 5, discarding one DNF).
        // b1: 2, 2, 2, 1 (net 5, discarding one 2).
        finish('q1', 'y1', 0), finish('q1', 'b2', 1), finish('q1', 'b1', 2), finish('q1', 'y2', 3),
        finish('q2', 'y1', 0), finish('q2', 'b2', 1), finish('q2', 'b1', 2), finish('q2', 'y2', 3),
        finish('q3', 'b2', 0), finish('q3', 'b1', 1), finish('q3', 'y2', 2), finish('q3', 'y1', null, 'DNF'),
        finish('q4', 'b1', 0), finish('q4', 'b2', 1), finish('q4', 'y2', 2), finish('q4', 'y1', null, 'DNF'),
      ],
    };
  }

  it('breaks an opening-series tie by A8, not by the last race', () => {
    const rows = splitFleetStandings(heldCarryData());
    const medal = rows.filter((r) => r.medal);
    expect(medal.map((r) => r.net)).toEqual([5, 5]);
    expect(medal.map((r) => r.competitor.id)).toEqual(['y1', 'b1']);
    expect(medal.map((r) => r.rank)).toEqual([1, 2]);
  });

  it('the last race takes over once a medal race is completed', () => {
    // Both medal boats coded alike in the sailed medal race: their carried
    // scores tie at 3, the medal race cannot separate them, and under
    // `last-race` A8 is replaced, not appended — the tie stands.
    const data = heldCarryData();
    data.finishes.push(
      finish('m1', 'y1', null, 'DNF'),
      finish('m1', 'b1', null, 'DNF'),
    );
    const rows = splitFleetStandings(data);
    const medal = rows.filter((r) => r.medal);
    expect(medal.map((r) => r.rank)).toEqual([1, 1]);
  });
});

/**
 * The medal race's weighting and what it does to the scores that aren't
 * places (#586). A medal-race instruction doubles "the number of points
 * specified in RRS Appendix A4", and A4 is a table of finishing place to
 * points — so a boat scored under A5.2, which assigns her a finishing place
 * of entries + 1, is doubled with everyone else.
 */
describe('a weighted medal race', () => {
  /** Two qualifying fleets of two, both boats of Blue selected for a medal
   *  fleet of 2 — so the medal race's code base is 2 + 1 = 3, and 6 doubled.
   *  `medalSheet` is the medal race's own sheet. */
  function weightedMedalData(medalSheet: Finish[]): SplitFleetData {
    const config: SplitFleetConfig = {
      ...defaultSplitFleetConfig(2),
      discardThresholds: [],
      medal: { size: 2, multiplier: 2, tieBreak: 'medal-race-then-a8' },
    };
    return {
      config,
      rounds: [
        { id: 'r1', seriesId: 's1', stage: 'qualifying', fromStageRace: 1,
          fleetIds: ['fy', 'fb'], method: 'seeded', basis: null, createdAt: 0 },
        { id: 'r2', seriesId: 's1', stage: 'medal', fromStageRace: 1,
          fleetIds: ['fm'], method: 'medal-select', basis: null, createdAt: 1 },
      ],
      fleets: [fleet('fy', 'Yellow'), fleet('fb', 'Blue'), fleet('fm', 'Medal')],
      competitors: [
        competitor('y1', ['fy'], 1), competitor('y2', ['fy'], 2),
        competitor('b1', ['fb', 'fm'], 3), competitor('b2', ['fb', 'fm'], 4),
      ],
      races: [race('q1'), race('m1')],
      raceStarts: [
        start('q1', ['fy', 'fb'], 'qualifying', 1),
        start('m1', ['fm'], 'medal', 1),
      ],
      finishes: [
        finish('q1', 'y1', 0), finish('q1', 'b1', 1),
        finish('q1', 'y2', 2), finish('q1', 'b2', 3),
        ...medalSheet,
      ],
    };
  }

  function medalCell(rows: ReturnType<typeof splitFleetStandings>, id: string) {
    return rows
      .find((r) => r.competitor.id === id)!
      .cells.find((c) => c.stage === 'medal')!;
  }

  it('doubles a code score, not just the places', () => {
    const rows = splitFleetStandings(
      weightedMedalData([finish('m1', 'b1', 0), finish('m1', 'b2', null, 'BFD')]),
    );
    expect(medalCell(rows, 'b1').points).toBe(2);     // 1st, doubled
    expect(medalCell(rows, 'b2').points).toBe(6);     // base 3, doubled
  });

  it('doubles an implicit DNC the same way', () => {
    // b2 has no row on the medal sheet at all.
    const rows = splitFleetStandings(weightedMedalData([finish('m1', 'b1', 0)]));
    expect(medalCell(rows, 'b2')).toMatchObject({ code: 'DNC', points: 6 });
  });

  it('measures a percentage penalty against the doubled DNF score', () => {
    // b2 finishes 2nd (4 points) with a 50% scoring penalty. RRS 44.3(c)
    // takes the percentage of this race's score for DNF, which is the
    // doubled 6, so 4 + 3 = 7 — worse than DNF, and the cap holds her at 6.
    const penalised: Finish = {
      ...finish('m1', 'b2', 1),
      penaltyCode: 'SCP',
      penaltyOverride: 50,
    };
    const rows = splitFleetStandings(
      weightedMedalData([finish('m1', 'b1', 0), penalised]),
    );
    expect(medalCell(rows, 'b2').points).toBe(6);
  });

  it('leaves an unweighted stage alone', () => {
    const rows = splitFleetStandings(
      weightedMedalData([finish('m1', 'b1', 0), finish('m1', 'b2', null, 'BFD')]),
    );
    // Yellow sailed only the qualifying race: places 1 and 3 on the combined
    // sheet rank 1 and 2 within the fleet, undoubled.
    const q = (id: string) =>
      rows.find((r) => r.competitor.id === id)!.cells.find((c) => c.stage === 'qualifying')!.points;
    expect([q('y1'), q('y2')]).toEqual([1, 2]);
  });
});

/**
 * The medal-race tie-break that runs *before* rule A8 and leaves A8 whatever
 * it does not address (#588) — "Ties in the series score between boats with
 * different Medal Race point scores shall be broken in favour of the boat
 * with the lower score in the medal race. This changes RRS Appendix A8"
 * (Irish Sailing Junior Champions' Cup NoR 15.3).
 */
describe('the medal-race-then-A8 tie-break', () => {
  /** Two medal boats level on the series score. `medalSheet` decides whether
   *  the medal race can separate them; the opening races are arranged so that
   *  rule A8 has its own, different, opinion. */
  function tiedMedalData(
    tieBreak: SplitFleetConfig['medal']['tieBreak'],
    opening: 'a8-prefers-b1' | 'a8-decides-alone',
    medalSheet: Finish[],
  ): SplitFleetData {
    const config: SplitFleetConfig = {
      ...defaultSplitFleetConfig(2),
      discardThresholds: [],
      medal: {
        size: 2,
        multiplier: 2,
        tieBreak,
      },
    };
    // a8-prefers-b1: y1 1,2,2 = 5 and b1 1,1,1 = 3, so the medal race's 2
    // and 4 level them at 7 — and A8.1 reads b1's 1,1,1,4 as the better list.
    // a8-decides-alone: both open on 5, so a shared medal score leaves the
    // whole tie to A8, which separates them by counting back to Q3.
    const blue = opening === 'a8-prefers-b1'
      ? [['b1', 'b2'], ['b1', 'b2'], ['b1', 'b2']]
      : [['b2', 'b1'], ['b2', 'b1'], ['b1', 'b2']];
    const yellow = [['y1', 'y2'], ['y2', 'y1'], ['y2', 'y1']];
    return {
      config,
      rounds: [
        { id: 'r1', seriesId: 's1', stage: 'qualifying', fromStageRace: 1,
          fleetIds: ['fy', 'fb'], method: 'seeded', basis: null, createdAt: 0 },
        { id: 'r2', seriesId: 's1', stage: 'medal', fromStageRace: 1,
          fleetIds: ['fm'], method: 'medal-select', basis: null, createdAt: 1 },
      ],
      fleets: [fleet('fy', 'Yellow'), fleet('fb', 'Blue'), fleet('fm', 'Medal')],
      competitors: [
        competitor('y1', ['fy', 'fm'], 1), competitor('y2', ['fy'], 2),
        competitor('b1', ['fb', 'fm'], 3), competitor('b2', ['fb'], 4),
      ],
      races: [race('q1'), race('q2'), race('q3'), race('m1')],
      raceStarts: [
        start('q1', ['fy', 'fb'], 'qualifying', 1),
        start('q2', ['fy', 'fb'], 'qualifying', 2),
        start('q3', ['fy', 'fb'], 'qualifying', 3),
        start('m1', ['fm'], 'medal', 1),
      ],
      finishes: [
        ...['q1', 'q2', 'q3'].flatMap((r, i) => [
          ...yellow[i].map((id, place) => finish(r, id, place)),
          ...blue[i].map((id, place) => finish(r, id, place)),
        ]),
        ...medalSheet,
      ],
    };
  }

  /** y1 wins the medal race (2 points), b1 second (4). */
  const decisiveMedal = [finish('m1', 'y1', 0), finish('m1', 'b1', 1)];
  /** Both retire: 3 x 2 = 6 apiece, so the medal race decides nothing. */
  const sharedMedal = [finish('m1', 'y1', null, 'DNF'), finish('m1', 'b1', null, 'DNF')];

  function medalOrder(data: SplitFleetData) {
    const medal = splitFleetStandings(data).filter((r) => r.medal);
    return { ids: medal.map((r) => r.competitor.id), ranks: medal.map((r) => r.rank) };
  }

  it('breaks the tie on the medal race, where rule A8 would have preferred b1', () => {
    // Both on 7, and A8.1 prefers b1's 1,1,1,4 to y1's 1,2,2,2 — the
    // opposite of what the notice of race asks for.
    const data = tiedMedalData('medal-race-then-a8', 'a8-prefers-b1', decisiveMedal);
    expect(medalOrder(data)).toEqual({ ids: ['y1', 'b1'], ranks: [1, 2] });
  });

  it('falls back to A8 when the medal scores are level', () => {
    // The clause speaks only to boats "with different Medal Race point
    // scores", so a shared medal score leaves the tie where A8 found it —
    // here A8.2 counts back past the medal race to Q3 and separates them.
    const data = tiedMedalData('medal-race-then-a8', 'a8-decides-alone', sharedMedal);
    expect(medalOrder(data)).toEqual({ ids: ['b1', 'y1'], ranks: [1, 2] });
  });

  it('unlike last-race, which replaces A8 and leaves the tie standing', () => {
    const data = tiedMedalData('last-race', 'a8-decides-alone', sharedMedal);
    expect(medalOrder(data).ranks).toEqual([1, 1]);
  });
});

/**
 * The words a championship that never bands its fleet uses (#585). Both
 * tabulated vocabularies describe an opening series divided in two, so the
 * surviving stage has to be named for the whole thing — which is the name the
 * table already holds.
 */
describe('the unbanded vocabulary', () => {
  it('names the one stage after the series, in either vocabulary', () => {
    const generic = resolveVocabulary(openingSeriesMedalConfig());
    expect(generic.stages.qualifying).toEqual({
      name: 'opening series',
      raceNoun: 'opening series race',
      fleetNoun: 'opening fleet',
    });
    const ilca = resolveVocabulary({
      ...openingSeriesMedalConfig(),
      vocabulary: 'qualification-final',
    });
    expect(ilca.stages.qualifying.name).toBe('Qualification series');
  });

  it('leaves the deciding stage’s words alone', () => {
    // Only the stage that absorbed the other one moves; "medal races" names a
    // stage rather than counting them, and `raceNoun` is where the singular
    // already lives.
    const vocab = resolveVocabulary(openingSeriesMedalConfig());
    expect(vocab.stages.medal).toEqual(VOCABULARIES['opening-medal'].stages.medal);
  });

  it('leaves a banded championship untouched', () => {
    expect(resolveVocabulary(defaultSplitFleetConfig(3))).toEqual(
      VOCABULARIES['opening-medal'],
    );
  });
});

describe('finishSheetsInUse', () => {
  const rounds = [
    { stage: 'qualifying' as const, fleetIds: ['fy', 'fb'] },
    { stage: 'medal' as const, fleetIds: ['fm'] },
  ];

  it('is combined before any race exists', () => {
    expect(finishSheetsInUse({ rounds, races: [], raceStarts: [] })).toBe('combined');
  });

  it('reads the most recent race of a stage with more than one fleet', () => {
    const races = [
      { id: 'q1', raceNumber: 1 },
      { id: 'q2y', raceNumber: 2 },
      { id: 'q2b', raceNumber: 3 },
      { id: 'm1', raceNumber: 4 },
    ];
    const raceStarts = [
      { raceId: 'q1', fleetIds: ['fy'], stage: 'qualifying' as const },
      { raceId: 'q1', fleetIds: ['fb'], stage: 'qualifying' as const },
      { raceId: 'q2y', fleetIds: ['fy'], stage: 'qualifying' as const },
      { raceId: 'q2b', fleetIds: ['fb'], stage: 'qualifying' as const },
      // The medal race always stands alone, and says nothing about the rest.
      { raceId: 'm1', fleetIds: ['fm'], stage: 'medal' as const },
    ];
    expect(finishSheetsInUse({ rounds, races, raceStarts })).toBe('per-fleet');
    expect(finishSheetsInUse({ rounds, races: races.slice(0, 1), raceStarts })).toBe('combined');
  });

  it('learns nothing from a stage of one fleet', () => {
    expect(
      finishSheetsInUse({
        rounds: [{ stage: 'qualifying', fleetIds: ['f'] }],
        races: [{ id: 'q1', raceNumber: 1 }],
        raceStarts: [{ raceId: 'q1', fleetIds: ['f'], stage: 'qualifying' }],
      }),
    ).toBe('combined');
  });
});

describe('boatsOutsideCompanionRace', () => {
  const rounds = [
    { stage: 'qualifying' as const, fleetIds: ['f'] },
    { stage: 'medal' as const, fleetIds: ['m'] },
  ];
  const competitors = [
    { id: 'medal-boat', fleetIds: ['f', 'm'] },
    { id: 'rest', fleetIds: ['f'] },
  ];

  it('names the medal boats for a companion race', () => {
    const raceStarts = [{ stage: 'qualifying' as const, firstPlaceOffset: 10 }];
    expect([...boatsOutsideCompanionRace({ raceStarts, rounds, competitors })]).toEqual([
      'medal-boat',
    ]);
  });

  it('names nobody for an ordinary race, or before the medal fleet exists', () => {
    expect(
      boatsOutsideCompanionRace({ raceStarts: [{ stage: 'qualifying' }], rounds, competitors }).size,
    ).toBe(0);
    expect(
      boatsOutsideCompanionRace({
        raceStarts: [{ stage: 'qualifying', firstPlaceOffset: 10 }],
        rounds: rounds.slice(0, 1),
        competitors,
      }).size,
    ).toBe(0);
  });
});

describe('resizeFleets', () => {
  const palette = [
    { label: 'Yellow', color: '#y' },
    { label: 'Blue', color: '#b' },
    { label: 'Red', color: '#r' },
  ];

  it('replaces the lone neutral fleet rather than keeping it as the first of two', () => {
    expect(resizeFleets([UNBANDED_FLEET], 2, palette).map((f) => f.label)).toEqual([
      'Yellow',
      'Blue',
    ]);
  });

  it('keeps fleets the scorer named, and adds from the palette', () => {
    const named = [
      { label: 'Alpha', color: '#a' },
      { label: 'Bravo', color: '#b2' },
    ];
    expect(resizeFleets(named, 3, palette).map((f) => f.label)).toEqual(['Alpha', 'Bravo', 'Red']);
    expect(resizeFleets(named, 2, palette)).toEqual(named);
  });

  it('gives back the neutral fleet when going down to one', () => {
    expect(resizeFleets(palette.slice(0, 2), 1, palette)).toEqual([UNBANDED_FLEET]);
  });
});
