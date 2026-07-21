import { describe, expect, it } from 'vitest';
import {
  assignByRankPattern,
  defaultSplitFleetConfig,
  finalBlockSizes,
  provisionalCutIndexes,
  rankPatternFleetIndex,
  splitFleetStandings,
  type SplitFleetData,
  type SplitRound,
} from '@/lib/split-fleets';
import type { Competitor, Finish, Fleet, Race } from '@/lib/types';

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

function race(
  id: string,
  stage: 'qualifying' | 'final' | 'medal',
  stageRaceNumber: number,
): Race {
  return {
    id,
    seriesId: 's1',
    raceNumber: 1,
    name: null,
    date: '2026-08-24',
    createdAt: 0,
    stage,
    stageRaceNumber,
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
      races: [race('q1y', 'qualifying', 1), race('q1b', 'qualifying', 1), race('q2y', 'qualifying', 2)],
      raceFleetIds: { q1y: 'fy', q1b: 'fb', q2y: 'fy' },
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
    const mk = (id: string, stage: 'qualifying' | 'final', n: number) => race(id, stage, n);
    const data: SplitFleetData = {
      config: { ...config, discardThresholds: [{ minRaces: 4, discardCount: 2 }] },
      rounds: [qRound, fRound],
      fleets: [fleet('fy', 'Yellow'), fleet('fg', 'Gold')],
      competitors,
      races: [mk('q1', 'qualifying', 1), mk('q2', 'qualifying', 2), mk('f1', 'final', 1), mk('f2', 'final', 2)],
      raceFleetIds: { q1: 'fy', q2: 'fy', f1: 'fg', f2: 'fg' },
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
      races: [race('f1g', 'final', 1), race('f1s', 'final', 1), race('m1', 'medal', 1)],
      raceFleetIds: { f1g: 'fg', f1s: 'fs', m1: 'fm' },
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
