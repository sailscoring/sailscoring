import { describe, it, expect } from 'vitest';
import { calculateRaceScores, calculateStandings, calculateFleetStandings, getDiscardCount } from '@/lib/scoring';
import type { Competitor, Fleet, Race, Finish, DiscardThreshold, PenaltyCode } from '@/lib/types';

// Helpers to build test fixtures with minimal required fields
function makeCompetitor(id: string, seriesId = 's1', fleetId = 'f1'): Competitor {
  return { id, seriesId, fleetId, sailNumber: id, name: id, club: '', gender: '', age: null, createdAt: 0 };
}

function makeRace(id: string, raceNumber: number, seriesId = 's1'): Race {
  return { id, seriesId, raceNumber, date: '2025-01-01', createdAt: 0 };
}

function makeFinish(
  raceId: string,
  competitorId: string,
  finishPosition: number | null,
  resultCode: Finish['resultCode'] = null,
  penaltyCode: PenaltyCode | null = null,
  penaltyOverride: number | null = null,
): Finish {
  return { id: `${raceId}-${competitorId}`, raceId, competitorId, finishPosition, resultCode, startPresent: null, penaltyCode, penaltyOverride, redressMethod: null, redressExcludeRaces: null, redressIncludeRaces: null, redressIncludeAllLater: false, redressPoints: null };
}

// ─── calculateRaceScores ─────────────────────────────────────────────────────

describe('calculateRaceScores', () => {
  const competitors = ['A', 'B', 'C', 'D', 'E'].map(id => makeCompetitor(id));
  const n = competitors.length; // 5

  it('assigns points equal to finish position', () => {
    const finishes = [
      makeFinish('r1', 'A', 1),
      makeFinish('r1', 'B', 2),
      makeFinish('r1', 'C', 3),
      makeFinish('r1', 'D', 4),
      makeFinish('r1', 'E', 5),
    ];
    const scores = calculateRaceScores(finishes, competitors);
    expect(scores.get('A')?.points).toBe(1);
    expect(scores.get('B')?.points).toBe(2);
    expect(scores.get('E')?.points).toBe(5);
  });

  it('scores DNF as N+1', () => {
    const finishes = [
      makeFinish('r1', 'A', 1),
      makeFinish('r1', 'B', null, 'DNF'),
    ];
    const scores = calculateRaceScores(finishes, competitors);
    expect(scores.get('B')?.points).toBe(n + 1);
    expect(scores.get('B')?.resultCode).toBe('DNF');
    expect(scores.get('B')?.place).toBeNull();
  });

  it('scores OCS as N+1', () => {
    const finishes = [makeFinish('r1', 'C', null, 'OCS')];
    const scores = calculateRaceScores(finishes, competitors);
    expect(scores.get('C')?.points).toBe(n + 1);
    expect(scores.get('C')?.resultCode).toBe('OCS');
  });

  it('scores explicit DNC as N+1', () => {
    const finishes = [makeFinish('r1', 'D', null, 'DNC')];
    const scores = calculateRaceScores(finishes, competitors);
    expect(scores.get('D')?.points).toBe(n + 1);
  });

  it('treats missing finish record as implicit DNC (N+1)', () => {
    const finishes: Finish[] = []; // nobody finished
    const scores = calculateRaceScores(finishes, competitors);
    for (const c of competitors) {
      expect(scores.get(c.id)?.points).toBe(n + 1);
      expect(scores.get(c.id)?.resultCode).toBe('DNC');
    }
  });

  it('handles a race with only one competitor', () => {
    const solo = [makeCompetitor('X')];
    const finishes = [makeFinish('r1', 'X', 1)];
    const scores = calculateRaceScores(finishes, solo);
    expect(scores.get('X')?.points).toBe(1);
  });

  it('averages points for two boats tied at the same position (RRS A8.1)', () => {
    // B and C both at position 2 → each scores (2+3)/2 = 2.5; D at position 4 scores 4
    const finishes = [
      makeFinish('r1', 'A', 1),
      makeFinish('r1', 'B', 2),
      makeFinish('r1', 'C', 2),
      makeFinish('r1', 'D', 4),
      makeFinish('r1', 'E', 5),
    ];
    const scores = calculateRaceScores(finishes, competitors);
    expect(scores.get('A')?.points).toBe(1);
    expect(scores.get('B')?.points).toBe(2.5);
    expect(scores.get('C')?.points).toBe(2.5);
    expect(scores.get('D')?.points).toBe(4);
    expect(scores.get('E')?.points).toBe(5);
    // place is preserved as the raw finishPosition
    expect(scores.get('B')?.place).toBe(2);
    expect(scores.get('C')?.place).toBe(2);
  });

  it('scores DNS, NSC, RET, DSQ, UFD as N+1 (same as DNF)', () => {
    for (const code of ['DNS', 'NSC', 'RET', 'DSQ', 'UFD'] as const) {
      const finishes = [makeFinish('r1', 'A', null, code)];
      const scores = calculateRaceScores(finishes, competitors);
      expect(scores.get('A')?.points, `${code} should score N+1`).toBe(n + 1);
      expect(scores.get('A')?.resultCode).toBe(code);
    }
  });

  it('scores DNE as N+1 (same as DNF, but non-discardable — tracked separately)', () => {
    const finishes = [makeFinish('r1', 'A', null, 'DNE')];
    const scores = calculateRaceScores(finishes, competitors);
    expect(scores.get('A')?.points).toBe(n + 1);
    expect(scores.get('A')?.resultCode).toBe('DNE');
  });

  it('scores BFD as entries+1 (same as DNC, regardless of dnfScoring)', () => {
    // Under startingArea scoring, 'starters'-base codes score starters+1.
    // BFD uses 'entries' base so it always scores entries+1, same as DNC.
    const finishes = [
      makeFinish('r1', 'A', null, 'BFD'),
      // B–E present in start area
      makeFinish('r1', 'B', 1),
      makeFinish('r1', 'C', 2),
      makeFinish('r1', 'D', 3),
      makeFinish('r1', 'E', 4),
    ];
    const scores = calculateRaceScores(finishes, competitors, 'startingArea');
    // starters = 4 (B, C, D, E); startingAreaPenalty = 5
    // BFD uses 'entries': entries+1 = 6
    expect(scores.get('A')?.points).toBe(n + 1); // 6
    expect(scores.get('B')?.points).toBe(1);
  });

  it('averages points for a three-way tie', () => {
    // A, B, C all at position 1 → each scores (1+2+3)/3 = 2; D at position 4 scores 4
    const finishes = [
      makeFinish('r1', 'A', 1),
      makeFinish('r1', 'B', 1),
      makeFinish('r1', 'C', 1),
      makeFinish('r1', 'D', 4),
      makeFinish('r1', 'E', 5),
    ];
    const scores = calculateRaceScores(finishes, competitors);
    expect(scores.get('A')?.points).toBe(2);
    expect(scores.get('B')?.points).toBe(2);
    expect(scores.get('C')?.points).toBe(2);
    expect(scores.get('D')?.points).toBe(4);
  });
});

// ─── calculateStandings ──────────────────────────────────────────────────────

describe('calculateStandings', () => {
  const competitors = ['A', 'B', 'C'].map(id => makeCompetitor(id));
  const races = [makeRace('r1', 1), makeRace('r2', 2)];

  it('ranks by total points ascending', () => {
    const finishes: Finish[] = [
      // Race 1: A=1, B=2, C=3
      makeFinish('r1', 'A', 1),
      makeFinish('r1', 'B', 2),
      makeFinish('r1', 'C', 3),
      // Race 2: A=2, B=1, C=3
      makeFinish('r2', 'A', 2),
      makeFinish('r2', 'B', 1),
      makeFinish('r2', 'C', 3),
    ];
    const { standings } = calculateStandings(competitors, races, finishes);
    // A: 1+2=3, B: 2+1=3, C: 3+3=6
    expect(standings[2].competitor.id).toBe('C');
    expect(standings[2].totalPoints).toBe(6);
    // A and B tied at 3 — tie-break below
  });

  it('uses most first places to break ties (RRS A8.2)', () => {
    const finishes: Finish[] = [
      // Race 1: A=1, B=2, C=3
      makeFinish('r1', 'A', 1),
      makeFinish('r1', 'B', 2),
      makeFinish('r1', 'C', 3),
      // Race 2: B=1, A=2, C=3
      makeFinish('r2', 'B', 1),
      makeFinish('r2', 'A', 2),
      makeFinish('r2', 'C', 3),
    ];
    // A: 1+2=3 (one first place), B: 2+1=3 (one first place) — equal on firsts
    // Move to second places: A has one 2nd, B has one 2nd — still equal
    // Last resort: most recent race — A got 2, B got 1 → B wins tie
    const { standings } = calculateStandings(competitors, races, finishes);
    expect(standings[0].competitor.id).toBe('B');
    expect(standings[1].competitor.id).toBe('A');
  });

  it('tie-break: more first places wins', () => {
    const threeRaces = [makeRace('r1', 1), makeRace('r2', 2), makeRace('r3', 3)];
    const abc = ['A', 'B'].map(id => makeCompetitor(id));
    const finishes: Finish[] = [
      // Race 1: A=1, B=2
      makeFinish('r1', 'A', 1), makeFinish('r1', 'B', 2),
      // Race 2: B=1, A=2
      makeFinish('r2', 'B', 1), makeFinish('r2', 'A', 2),
      // Race 3: A=1, B=2  → A has 2 firsts, B has 1 first
      makeFinish('r3', 'A', 1), makeFinish('r3', 'B', 2),
    ];
    // A: 1+2+1=4, B: 2+1+2=5  — not tied, but let's verify rank
    const { standings } = calculateStandings(abc, threeRaces, finishes);
    expect(standings[0].competitor.id).toBe('A');
  });

  it('counts DNC/DNF from missing finishes correctly in standings', () => {
    const [a, b] = competitors;
    const oneRace = [makeRace('r1', 1)];
    const finishes: Finish[] = [
      makeFinish('r1', 'A', 1),
      // B has no finish record → implicit DNC → N+1 = 3+1 = 4
    ];
    const { standings } = calculateStandings(competitors, oneRace, finishes);
    const aStanding = standings.find((s) => s.competitor.id === 'A')!;
    const bStanding = standings.find((s) => s.competitor.id === 'B')!;
    expect(aStanding.racePoints[0]).toBe(1);
    expect(bStanding.racePoints[0]).toBe(4); // 3 competitors, so N+1=4
    expect(aStanding.rank).toBe(1);
  });

  it('returns empty standings for no races', () => {
    const { standings } = calculateStandings(competitors, [], []);
    expect(standings).toHaveLength(3);
    expect(standings.every((s) => s.racePoints.length === 0)).toBe(true);
  });

  it('returns empty standings for no competitors', () => {
    const { standings } = calculateStandings([], races, []);
    expect(standings).toHaveLength(0);
  });

  it('assigns correct shared rank for tied competitors', () => {
    // Two competitors with equal scores should share rank 1
    const [a, b] = ['A', 'B'].map(id => makeCompetitor(id));
    // Make them perfectly tied: A=1,B=2 then A=2,B=1 → 3 each, last race equally good (B=1 → B beats A)
    // To get a true tie on tiebreak, give them mirror images
    const tiedFinishes: Finish[] = [
      makeFinish('r1', 'A', 1), makeFinish('r1', 'B', 2),
      makeFinish('r2', 'A', 2), makeFinish('r2', 'B', 1),
    ];
    const { standings } = calculateStandings([a, b], races, tiedFinishes);
    // A: 1+2=3, B: 2+1=3; tie-break: each has one 1st → still tied; last race: A=2, B=1 → B wins
    expect(standings[0].competitor.id).toBe('B');
    expect(standings[0].rank).toBe(1);
    expect(standings[1].rank).toBe(2);
  });

  it('populates netPoints and raceDiscards with no discards configured', () => {
    const [a] = competitors;
    const oneRace = [makeRace('r1', 1)];
    const finishes = [makeFinish('r1', 'A', 1)];
    const { standings } = calculateStandings([a], oneRace, finishes);
    expect(standings[0].netPoints).toBe(standings[0].totalPoints);
    expect(standings[0].raceDiscards).toEqual([false]);
    expect(standings[0].raceNonDiscardable).toEqual([false]);
  });

  it('marks DNE and BFD races as non-discardable', () => {
    const [a, b, c] = competitors;
    const threeRaces = [makeRace('r1', 1), makeRace('r2', 2), makeRace('r3', 3)];
    const finishes: Finish[] = [
      makeFinish('r1', 'A', 1), makeFinish('r1', 'B', 2), makeFinish('r1', 'C', 3),
      makeFinish('r2', 'A', null, 'DNE'), makeFinish('r2', 'B', 1), makeFinish('r2', 'C', 2),
      makeFinish('r3', 'A', null, 'BFD'), makeFinish('r3', 'B', 1), makeFinish('r3', 'C', 2),
    ];
    const { standings } = calculateStandings(competitors, threeRaces, finishes);
    const aStanding = standings.find((s) => s.competitor.id === 'A')!;
    expect(aStanding.raceNonDiscardable).toEqual([false, true, true]);
    const bStanding = standings.find((s) => s.competitor.id === 'B')!;
    expect(bStanding.raceNonDiscardable).toEqual([false, false, false]);
  });

  it('does not discard non-discardable DNE even when it is the worst score', () => {
    // A: R1=1, R2=DNE(4), R3=1. With 1 discard, DNE should NOT be discarded.
    // Worst discardable for A is 1 (R1 or R3).
    const [a, b, c] = competitors;
    const threeRaces = [makeRace('r1', 1), makeRace('r2', 2), makeRace('r3', 3)];
    const finishes: Finish[] = [
      makeFinish('r1', 'A', 1), makeFinish('r1', 'B', 2), makeFinish('r1', 'C', 3),
      makeFinish('r2', 'A', null, 'DNE'), makeFinish('r2', 'B', 1), makeFinish('r2', 'C', 2),
      makeFinish('r3', 'A', 1), makeFinish('r3', 'B', 2), makeFinish('r3', 'C', 3),
    ];
    const thresholds: DiscardThreshold[] = [{ minRaces: 3, discardCount: 1 }];
    const { standings } = calculateStandings(competitors, threeRaces, finishes, thresholds);
    const aStanding = standings.find((s) => s.competitor.id === 'A')!;
    // DNE (R2) must not be discarded; R1 (=1pt) is discarded instead
    expect(aStanding.raceDiscards).toEqual([true, false, false]);
    expect(aStanding.raceNonDiscardable).toEqual([false, true, false]);
    // Net = DNE(4) + R3(1) = 5
    expect(aStanding.netPoints).toBe(5);
  });
});

// ─── getDiscardCount ─────────────────────────────────────────────────────────

describe('getDiscardCount', () => {
  it('returns 0 for empty thresholds', () => {
    expect(getDiscardCount(0, [])).toBe(0);
    expect(getDiscardCount(10, [])).toBe(0);
  });

  it('returns 0 when below the single threshold', () => {
    const t: DiscardThreshold[] = [{ minRaces: 4, discardCount: 1 }];
    expect(getDiscardCount(3, t)).toBe(0);
  });

  it('returns discardCount when at or above the single threshold', () => {
    const t: DiscardThreshold[] = [{ minRaces: 4, discardCount: 1 }];
    expect(getDiscardCount(4, t)).toBe(1);
    expect(getDiscardCount(10, t)).toBe(1);
  });

  it('picks the highest matching threshold with two thresholds', () => {
    const t: DiscardThreshold[] = [
      { minRaces: 4, discardCount: 1 },
      { minRaces: 8, discardCount: 2 },
    ];
    expect(getDiscardCount(3, t)).toBe(0);
    expect(getDiscardCount(5, t)).toBe(1);
    expect(getDiscardCount(8, t)).toBe(2);
    expect(getDiscardCount(12, t)).toBe(2);
  });

  it('handles thresholds provided in non-sorted order', () => {
    const t: DiscardThreshold[] = [
      { minRaces: 8, discardCount: 2 },
      { minRaces: 4, discardCount: 1 },
    ];
    expect(getDiscardCount(6, t)).toBe(1);
    expect(getDiscardCount(9, t)).toBe(2);
  });
});

// ─── calculateStandings with discards ────────────────────────────────────────

describe('calculateStandings with discards', () => {
  it('discard changes ranking: 2 wins + 1 penalty beats 3 consistent middles', () => {
    // Use 5 competitors so that the DNC penalty (N+1=6) is significant
    const five = ['A', 'B', 'C', 'D', 'E'].map(id => makeCompetitor(id));
    const threeRaces = [makeRace('r1', 1), makeRace('r2', 2), makeRace('r3', 3)];
    const finishes: Finish[] = [
      // Race 1: A=1, B=2, C=3, D=4, E=5
      makeFinish('r1', 'A', 1), makeFinish('r1', 'B', 2), makeFinish('r1', 'C', 3),
      makeFinish('r1', 'D', 4), makeFinish('r1', 'E', 5),
      // Race 2: A=1, B=2, C=3, D=4, E=5
      makeFinish('r2', 'A', 1), makeFinish('r2', 'B', 2), makeFinish('r2', 'C', 3),
      makeFinish('r2', 'D', 4), makeFinish('r2', 'E', 5),
      // Race 3: B=1, C=2, D=3, E=4; A has no finish → implicit DNC (N+1=6)
      makeFinish('r3', 'B', 1), makeFinish('r3', 'C', 2), makeFinish('r3', 'D', 3),
      makeFinish('r3', 'E', 4),
    ];
    // Without discards: A=1+1+6=8, B=2+2+1=5. B wins.
    const { standings: noDiscard } = calculateStandings(five, threeRaces, finishes);
    expect(noDiscard.find(s => s.competitor.id === 'B')!.rank).toBe(1);
    expect(noDiscard.find(s => s.competitor.id === 'A')!.totalPoints).toBe(8);

    // With 1 discard: A drops 6→net 2, B drops 2→net 3. A wins.
    const { standings: withDiscard } = calculateStandings(five, threeRaces, finishes, [{ minRaces: 3, discardCount: 1 }]);
    const aStanding = withDiscard.find(s => s.competitor.id === 'A')!;
    const bStanding = withDiscard.find(s => s.competitor.id === 'B')!;
    expect(aStanding.rank).toBe(1);
    expect(aStanding.netPoints).toBe(2);
    expect(aStanding.raceDiscards).toEqual([false, false, true]);
    expect(bStanding.rank).toBe(2);
    expect(bStanding.netPoints).toBe(3);
  });

  it('tied worst scores: earliest race index is discarded first', () => {
    // Need 4 competitors so A at position 4 genuinely scores 4 points (fleet rank 4).
    const abcd = ['A', 'B', 'C', 'D'].map(id => makeCompetitor(id));
    const fourRaces = [makeRace('r1', 1), makeRace('r2', 2), makeRace('r3', 3), makeRace('r4', 4)];
    const finishes: Finish[] = [
      // Races 1 and 2: A last (fleet rank 4 = 4 pts)
      makeFinish('r1', 'B', 1), makeFinish('r1', 'C', 2), makeFinish('r1', 'D', 3), makeFinish('r1', 'A', 4),
      makeFinish('r2', 'B', 1), makeFinish('r2', 'C', 2), makeFinish('r2', 'D', 3), makeFinish('r2', 'A', 4),
      // Races 3 and 4: A first (fleet rank 1 = 1 pt)
      makeFinish('r3', 'A', 1), makeFinish('r3', 'B', 2), makeFinish('r3', 'C', 3), makeFinish('r3', 'D', 4),
      makeFinish('r4', 'A', 1), makeFinish('r4', 'B', 2), makeFinish('r4', 'C', 3), makeFinish('r4', 'D', 4),
    ];
    const { standings } = calculateStandings(abcd, fourRaces, finishes, [{ minRaces: 4, discardCount: 1 }]);
    const aStanding = standings.find(s => s.competitor.id === 'A')!;
    expect(aStanding.raceDiscards).toEqual([true, false, false, false]);
    expect(aStanding.netPoints).toBe(6); // 4+1+1 = 6
  });

  it('no discards applied when race count below threshold', () => {
    const ab = ['A', 'B'].map(id => makeCompetitor(id));
    const twoRaces = [makeRace('r1', 1), makeRace('r2', 2)];
    const finishes: Finish[] = [
      makeFinish('r1', 'A', 1), makeFinish('r1', 'B', 2),
      makeFinish('r2', 'A', 2), makeFinish('r2', 'B', 1),
    ];
    const { standings } = calculateStandings(ab, twoRaces, finishes, [{ minRaces: 3, discardCount: 1 }]);
    for (const s of standings) {
      expect(s.netPoints).toBe(s.totalPoints);
      expect(s.raceDiscards.every(d => !d)).toBe(true);
    }
  });
});

// ─── calculateFleetStandings ─────────────────────────────────────────────────

function makeFleet(id: string, name: string, displayOrder: number, seriesId = 's1'): Fleet {
  return { id, seriesId, name, displayOrder };
}

describe('calculateFleetStandings', () => {
  const races = [makeRace('r1', 1), makeRace('r2', 2)];

  it('scores each fleet independently — penalty N is fleet size not total', () => {
    // Junior fleet: 3 competitors; Senior fleet: 2 competitors
    const juniors = [
      makeCompetitor('J1', 's1', 'f-junior'),
      makeCompetitor('J2', 's1', 'f-junior'),
      makeCompetitor('J3', 's1', 'f-junior'),
    ];
    const seniors = [
      makeCompetitor('S1', 's1', 'f-senior'),
      makeCompetitor('S2', 's1', 'f-senior'),
    ];
    const competitors = [...juniors, ...seniors];
    const fleets = [
      makeFleet('f-junior', 'Junior', 0),
      makeFleet('f-senior', 'Senior', 1),
    ];

    // J3 and S2 DNC both races
    const finishes: Finish[] = [
      makeFinish('r1', 'J1', 1), makeFinish('r1', 'J2', 2),
      makeFinish('r1', 'S1', 1),
      makeFinish('r2', 'J1', 1), makeFinish('r2', 'J2', 2),
      makeFinish('r2', 'S1', 1),
    ];

    const { fleetStandings: results } = calculateFleetStandings(fleets, competitors, races, finishes);
    expect(results).toHaveLength(2);

    const [juniorResult, seniorResult] = results;
    expect(juniorResult.fleet.name).toBe('Junior');
    expect(seniorResult.fleet.name).toBe('Senior');

    // J3 DNC should score 3+1 = 4 (fleet size 3)
    const j3 = juniorResult.standings.find((s) => s.competitor.id === 'J3')!;
    expect(j3.racePoints[0]).toBe(4); // DNC = 3+1

    // S2 DNC should score 2+1 = 3 (fleet size 2), NOT 5+1 = 6 (total)
    const s2 = seniorResult.standings.find((s) => s.competitor.id === 'S2')!;
    expect(s2.racePoints[0]).toBe(3); // DNC = 2+1
  });

  it('single fleet — output matches calculateStandings', () => {
    const competitors = ['A', 'B', 'C'].map((id) => makeCompetitor(id, 's1', 'f1'));
    const fleet = makeFleet('f1', 'Default', 0);
    const finishes: Finish[] = [
      makeFinish('r1', 'A', 1), makeFinish('r1', 'B', 2), makeFinish('r1', 'C', 3),
      makeFinish('r2', 'A', 3), makeFinish('r2', 'B', 1), makeFinish('r2', 'C', 2),
    ];
    const { fleetStandings: [fleetResult] } = calculateFleetStandings([fleet], competitors, races, finishes);
    const { standings: direct } = calculateStandings(competitors, races, finishes);

    expect(fleetResult.standings.map((s) => s.competitor.id))
      .toEqual(direct.map((s) => s.competitor.id));
    expect(fleetResult.standings.map((s) => s.netPoints))
      .toEqual(direct.map((s) => s.netPoints));
  });

  it('returns fleets in displayOrder', () => {
    const competitors = [
      makeCompetitor('A', 's1', 'f2'),
      makeCompetitor('B', 's1', 'f1'),
    ];
    const fleets = [
      makeFleet('f2', 'Zephyr', 5),
      makeFleet('f1', 'Alpha', 0),
    ];
    const { fleetStandings: results } = calculateFleetStandings(fleets, competitors, races, []);
    expect(results[0].fleet.name).toBe('Alpha');
    expect(results[1].fleet.name).toBe('Zephyr');
  });
});

// ─── Unknown finishes (null competitorId) ────────────────────────────────────

describe('calculateRaceScores — unknown finishes (null competitorId)', () => {
  const competitors = ['A', 'B', 'C'].map(id => makeCompetitor(id));
  const n = competitors.length; // 3

  it('ignores a finish with null competitorId and does not affect competitor scores', () => {
    const finishes: Finish[] = [
      { id: 'u1', raceId: 'r1', competitorId: null, unknownSailNumber: '9999', finishPosition: 1, resultCode: null, startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null, redressExcludeRaces: null, redressIncludeRaces: null, redressIncludeAllLater: false, redressPoints: null },
      makeFinish('r1', 'A', 2),
      makeFinish('r1', 'B', 3),
    ];
    const scores = calculateRaceScores(finishes, competitors);
    // Unknown is ignored; A and B are the only finishers (fleet ranks 1 and 2), C → implicit DNC
    expect(scores.get('A')?.points).toBe(1);
    expect(scores.get('B')?.points).toBe(2);
    expect(scores.get('C')?.points).toBe(n + 1);
    expect(scores.get('C')?.resultCode).toBe('DNC');
    // Unknown finish does not produce a score entry
    expect(scores.get(null as unknown as string)).toBeUndefined();
  });

  it('does not crash when all finishes have null competitorId', () => {
    const finishes: Finish[] = [
      { id: 'u1', raceId: 'r1', competitorId: null, unknownSailNumber: '9999', finishPosition: 1, resultCode: null, startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null, redressExcludeRaces: null, redressIncludeRaces: null, redressIncludeAllLater: false, redressPoints: null },
    ];
    const scores = calculateRaceScores(finishes, competitors);
    // All three competitors score as implicit DNC
    for (const c of competitors) {
      expect(scores.get(c.id)?.resultCode).toBe('DNC');
      expect(scores.get(c.id)?.points).toBe(n + 1);
    }
  });
});

// ─── Additive penalty codes (Phase 2) ────────────────────────────────────────

describe('calculateRaceScores — additive penalties (ZFP/SCP/DPI)', () => {
  const competitors = ['A', 'B', 'C', 'D', 'E'].map(id => makeCompetitor(id));
  const n = competitors.length; // 5
  const dnfScore = n + 1; // 6

  it('ZFP adds 20% of DNF score to finish place', () => {
    const finishes = [
      makeFinish('r1', 'A', 1, null, 'ZFP'),  // 1 + round(0.2×6)=1 → 2
      makeFinish('r1', 'B', 2),               // 2 (unchanged)
      makeFinish('r1', 'C', 3),               // 3
      makeFinish('r1', 'D', 4),               // 4
      makeFinish('r1', 'E', 5),               // 5
    ];
    const scores = calculateRaceScores(finishes, competitors);
    expect(scores.get('A')?.points).toBe(2);  // 1 + 1 = 2
    expect(scores.get('B')?.points).toBe(2);  // unchanged
    expect(scores.get('A')?.resultCode).toBeNull();
  });

  it('ZFP penalty is capped at DNF score', () => {
    // 4th place + ZFP: 4 + round(0.2×6) = 4+1 = 5 — under cap
    // Last place + ZFP: 5 + 1 = 6 = cap exactly
    const finishes = [
      makeFinish('r1', 'A', 1),
      makeFinish('r1', 'B', 2),
      makeFinish('r1', 'C', 3),
      makeFinish('r1', 'D', 4),
      makeFinish('r1', 'E', 5, null, 'ZFP'),  // 5 + 1 = 6 = dnfScore
    ];
    const scores = calculateRaceScores(finishes, competitors);
    expect(scores.get('E')?.points).toBe(dnfScore); // capped at 6
  });

  it('SCP uses default 20% when no override', () => {
    const finishes = [
      makeFinish('r1', 'A', 1, null, 'SCP'),  // same as ZFP: 1+1=2
      makeFinish('r1', 'B', 2),
      makeFinish('r1', 'C', 3),
      makeFinish('r1', 'D', 4),
      makeFinish('r1', 'E', 5),
    ];
    const scores = calculateRaceScores(finishes, competitors);
    expect(scores.get('A')?.points).toBe(2);
  });

  it('SCP uses penaltyOverride percentage when specified', () => {
    const finishes = [
      makeFinish('r1', 'A', 2, null, 'SCP', 30),  // 2 + round(0.3×6)=2 → 4
      makeFinish('r1', 'B', 1),
      makeFinish('r1', 'C', 3),
      makeFinish('r1', 'D', 4),
      makeFinish('r1', 'E', 5),
    ];
    const scores = calculateRaceScores(finishes, competitors);
    expect(scores.get('A')?.points).toBe(4); // 2 + 2 = 4
  });

  it('DPI adds stated points from penaltyOverride', () => {
    const finishes = [
      makeFinish('r1', 'A', 1, null, 'DPI', 3),  // 1+3=4
      makeFinish('r1', 'B', 2),
      makeFinish('r1', 'C', 3),
      makeFinish('r1', 'D', 4),
      makeFinish('r1', 'E', 5),
    ];
    const scores = calculateRaceScores(finishes, competitors);
    expect(scores.get('A')?.points).toBe(4);
  });

  it('DPI is capped at DNF score', () => {
    const finishes = [
      makeFinish('r1', 'A', 3, null, 'DPI', 100),  // min(3+100, 6)=6
      makeFinish('r1', 'B', 2),
      makeFinish('r1', 'C', 1),
      makeFinish('r1', 'D', 4),
      makeFinish('r1', 'E', 5),
    ];
    const scores = calculateRaceScores(finishes, competitors);
    expect(scores.get('A')?.points).toBe(dnfScore); // capped
  });

  it('penalty code does not affect other boats scores (A6.2)', () => {
    const finishes = [
      makeFinish('r1', 'A', 1, null, 'ZFP'),
      makeFinish('r1', 'B', 2),
      makeFinish('r1', 'C', 3),
      makeFinish('r1', 'D', 4),
      makeFinish('r1', 'E', 5),
    ];
    const scores = calculateRaceScores(finishes, competitors);
    // B,C,D,E keep their original finish-place scores
    expect(scores.get('B')?.points).toBe(2);
    expect(scores.get('C')?.points).toBe(3);
    expect(scores.get('D')?.points).toBe(4);
    expect(scores.get('E')?.points).toBe(5);
  });

  it('penalty is not applied to non-finishers (coded boats)', () => {
    // A penalty on a coded boat (resultCode set) is ignored
    const finishes = [
      makeFinish('r1', 'A', null, 'DNS'),  // coded; penalty should be ignored
      makeFinish('r1', 'B', 1),
      makeFinish('r1', 'C', 2),
      makeFinish('r1', 'D', 3),
      makeFinish('r1', 'E', 4),
    ];
    // Manually set penaltyCode on the DNS finish
    finishes[0] = { ...finishes[0], penaltyCode: 'ZFP' };
    const scores = calculateRaceScores(finishes, competitors);
    expect(scores.get('A')?.points).toBe(dnfScore); // DNS: N+1, ZFP ignored
    expect(scores.get('A')?.resultCode).toBe('DNS');
  });
});

describe('calculateStandings — racePenaltyCodes populated', () => {
  const competitors = ['A', 'B', 'C'].map(id => makeCompetitor(id));
  const races = [makeRace('r1', 1), makeRace('r2', 2)];

  it('racePenaltyCodes tracks which races had a penalty', () => {
    const finishes = [
      makeFinish('r1', 'A', 1, null, 'ZFP'),
      makeFinish('r1', 'B', 2),
      makeFinish('r1', 'C', 3),
      makeFinish('r2', 'A', 2),
      makeFinish('r2', 'B', 1, null, 'SCP', 30),
      makeFinish('r2', 'C', 3),
    ];
    const { standings } = calculateStandings(competitors, races, finishes);
    const byId = new Map(standings.map(s => [s.competitor.id, s]));
    expect(byId.get('A')?.racePenaltyCodes).toEqual(['ZFP', null]);
    expect(byId.get('B')?.racePenaltyCodes).toEqual([null, 'SCP']);
    expect(byId.get('C')?.racePenaltyCodes).toEqual([null, null]);
  });
});

describe('calculateStandings — unknown finishes (null competitorId)', () => {
  const competitors = ['A', 'B'].map(id => makeCompetitor(id));
  const races = [makeRace('r1', 1)];

  it('ignores unknown finishes and scores registered competitors correctly', () => {
    const finishes: Finish[] = [
      makeFinish('r1', 'A', 1),
      { id: 'u1', raceId: 'r1', competitorId: null, unknownSailNumber: '9999', finishPosition: 2, resultCode: null, startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null, redressExcludeRaces: null, redressIncludeRaces: null, redressIncludeAllLater: false, redressPoints: null },
    ];
    const { standings } = calculateStandings(competitors, races, finishes);
    // A wins with 1 point; B has no finish → implicit DNC (3 pts)
    expect(standings[0].competitor.id).toBe('A');
    expect(standings[0].netPoints).toBe(1);
    expect(standings[1].competitor.id).toBe('B');
    expect(standings[1].netPoints).toBe(3);
  });
});
