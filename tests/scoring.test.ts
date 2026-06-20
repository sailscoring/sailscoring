import { describe, it, expect } from 'vitest';
import { calculateRaceScores, calculateStandings, calculateFleetStandings, getDiscardCount, calculateHandicapRaceScores, calculateHandicapAdjustment, deriveProgressiveHandicapConfig, DEFAULT_NHC_PROFILE } from '@/lib/scoring';
import type { Competitor, Fleet, Race, Finish, DiscardThreshold, PenaltyCode, RaceStart } from '@/lib/types';

// Helpers to build test fixtures with minimal required fields
function makeCompetitor(id: string, seriesId = 's1', fleetId = 'f1'): Competitor {
  return { id, seriesId, fleetIds: [fleetId], sailNumber: id, name: id, club: '', gender: '', age: null, createdAt: 0 };
}

function makeRace(id: string, raceNumber: number, seriesId = 's1'): Race {
  return { id, seriesId, raceNumber, name: null, date: '2025-01-01', createdAt: 0 };
}

function makeFinish(
  raceId: string,
  competitorId: string,
  sortOrder: number | null,
  resultCode: Finish['resultCode'] = null,
  penaltyCode: PenaltyCode | null = null,
  penaltyOverride: number | null = null,
): Finish {
  return { id: `${raceId}-${competitorId}`, raceId, competitorId, sortOrder, resultCode, startPresent: null, penaltyCode, penaltyOverride, redressMethod: null, redressExcludeRaceIds: null, redressIncludeRaceIds: null, tiedWithPrevious: false, redressIncludeAllLater: false, redressPoints: null };
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
    // B and C tied — each scores (2+3)/2 = 2.5; D at position 4 scores 4.
    // Per ADR-008 Phase 6 (#111), ties are stored on the boolean rather
    // than as equal sortOrders.
    const finishes = [
      makeFinish('r1', 'A', 1),
      makeFinish('r1', 'B', 2),
      { ...makeFinish('r1', 'C', 3), tiedWithPrevious: true },
      makeFinish('r1', 'D', 4),
      makeFinish('r1', 'E', 5),
    ];
    const scores = calculateRaceScores(finishes, competitors);
    expect(scores.get('A')?.points).toBe(1);
    expect(scores.get('B')?.points).toBe(2.5);
    expect(scores.get('C')?.points).toBe(2.5);
    expect(scores.get('D')?.points).toBe(4);
    expect(scores.get('E')?.points).toBe(5);
    // place is preserved as the raw sortOrder (now distinct)
    expect(scores.get('B')?.place).toBe(2);
    expect(scores.get('C')?.place).toBe(3);
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

  it('scores BFD on the starters base under startingArea scoring (same as DSQ/UFD)', () => {
    // Rule 30.4 boats came to the starting area, so BFD uses the 'starters'
    // base: under startingArea scoring it scores starters+1, not entries+1.
    // Check-in data: A (BFD), B, C, D present; E absent (DNC) → starters = 4.
    const present = (f: ReturnType<typeof makeFinish>) => ({ ...f, startPresent: true });
    const finishes = [
      present(makeFinish('r1', 'A', null, 'BFD')),
      present(makeFinish('r1', 'B', 1)),
      present(makeFinish('r1', 'C', 2)),
      present(makeFinish('r1', 'D', 3)),
      { ...makeFinish('r1', 'E', null, 'DNC'), startPresent: false },
    ];
    const scores = calculateRaceScores(finishes, competitors, 'startingArea');
    // starters = 4 (A, B, C, D present); startingAreaPenalty = 5
    expect(scores.get('A')?.points).toBe(5);  // BFD on starters base, not entries+1 (6)
    expect(scores.get('B')?.points).toBe(1);
    expect(scores.get('E')?.points).toBe(n + 1); // DNC stays on entries base (6)
  });

  it('A5.3 starters count is fleet-scoped when called with cross-fleet finishes', () => {
    // Regression: results-export.ts passes all-fleet finishes but per-fleet
    // competitors. The A5.3 starting-area count must filter to the fleet's
    // competitors, otherwise RET/DNF in a small fleet gets inflated by
    // starters from other fleets.
    //
    // Squib Scr: 5 competitors (A–E); 4 finish, 1 RET → starters = 5, RET = 6.
    // Puppeteer (P1–P10): 10 boats finishing in their own start.
    const squib = ['A', 'B', 'C', 'D', 'E'].map((id) => makeCompetitor(id, 's1', 'squib'));
    const puppeteer = Array.from({ length: 10 }, (_, i) =>
      makeCompetitor(`P${i + 1}`, 's1', 'puppeteer'),
    );
    const finishes = [
      makeFinish('r1', 'A', 1),
      makeFinish('r1', 'B', 2),
      makeFinish('r1', 'C', 3),
      makeFinish('r1', 'D', 4),
      makeFinish('r1', 'E', null, 'RET'),
      ...puppeteer.map((c, i) => makeFinish('r1', c.id, i + 1)),
    ];
    const scores = calculateRaceScores(finishes, squib, 'startingArea');
    // starters in Squib = 4 finishers + 1 RET = 5; RET points = 5 + 1 = 6.
    // (Bug behaviour: 4 + 10 + 1 RET = 15 non-DNC → RET = 16.)
    expect(scores.get('E')?.points).toBe(6);
    expect(scores.get('E')?.resultCode).toBe('RET');
    // Sanity: finishers in Squib still get their own positions.
    expect(scores.get('A')?.points).toBe(1);
    expect(scores.get('D')?.points).toBe(4);
  });

  it('averages points for a three-way tie', () => {
    // A, B, C tied — each scores (1+2+3)/3 = 2; D at position 4 scores 4
    const finishes = [
      makeFinish('r1', 'A', 1),
      { ...makeFinish('r1', 'B', 2), tiedWithPrevious: true },
      { ...makeFinish('r1', 'C', 3), tiedWithPrevious: true },
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

  it('breaks a tie by RRS A8.2 countback when A8.1 cannot separate', () => {
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
    // A and B both net 3. A8.1 sorted scores [1,2] vs [1,2] → identical, no
    // separation. A8.2 counts back from the last race: A got 2, B got 1 → B wins.
    const { standings } = calculateStandings(competitors, races, finishes);
    expect(standings[0].competitor.id).toBe('B');
    expect(standings[1].competitor.id).toBe('A');
  });

  it('ranks by net points before any tie-break is needed', () => {
    const threeRaces = [makeRace('r1', 1), makeRace('r2', 2), makeRace('r3', 3)];
    const abc = ['A', 'B'].map(id => makeCompetitor(id));
    const finishes: Finish[] = [
      // Race 1: A=1, B=2
      makeFinish('r1', 'A', 1), makeFinish('r1', 'B', 2),
      // Race 2: B=1, A=2
      makeFinish('r2', 'B', 1), makeFinish('r2', 'A', 2),
      // Race 3: A=1, B=2
      makeFinish('r3', 'A', 1), makeFinish('r3', 'B', 2),
    ];
    // A: 1+2+1=4, B: 2+1+2=5 — not tied; A wins outright on net points.
    const { standings } = calculateStandings(abc, threeRaces, finishes);
    expect(standings[0].competitor.id).toBe('A');
  });

  it('A8.1 excludes discards: a discarded back-of-fleet score never helps (regression)', () => {
    // Regression for the pre-2025 place-count tie-break, which ranked Bob ahead
    // by counting his discarded 4th place. A8.1 ignores discards: Alice and Bob
    // both net 5 with kept scores [2,3] each, so A8.1 ties; A8.2's last-race
    // countback (Alice 3rd, Bob 4th) ranks Alice ahead.
    const [a, b, c, d] = ['A', 'B', 'C', 'D'].map((id) => makeCompetitor(id));
    const fourBoats = [a, b, c, d];
    const r = [makeRace('r1', 1), makeRace('r2', 2), makeRace('r3', 3)];
    const discardThresholds: DiscardThreshold[] = [{ minRaces: 3, discardCount: 1 }];
    const finishes: Finish[] = [
      // R1: C 1st, B 2nd; A and D DNC (=5)
      makeFinish('r1', 'C', 1), makeFinish('r1', 'B', 2),
      makeFinish('r1', 'A', null, 'DNC'), makeFinish('r1', 'D', null, 'DNC'),
      // R2: C 1st, A 2nd, B 3rd, D 4th
      makeFinish('r2', 'C', 1), makeFinish('r2', 'A', 2), makeFinish('r2', 'B', 3), makeFinish('r2', 'D', 4),
      // R3: C 1st, D 2nd, A 3rd, B 4th
      makeFinish('r3', 'C', 1), makeFinish('r3', 'D', 2), makeFinish('r3', 'A', 3), makeFinish('r3', 'B', 4),
    ];
    const { standings } = calculateStandings(fourBoats, r, finishes, discardThresholds);
    const alice = standings.find((s) => s.competitor.id === 'A')!;
    const bob = standings.find((s) => s.competitor.id === 'B')!;
    expect(alice.netPoints).toBe(5);
    expect(bob.netPoints).toBe(5);
    expect(alice.rank).toBe(2);
    expect(bob.rank).toBe(3);
  });

  it('A8.1 compares scores beyond the old (races+1) place-count bound (regression)', () => {
    // Regression for the DBSC Thursday Blue mis-ranking. In a 7-boat fleet with
    // one discard, Pat keeps [6,6] and Quinn keeps [5,7], both net 12. Every
    // distinguishing score (5/6/7) sat outside the old place-count window of
    // 1..(races+1)=1..4, so the bug fell through to a countback and ranked Pat
    // ahead. A8.1 compares the full sorted list: Quinn's 5 beats Pat's 6.
    const ids = ['P', 'Q', 'F1', 'F2', 'F3', 'F4', 'F5'];
    const boats = ids.map((id) => makeCompetitor(id)); // 7 boats → DNC = 8
    const r = [makeRace('r1', 1), makeRace('r2', 2), makeRace('r3', 3)];
    const discardThresholds: DiscardThreshold[] = [{ minRaces: 3, discardCount: 1 }];
    const finishes: Finish[] = [
      // R1: F1..F4 = 1..4, Q 5th, P 6th, F5 7th
      makeFinish('r1', 'F1', 1), makeFinish('r1', 'F2', 2), makeFinish('r1', 'F3', 3), makeFinish('r1', 'F4', 4),
      makeFinish('r1', 'Q', 5), makeFinish('r1', 'P', 6), makeFinish('r1', 'F5', 7),
      // R2: F1..F5 = 1..5, P 6th, Q 7th
      makeFinish('r2', 'F1', 1), makeFinish('r2', 'F2', 2), makeFinish('r2', 'F3', 3), makeFinish('r2', 'F4', 4),
      makeFinish('r2', 'F5', 5), makeFinish('r2', 'P', 6), makeFinish('r2', 'Q', 7),
      // R3: F1..F5 = 1..5, P and Q DNC (=8)
      makeFinish('r3', 'F1', 1), makeFinish('r3', 'F2', 2), makeFinish('r3', 'F3', 3), makeFinish('r3', 'F4', 4),
      makeFinish('r3', 'F5', 5), makeFinish('r3', 'P', null, 'DNC'), makeFinish('r3', 'Q', null, 'DNC'),
    ];
    const { standings } = calculateStandings(boats, r, finishes, discardThresholds);
    const pat = standings.find((s) => s.competitor.id === 'P')!;
    const quinn = standings.find((s) => s.competitor.id === 'Q')!;
    expect(pat.netPoints).toBe(12);
    expect(quinn.netPoints).toBe(12);
    expect(quinn.rank).toBe(6);
    expect(pat.rank).toBe(7);
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
    // A: 1+2=3, B: 2+1=3; A8.1 sorted [1,2] vs [1,2] ties; A8.2 last race: A=2, B=1 → B wins
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

  it('marks DNE races as non-discardable but not BFD (rule 30.4 BFD is discardable)', () => {
    const [a, b, c] = competitors;
    const threeRaces = [makeRace('r1', 1), makeRace('r2', 2), makeRace('r3', 3)];
    const finishes: Finish[] = [
      makeFinish('r1', 'A', 1), makeFinish('r1', 'B', 2), makeFinish('r1', 'C', 3),
      makeFinish('r2', 'A', null, 'DNE'), makeFinish('r2', 'B', 1), makeFinish('r2', 'C', 2),
      makeFinish('r3', 'A', null, 'BFD'), makeFinish('r3', 'B', 1), makeFinish('r3', 'C', 2),
    ];
    const { standings } = calculateStandings(competitors, threeRaces, finishes);
    const aStanding = standings.find((s) => s.competitor.id === 'A')!;
    // R2 DNE non-discardable; R3 BFD is an ordinary discardable disqualification.
    expect(aStanding.raceNonDiscardable).toEqual([false, true, false]);
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

// ─── per-race ranks (podium badges) ──────────────────────────────────────────

describe('calculateStandings raceRanks', () => {
  const competitors = ['A', 'B', 'C'].map((id) => makeCompetitor(id));

  it('records each clean finisher\'s within-fleet finish rank per race', () => {
    const races = [makeRace('r1', 1), makeRace('r2', 2)];
    const finishes: Finish[] = [
      makeFinish('r1', 'A', 1), makeFinish('r1', 'B', 2), makeFinish('r1', 'C', 3),
      makeFinish('r2', 'A', 3), makeFinish('r2', 'B', 1), makeFinish('r2', 'C', 2),
    ];
    const { standings } = calculateStandings(competitors, races, finishes);
    const byId = (id: string) => standings.find((s) => s.competitor.id === id)!;
    expect(byId('A').raceRanks).toEqual([1, 3]);
    expect(byId('B').raceRanks).toEqual([2, 1]);
    expect(byId('C').raceRanks).toEqual([3, 2]);
  });

  it('leaves coded finishes (DNC) with a null rank', () => {
    const races = [makeRace('r1', 1)];
    const finishes: Finish[] = [
      makeFinish('r1', 'A', 1), makeFinish('r1', 'B', 2),
      // C has no record → implicit DNC
    ];
    const { standings } = calculateStandings(competitors, races, finishes);
    const c = standings.find((s) => s.competitor.id === 'C')!;
    expect(c.raceRanks).toEqual([null]);
  });

  it('leaves an excluded race (no finishers) with a null rank', () => {
    const races = [makeRace('r1', 1)];
    // Nobody finished → race not validly held → excluded.
    const finishes: Finish[] = [
      makeFinish('r1', 'A', null, 'DNC'),
      makeFinish('r1', 'B', null, 'DNC'),
      makeFinish('r1', 'C', null, 'DNC'),
    ];
    const { standings } = calculateStandings(competitors, races, finishes);
    expect(standings.every((s) => s.raceRanks[0] === null)).toBe(true);
  });

  it('populates raceRanks through the fleet path too', () => {
    const races = [makeRace('r1', 1)];
    const fleetCompetitors = ['A', 'B'].map((id) => makeCompetitor(id, 's1', 'f1'));
    const fleet = makeFleet('f1', 'Default', 0);
    const finishes: Finish[] = [
      makeFinish('r1', 'A', 2), makeFinish('r1', 'B', 1),
    ];
    const { fleetStandings: [result] } = calculateFleetStandings([fleet], fleetCompetitors, races, finishes);
    const byId = (id: string) => result.standings.find((s) => s.competitor.id === id)!;
    expect(byId('A').raceRanks).toEqual([2]);
    expect(byId('B').raceRanks).toEqual([1]);
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
  return { id, seriesId, name, displayOrder, scoringSystem: 'scratch' };
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

  // Per-fleet exclusion is about whether the fleet *sailed* a validly-held race,
  // not whether that fleet had a finisher (#174). On a shared sheet one class
  // can finish while another comes to the start and all retire.
  it('counts a validly-held race for a fleet that came but had no finisher', () => {
    const racesABC = [makeRace('r1', 1), makeRace('r2', 2), makeRace('r3', 3)];
    const fleetA = [makeCompetitor('A1', 's1', 'fA'), makeCompetitor('A2', 's1', 'fA')];
    const fleetB = [makeCompetitor('B1', 's1', 'fB'), makeCompetitor('B2', 's1', 'fB')];
    const fleets = [makeFleet('fA', 'A', 0), makeFleet('fB', 'B', 1)];
    const finishes: Finish[] = [
      // r1: fleet A finishes; fleet B comes but neither finishes (B1 RET, B2 DNC).
      makeFinish('r1', 'A1', 1), makeFinish('r1', 'A2', 2),
      makeFinish('r1', 'B1', null, 'RET'),
      // r2: fleet A finishes; fleet B absent (both implicit DNC).
      makeFinish('r2', 'A1', 1), makeFinish('r2', 'A2', 2),
      // r3: nobody finishes anywhere — abandoned.
      makeFinish('r3', 'A1', null, 'RET'), makeFinish('r3', 'A2', null, 'RET'),
      makeFinish('r3', 'B1', null, 'RET'), makeFinish('r3', 'B2', null, 'RET'),
    ];
    const { fleetStandings } = calculateFleetStandings(fleets, [...fleetA, ...fleetB], racesABC, finishes);
    const b1 = fleetStandings.find((f) => f.fleet.id === 'fB')!.standings.find((s) => s.competitor.id === 'B1')!;
    // r1: held (A finished) + B came (B1 RET) → counts; B1 scores RET (N+1 = 3), not 0/excluded.
    expect(b1.raceExcluded[0]).toBe(false);
    expect(b1.racePoints[0]).toBe(3);
    // r2: B did not sail (no boat came) → excluded for B.
    expect(b1.raceExcluded[1]).toBe(true);
    expect(b1.racePoints[1]).toBe(0);
    // r3: no finisher anywhere → abandoned → excluded for everyone.
    const a1 = fleetStandings.find((f) => f.fleet.id === 'fA')!.standings.find((s) => s.competitor.id === 'A1')!;
    expect(b1.raceExcluded[2]).toBe(true);
    expect(a1.raceExcluded).toEqual([false, false, true]);
  });

  // Scores are multiples of 0.1, but summing/subtracting them in float leaves
  // IEEE residue (6.6 - 2.6 = 3.9999999999999996) that surfaced raw in the
  // in-app standings. net/total must come out clean.
  it('net score has no floating-point residue after discarding a fractional race', () => {
    const fleet: Fleet = { id: 'f1', seriesId: 's1', name: 'IRC', displayOrder: 0, scoringSystem: 'irc' };
    const mk = (id: string): Competitor => ({ ...makeCompetitor(id, 's1', 'f1'), ircTcc: 1.0 });
    const comps = [mk('A'), mk('B')];
    const racesAB = [makeRace('r1', 1), makeRace('r2', 2)];
    const starts: RaceStart[] = [
      { id: 's1', raceId: 'r1', fleetIds: ['f1'], startTime: '14:00:00' },
      { id: 's2', raceId: 'r2', fleetIds: ['f1'], startTime: '14:00:00' },
    ];
    // came = 2 → DNF score 3; SCP = 0.20 × 3 = 0.6. A: R1 = 1 + 0.6 = 1.6, R2 = 1.
    const finishes: Finish[] = [
      { ...makeFinish('r1', 'A', 1, null, 'SCP'), finishTime: '15:00:00', startPresent: true },
      { ...makeFinish('r1', 'B', 2), finishTime: '15:10:00', startPresent: true },
      { ...makeFinish('r2', 'A', 1), finishTime: '15:00:00', startPresent: true },
      { ...makeFinish('r2', 'B', 2), finishTime: '15:10:00', startPresent: true },
    ];
    const { fleetStandings } = calculateFleetStandings([fleet], comps, racesAB, finishes, [{ minRaces: 2, discardCount: 1 }], 'startingArea', starts);
    const a = fleetStandings[0].standings.find((s) => s.competitor.id === 'A')!;
    expect(a.racePoints).toEqual([1.6, 1]);
    expect(a.totalPoints).toBe(2.6);
    expect(a.netPoints).toBe(1); // 2.6 − 1.6, discarding the SCP race — clean, not 1.0000000000000002
  });
});

// ─── Unknown finishes (null competitorId) ────────────────────────────────────

describe('calculateRaceScores — unknown finishes (null competitorId)', () => {
  const competitors = ['A', 'B', 'C'].map(id => makeCompetitor(id));
  const n = competitors.length; // 3

  it('ignores a finish with null competitorId and does not affect competitor scores', () => {
    const finishes: Finish[] = [
      { id: 'u1', raceId: 'r1', competitorId: null, unknownSailNumber: '9999', sortOrder: 1, resultCode: null, startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null, redressExcludeRaceIds: null, redressIncludeRaceIds: null, tiedWithPrevious: false, redressIncludeAllLater: false, redressPoints: null },
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
      { id: 'u1', raceId: 'r1', competitorId: null, unknownSailNumber: '9999', sortOrder: 1, resultCode: null, startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null, redressExcludeRaceIds: null, redressIncludeRaceIds: null, tiedWithPrevious: false, redressIncludeAllLater: false, redressPoints: null },
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
    // RRS 44.3(c): 20% of the DNF score, rounded to the nearest tenth.
    const finishes = [
      makeFinish('r1', 'A', 1, null, 'ZFP'),  // 1 + 0.2×6 = 1 + 1.2 = 2.2
      makeFinish('r1', 'B', 2),               // 2 (unchanged)
      makeFinish('r1', 'C', 3),               // 3
      makeFinish('r1', 'D', 4),               // 4
      makeFinish('r1', 'E', 5),               // 5
    ];
    const scores = calculateRaceScores(finishes, competitors);
    expect(scores.get('A')?.points).toBe(2.2);  // 1 + 1.2
    expect(scores.get('B')?.points).toBe(2);  // unchanged
    expect(scores.get('A')?.resultCode).toBeNull();
  });

  it('ZFP penalty is capped at DNF score', () => {
    // Last place + ZFP: 5 + 1.2 = 6.2 → capped at the DNF score (6).
    const finishes = [
      makeFinish('r1', 'A', 1),
      makeFinish('r1', 'B', 2),
      makeFinish('r1', 'C', 3),
      makeFinish('r1', 'D', 4),
      makeFinish('r1', 'E', 5, null, 'ZFP'),  // 5 + 1.2 = 6.2 → 6
    ];
    const scores = calculateRaceScores(finishes, competitors);
    expect(scores.get('E')?.points).toBe(dnfScore); // capped at 6
  });

  it('SCP uses default 20% when no override', () => {
    const finishes = [
      makeFinish('r1', 'A', 1, null, 'SCP'),  // same as ZFP: 1 + 1.2 = 2.2
      makeFinish('r1', 'B', 2),
      makeFinish('r1', 'C', 3),
      makeFinish('r1', 'D', 4),
      makeFinish('r1', 'E', 5),
    ];
    const scores = calculateRaceScores(finishes, competitors);
    expect(scores.get('A')?.points).toBe(2.2);
  });

  it('SCP uses penaltyOverride percentage when specified', () => {
    const finishes = [
      makeFinish('r1', 'A', 2, null, 'SCP', 30),  // 2 + 0.3×6 = 2 + 1.8 = 3.8
      makeFinish('r1', 'B', 1),
      makeFinish('r1', 'C', 3),
      makeFinish('r1', 'D', 4),
      makeFinish('r1', 'E', 5),
    ];
    const scores = calculateRaceScores(finishes, competitors);
    expect(scores.get('A')?.points).toBe(3.8); // 2 + 1.8
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

  it('penalty code does not affect other boats scores (44.3(c))', () => {
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
      { id: 'u1', raceId: 'r1', competitorId: null, unknownSailNumber: '9999', sortOrder: 2, resultCode: null, startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null, redressExcludeRaceIds: null, redressIncludeRaceIds: null, tiedWithPrevious: false, redressIncludeAllLater: false, redressPoints: null },
    ];
    const { standings } = calculateStandings(competitors, races, finishes);
    // A wins with 1 point; B has no finish → implicit DNC (3 pts)
    expect(standings[0].competitor.id).toBe('A');
    expect(standings[0].netPoints).toBe(1);
    expect(standings[1].competitor.id).toBe('B');
    expect(standings[1].netPoints).toBe(3);
  });
});

// ─── calculateHandicapAdjustment (NHC1-style + ECHO config) ──────────────────

describe('calculateHandicapAdjustment — NHC1 edge cases', () => {
  // Legacy `_alpha` arg accepted for call-site compatibility; SWNHC2015 reads
  // its parameters from DEFAULT_NHC_PROFILE. These tests will be revisited in
  // the fixture-regeneration phase.
  function nhcFleet(_alpha?: number): Fleet {
    return { id: 'fl-0', seriesId: 's1', name: 'NHC', displayOrder: 0, scoringSystem: 'nhc' };
  }
  function comp(id: string, startTcf?: number): Competitor {
    return { id, seriesId: 's1', fleetIds: ['fl-0'], sailNumber: id, name: id, club: '', gender: '', age: null, createdAt: 0, ...(startTcf != null ? { nhcStartingTcf: startTcf } : {}) };
  }
  function start(): RaceStart {
    return { id: 'rs-0', raceId: 'r-0', fleetIds: ['fl-0'], startTime: '14:00:00' };
  }
  function fin(competitorId: string, finishTime?: string, code: Finish['resultCode'] = null): Finish {
    return { id: `f-${competitorId}`, raceId: 'r-0', competitorId, sortOrder: null, ...(finishTime ? { finishTime } : {}), resultCode: code, startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null, redressExcludeRaceIds: null, redressIncludeRaceIds: null, tiedWithPrevious: false, redressIncludeAllLater: false, redressPoints: null };
  }

  // Drives both phases in sequence the same way the orchestrator does, so the
  // tests verify the contract between phases as well as the math.
  function runRace(fleet: Fleet, cs: Competitor[], tcf: Map<string, number>, finishes: Finish[]) {
    const { scores } = calculateHandicapRaceScores(finishes, cs, start(), tcf);
    const config = deriveProgressiveHandicapConfig(fleet)!;
    const adj = calculateHandicapAdjustment(scores, config);
    return { scores, ...adj };
  }

  it('fewer than MinFin finishers suppresses the update (newTcf == tcfApplied)', () => {
    // SWNHC2015's MinFin = 3; with only 2 finishers every boat keeps its TCF.
    const fleet = nhcFleet();
    const cs = [comp('A', 1.0), comp('B', 1.0)];
    const tcf = new Map([['A', 1.0], ['B', 1.0]]);
    const finishes = [fin('A', '14:50:00'), fin('B', '15:00:00')];
    const { newTcfByCompetitorId, aggregates, perFinisherCalc } = runRace(fleet, cs, tcf, finishes);
    expect((aggregates as { updateSuppressed: boolean }).updateSuppressed).toBe(true);
    expect(newTcfByCompetitorId.get('A')).toBeCloseTo(1.0, 6);
    expect(newTcfByCompetitorId.get('B')).toBeCloseTo(1.0, 6);
    // Suppressed → no per-finisher intermediates emitted.
    expect(perFinisherCalc.size).toBe(0);
  });

  it('asymmetric blend: a clear non-extreme over-performer uses α=0.30', () => {
    // Three boats so MinFin is met. Boat A is fast (non-extreme over),
    // expected α = 0.30. The others bracket the fleet so A isn't extreme.
    const fleet = nhcFleet();
    const cs = [comp('A', 1.0), comp('B', 1.0), comp('C', 1.0)];
    const tcf = new Map([['A', 1.0], ['B', 1.0], ['C', 1.0]]);
    const finishes = [fin('A', '14:50:00'), fin('B', '15:00:00'), fin('C', '15:10:00')];
    const { perFinisherCalc } = runRace(fleet, cs, tcf, finishes);
    const a = perFinisherCalc.get('A')!;
    // Narrowing union: NHC path populates compScore & isExtreme.
    expect('compScore' in a ? a.compScore : null).toBeGreaterThan(1.0);
    expect('isExtreme' in a ? a.isExtreme : null).toBe(false);
    expect(a.alphaApplied).toBeCloseTo(0.30, 6);
  });

  it('single-finisher race triggers suppression (n=1 < MinFin=3)', () => {
    const fleet = nhcFleet();
    const cs = [comp('A', 1.0)];
    const tcf = new Map([['A', 1.0]]);
    const finishes = [fin('A', '14:50:00')];
    const { newTcfByCompetitorId, aggregates } = runRace(fleet, cs, tcf, finishes);
    expect(aggregates.finisherCount).toBe(1);
    expect((aggregates as { updateSuppressed: boolean }).updateSuppressed).toBe(true);
    expect(newTcfByCompetitorId.get('A')).toBeCloseTo(1.0, 6);
  });

  it('all-DNF race leaves all TCFs unchanged and emits zero finisher aggregates', () => {
    const fleet = nhcFleet();
    const cs = [comp('A', 1.0), comp('B', 1.05)];
    const tcf = new Map([['A', 1.0], ['B', 1.05]]);
    const finishes = [fin('A', undefined, 'DNF'), fin('B', undefined, 'DNF')];
    const { newTcfByCompetitorId, aggregates } = runRace(fleet, cs, tcf, finishes);
    expect(aggregates.finisherCount).toBe(0);
    expect(newTcfByCompetitorId.get('A')).toBe(1.0);
    expect(newTcfByCompetitorId.get('B')).toBe(1.05);
  });

  it('phase A applies the supplied TCF map, not the competitor master rating', () => {
    // Competitor's nhcStartingTcf is 1.0 but the running map has them at 1.20 (e.g. after race 1)
    const fleet = nhcFleet();
    const cs = [comp('A', 1.0), comp('B', 1.0)];
    const tcf = new Map([['A', 1.20], ['B', 0.80]]);
    const finishes = [fin('A', '14:50:00'), fin('B', '15:00:00')];
    const { scores } = runRace(fleet, cs, tcf, finishes);
    expect(scores.get('A')!.tcfApplied).toBe(1.20);
    expect(scores.get('B')!.tcfApplied).toBe(0.80);
  });
});


// ─── deriveProgressiveHandicapConfig — per-fleet NhcProfile override ─────────

describe('deriveProgressiveHandicapConfig — Fleet.nhcProfile override', () => {
  const stockNhc: Fleet = {
    id: 'fl-0', seriesId: 's1', name: 'NHC', displayOrder: 0, scoringSystem: 'nhc',
  };

  it('falls back to DEFAULT_NHC_PROFILE when nhcProfile is absent', () => {
    const config = deriveProgressiveHandicapConfig(stockNhc)!;
    expect(config.alphaUp).toBe(DEFAULT_NHC_PROFILE.alphaP);
    expect(config.alphaDown).toBe(DEFAULT_NHC_PROFILE.alphaN);
    expect(config.minFinishers).toBe(DEFAULT_NHC_PROFILE.minFin);
    const outlier = config.outlier as Extract<typeof config.outlier, { strategy: 'reduce-alpha' }>;
    expect(outlier.strategy).toBe('reduce-alpha');
    expect(outlier.alphaUpReduced).toBe(DEFAULT_NHC_PROFILE.alphaPX);
    expect(outlier.alphaDownReduced).toBe(DEFAULT_NHC_PROFILE.alphaNX);
    expect(outlier.sdThresholdUp).toBe(DEFAULT_NHC_PROFILE.sdOver);
    expect(outlier.sdThresholdDown).toBe(DEFAULT_NHC_PROFILE.sdUnder);
  });

  it('honours an inline per-fleet override', () => {
    const fleet: Fleet = {
      ...stockNhc,
      nhcProfile: {
        name: 'NHC1 (aggressive)',
        alphaP: 0.50, alphaN: 0.30, alphaPX: 0.25, alphaNX: 0.15,
        sdOver: 2.0, sdUnder: 1.25, minFin: 4,
      },
    };
    const config = deriveProgressiveHandicapConfig(fleet)!;
    expect(config.alphaUp).toBe(0.50);
    expect(config.alphaDown).toBe(0.30);
    expect(config.minFinishers).toBe(4);
    const outlier = config.outlier as Extract<typeof config.outlier, { strategy: 'reduce-alpha' }>;
    expect(outlier.alphaUpReduced).toBe(0.25);
    expect(outlier.alphaDownReduced).toBe(0.15);
    expect(outlier.sdThresholdUp).toBe(2.0);
    expect(outlier.sdThresholdDown).toBe(1.25);
    const realign = config.realignment as Extract<typeof config.realignment, { target: 'prior-mean' }>;
    expect(realign.minFinishers).toBe(4);
  });
});


// ─── calculateHandicapRaceScores — penalty bases (A5.2/A5.3, rated-only) ─────

describe('calculateHandicapRaceScores — penalty points', () => {
  function ircFleet(): Fleet {
    return { id: 'fl-0', seriesId: 's1', name: 'IRC', displayOrder: 0, scoringSystem: 'irc' };
  }
  function comp(id: string, ircTcc?: number): Competitor {
    return { id, seriesId: 's1', fleetIds: ['fl-0'], sailNumber: id, name: id, club: '', gender: '', age: null, createdAt: 0, ...(ircTcc != null ? { ircTcc } : {}) };
  }
  function start(): RaceStart {
    return { id: 'rs-0', raceId: 'r-0', fleetIds: ['fl-0'], startTime: '14:00:00' };
  }
  function fin(competitorId: string, finishTime?: string, code: Finish['resultCode'] = null, startPresent: boolean | null = null): Finish {
    return {
      id: `f-${competitorId}`,
      raceId: 'r-0',
      competitorId,
      sortOrder: null,
      ...(finishTime ? { finishTime } : {}),
      resultCode: code,
      startPresent,
      penaltyCode: null,
      penaltyOverride: null,
      redressMethod: null,
      redressExcludeRaceIds: null,
      redressIncludeRaceIds: null,
      tiedWithPrevious: false, redressIncludeAllLater: false,
      redressPoints: null,
    };
  }
  // Reference fleet: 5 rated boats. Validates `ircFleet` is wired up
  // correctly and exercises the default A5.2 path before the A5.3 cases.
  it('A5.2 (default): DNF and DNC both score entries+1', () => {
    const cs = ['A', 'B', 'C', 'D', 'E'].map((id) => comp(id, 1.0));
    const tcf = new Map(cs.map((c) => [c.id, 1.0]));
    const finishes = [
      fin('A', '14:50:00'),
      fin('B', '15:00:00'),
      fin('C', '15:10:00'),
      fin('D', undefined, 'DNF'),
      fin('E', undefined, 'DNC'),
    ];
    expect(ircFleet().id).toBe('fl-0');
    const { scores } = calculateHandicapRaceScores(finishes, cs, start(), tcf);
    expect(scores.get('D')!.points).toBe(6);
    expect(scores.get('E')!.points).toBe(6);
  });

  it('A5.3 (no check-in data): DNF uses starters+1, DNC uses entries+1', () => {
    // starters fallback = finishes where resultCode !== 'DNC' = 4 (A, B, C, D)
    // → DNF = 5; DNC = 6 (entries-base, unaffected by A5.3).
    const cs = ['A', 'B', 'C', 'D', 'E'].map((id) => comp(id, 1.0));
    const tcf = new Map(cs.map((c) => [c.id, 1.0]));
    const finishes = [
      fin('A', '14:50:00'),
      fin('B', '15:00:00'),
      fin('C', '15:10:00'),
      fin('D', undefined, 'DNF'),
      fin('E', undefined, 'DNC'),
    ];
    const { scores } = calculateHandicapRaceScores(finishes, cs, start(), tcf, 'startingArea');
    expect(scores.get('D')!.points).toBe(5);
    expect(scores.get('E')!.points).toBe(6);
  });

  it('A5.3 with check-in data: starters = boats present at the line', () => {
    const cs = ['A', 'B', 'C', 'D', 'E'].map((id) => comp(id, 1.0));
    const tcf = new Map(cs.map((c) => [c.id, 1.0]));
    const finishes = [
      fin('A', '14:50:00', null, true),
      fin('B', '15:00:00', null, true),
      fin('C', '15:10:00', null, true),
      fin('D', undefined, 'DNF', true),
      fin('E', undefined, 'DNC', false),
    ];
    const { scores } = calculateHandicapRaceScores(finishes, cs, start(), tcf, 'startingArea');
    expect(scores.get('D')!.points).toBe(5); // starters = 4, +1
    expect(scores.get('E')!.points).toBe(6); // entries = 5, +1
  });

  it('rated-only: penalty base ignores unrated boats stripped by the orchestrator', () => {
    // Fleet has 5 boats but only 3 are rated. Caller passes the 3 rated.
    // Penalty base = 3 → DNF/DNC = 4.
    const cs = ['A', 'B', 'C'].map((id) => comp(id, 1.0));
    const tcf = new Map(cs.map((c) => [c.id, 1.0]));
    const finishes = [
      fin('A', '14:50:00'),
      fin('B', '15:00:00'),
      fin('C', undefined, 'DNF'),
    ];
    const { scores } = calculateHandicapRaceScores(finishes, cs, start(), tcf);
    expect(scores.get('C')!.points).toBe(4);
  });

  it('rated-only A5.3: starter count excludes unrated finish rows', () => {
    // 3 rated boats (A, B finish; C DNF) plus an unrated boat X with a finish row
    // that the orchestrator did NOT include in `competitors`. X should not enter
    // the starters count: starters = 3 (A, B, C non-DNC) → DNF = 4.
    const cs = ['A', 'B', 'C'].map((id) => comp(id, 1.0));
    const tcf = new Map(cs.map((c) => [c.id, 1.0]));
    const finishes = [
      fin('A', '14:50:00'),
      fin('B', '15:00:00'),
      fin('C', undefined, 'DNF'),
      fin('X', '14:55:00'), // unrated; not in `competitors`
    ];
    const { scores } = calculateHandicapRaceScores(finishes, cs, start(), tcf, 'startingArea');
    expect(scores.get('C')!.points).toBe(4);
  });
});


// ─── calculateFleetStandings — NHC propagation ───────────────────────────────

describe('calculateFleetStandings — NHC progressive handicap', () => {
  // Legacy `_alpha` arg accepted for call-site compatibility; SWNHC2015 reads
  // its parameters from DEFAULT_NHC_PROFILE. These tests will be revisited in
  // the fixture-regeneration phase.
  function nhcFleet(_alpha?: number): Fleet {
    return { id: 'fl-0', seriesId: 's1', name: 'NHC', displayOrder: 0, scoringSystem: 'nhc' };
  }
  function nhcComp(id: string, startTcf?: number): Competitor {
    return { id, seriesId: 's1', fleetIds: ['fl-0'], sailNumber: id, name: id, club: '', gender: '', age: null, createdAt: 0, ...(startTcf != null ? { nhcStartingTcf: startTcf } : {}) };
  }
  function rs(raceId: string): RaceStart {
    return { id: `rs-${raceId}`, raceId, fleetIds: ['fl-0'], startTime: '14:00:00' };
  }
  function fin(raceId: string, competitorId: string, finishTime: string): Finish {
    return { id: `f-${raceId}-${competitorId}`, raceId, competitorId, sortOrder: null, finishTime, resultCode: null, startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null, redressExcludeRaceIds: null, redressIncludeRaceIds: null, tiedWithPrevious: false, redressIncludeAllLater: false, redressPoints: null };
  }

  it('threads newTcf from race N into race N+1 as tcfApplied', () => {
    const fleet = nhcFleet(0.15);
    const comps = [nhcComp('A', 0.95), nhcComp('B', 1.00), nhcComp('C', 1.05), nhcComp('D', 1.10)];
    const races: Race[] = [
      { id: 'r1', seriesId: 's1', raceNumber: 1, name: null, date: '2025-01-01', createdAt: 0 },
      { id: 'r2', seriesId: 's1', raceNumber: 2, name: null, date: '2025-01-02', createdAt: 0 },
    ];
    const finishes: Finish[] = [
      fin('r1', 'A', '14:50:00'), fin('r1', 'B', '15:00:00'),
      fin('r1', 'C', '15:10:00'), fin('r1', 'D', '15:20:00'),
      fin('r2', 'A', '14:50:00'), fin('r2', 'B', '15:00:00'),
      fin('r2', 'C', '15:10:00'), fin('r2', 'D', '15:20:00'),
    ];
    const { fleetStandings } = calculateFleetStandings([fleet], comps, races, finishes, [], 'seriesEntries', [rs('r1'), rs('r2')]);
    const fr = fleetStandings[0];
    const r1Scores = fr.nhcRaceScoresByRaceId!.get('r1')!;
    const r2Scores = fr.nhcRaceScoresByRaceId!.get('r2')!;
    // Race 2's tcfApplied for each boat must equal race 1's newTcf
    for (const cid of ['A', 'B', 'C', 'D']) {
      expect(r2Scores.get(cid)!.tcfApplied, `${cid} race-2 tcfApplied = race-1 newTcf`).toBeCloseTo(r1Scores.get(cid)!.newTcf!, 9);
    }
  });

  it('emits one tcfHistory record per (race, competitor) for NHC fleets', () => {
    const fleet = nhcFleet();
    const comps = [nhcComp('A', 1.0), nhcComp('B', 1.0)];
    const races: Race[] = [
      { id: 'r1', seriesId: 's1', raceNumber: 1, name: null, date: '2025-01-01', createdAt: 0 },
      { id: 'r2', seriesId: 's1', raceNumber: 2, name: null, date: '2025-01-02', createdAt: 0 },
    ];
    const finishes: Finish[] = [
      fin('r1', 'A', '14:50:00'), fin('r1', 'B', '15:00:00'),
      fin('r2', 'A', '14:50:00'), fin('r2', 'B', '15:00:00'),
    ];
    const { fleetStandings } = calculateFleetStandings([fleet], comps, races, finishes, [], 'seriesEntries', [rs('r1'), rs('r2')]);
    const history = fleetStandings[0].tcfHistory!;
    expect(history.length).toBe(4);
    const r1A = history.find((h) => h.raceId === 'r1' && h.competitorId === 'A');
    expect(r1A?.tcfApplied).toBe(1.0);
    expect(r1A?.fleetId).toBe('fl-0');
  });

  it('retroactive edit propagates: changing race 1 finish affects race 2 tcfApplied', () => {
    // Three boats so MinFin=3 is met and the rating update actually runs.
    const fleet = nhcFleet();
    const comps = [nhcComp('A', 1.0), nhcComp('B', 1.0), nhcComp('C', 1.0)];
    const races: Race[] = [
      { id: 'r1', seriesId: 's1', raceNumber: 1, name: null, date: '2025-01-01', createdAt: 0 },
      { id: 'r2', seriesId: 's1', raceNumber: 2, name: null, date: '2025-01-02', createdAt: 0 },
    ];
    const finishesV1: Finish[] = [
      fin('r1', 'A', '14:50:00'), fin('r1', 'B', '15:00:00'), fin('r1', 'C', '15:10:00'),
      fin('r2', 'A', '14:50:00'), fin('r2', 'B', '15:00:00'), fin('r2', 'C', '15:10:00'),
    ];
    const finishesV2: Finish[] = [
      // Swap A and C finish times in race 1: A is now slow, C is fast.
      fin('r1', 'A', '15:10:00'), fin('r1', 'B', '15:00:00'), fin('r1', 'C', '14:50:00'),
      fin('r2', 'A', '14:50:00'), fin('r2', 'B', '15:00:00'), fin('r2', 'C', '15:10:00'),
    ];
    const v1 = calculateFleetStandings([fleet], comps, races, finishesV1, [], 'seriesEntries', [rs('r1'), rs('r2')]);
    const v2 = calculateFleetStandings([fleet], comps, races, finishesV2, [], 'seriesEntries', [rs('r1'), rs('r2')]);

    const a_r2_v1 = v1.fleetStandings[0].nhcRaceScoresByRaceId!.get('r2')!.get('A')!.tcfApplied!;
    const a_r2_v2 = v2.fleetStandings[0].nhcRaceScoresByRaceId!.get('r2')!.get('A')!.tcfApplied!;
    expect(a_r2_v1).not.toBe(a_r2_v2);
  });

  it('rejects competitors without nhcStartingTcf even with no races', () => {
    const fleet = nhcFleet();
    const comps = [nhcComp('A', 1.0), nhcComp('B')]; // B has no starting TCF
    const { fleetStandings } = calculateFleetStandings([fleet], comps, [], [], [], 'seriesEntries', []);
    const r = fleetStandings[0];
    expect(r.rejections.length).toBe(1);
    expect(r.rejections[0].competitorId).toBe('B');
    expect(r.rejections[0].reason).toBe('no_starting_tcf');
    expect(r.standings.find((s) => s.competitor.id === 'B')).toBeUndefined();
    expect(r.standings.find((s) => s.competitor.id === 'A')).toBeDefined();
  });
});

// ─── Per-fleet stated RDG / DPI points (multi-fleet competitors) ─────────────

describe('per-fleet stated RDG / DPI points', () => {
  const scratchFleet = (id: string, displayOrder: number): Fleet => ({
    id, seriesId: 's1', name: id, displayOrder, scoringSystem: 'scratch',
  });
  const comp = (id: string, fleetIds: string[]): Competitor => ({
    id, seriesId: 's1', fleetIds, sailNumber: id, name: id, club: '', gender: '', age: null, createdAt: 0,
  });
  const finish = (raceId: string, competitorId: string, over: Partial<Finish>): Finish => ({
    ...makeFinish(raceId, competitorId, null), ...over,
  });

  // Tandem boat T scored in two fleets; fillers keep each fleet non-trivial.
  const fleets = [scratchFleet('f-irc', 0), scratchFleet('f-echo', 1)];
  const competitors = [
    comp('T', ['f-irc', 'f-echo']),
    comp('A', ['f-irc']), comp('B', ['f-irc']), comp('C', ['f-irc']), comp('D', ['f-irc']),
    comp('E', ['f-echo']), comp('F', ['f-echo']), comp('G', ['f-echo']), comp('H', ['f-echo']),
  ];

  function pointsFor(result: ReturnType<typeof calculateFleetStandings>, fleetId: string, compId: string): number {
    const fs = result.fleetStandings.find((e) => e.fleet.id === fleetId)!;
    return fs.standings.find((s) => s.competitor.id === compId)!.racePoints[0];
  }
  function rejectionsFor(result: ReturnType<typeof calculateFleetStandings>, fleetId: string) {
    return result.fleetStandings.find((e) => e.fleet.id === fleetId)!.rejections;
  }

  it('applies a different stated redress value in each fleet', () => {
    const races = [makeRace('r1', 1)];
    const finishes = [
      finish('r1', 'T', { sortOrder: 1, resultCode: 'RDG', redressMethod: 'stated', redressPointsByFleet: { 'f-irc': 8, 'f-echo': 2 } }),
      makeFinish('r1', 'A', 2), makeFinish('r1', 'B', 3), makeFinish('r1', 'C', 4), makeFinish('r1', 'D', 5),
      makeFinish('r1', 'E', 2), makeFinish('r1', 'F', 3), makeFinish('r1', 'G', 4), makeFinish('r1', 'H', 5),
    ];
    const result = calculateFleetStandings(fleets, competitors, races, finishes);
    expect(pointsFor(result, 'f-irc', 'T')).toBe(8);
    expect(pointsFor(result, 'f-echo', 'T')).toBe(2);
    expect(rejectionsFor(result, 'f-irc')).toHaveLength(0);
    expect(rejectionsFor(result, 'f-echo')).toHaveLength(0);
  });

  it('applies a different DPI points value in each fleet', () => {
    const races = [makeRace('r1', 1)];
    const finishes = [
      finish('r1', 'T', { sortOrder: 1, penaltyCode: 'DPI', penaltyOverrideByFleet: { 'f-irc': 3, 'f-echo': 1 } }),
      makeFinish('r1', 'A', 2), makeFinish('r1', 'B', 3), makeFinish('r1', 'C', 4), makeFinish('r1', 'D', 5),
      makeFinish('r1', 'E', 2), makeFinish('r1', 'F', 3), makeFinish('r1', 'G', 4), makeFinish('r1', 'H', 5),
    ];
    const result = calculateFleetStandings(fleets, competitors, races, finishes);
    // base 1 point for first place; DPI adds the per-fleet value (cap = DNF = 6).
    expect(pointsFor(result, 'f-irc', 'T')).toBe(4);
    expect(pointsFor(result, 'f-echo', 'T')).toBe(2);
  });

  it('RDG gap (a fleet with no stated value) falls back to the A9 average and flags it', () => {
    const races = [makeRace('r1', 1), makeRace('r2', 2)];
    const finishes = [
      // Race 1: T gets RDG stated, but only IRC has a value — ECHO is a gap.
      finish('r1', 'T', { sortOrder: 1, resultCode: 'RDG', redressMethod: 'stated', redressPointsByFleet: { 'f-irc': 8 } }),
      makeFinish('r1', 'A', 2), makeFinish('r1', 'B', 3), makeFinish('r1', 'C', 4), makeFinish('r1', 'D', 5),
      makeFinish('r1', 'E', 2), makeFinish('r1', 'F', 3), makeFinish('r1', 'G', 4), makeFinish('r1', 'H', 5),
      // Race 2: T wins both fleets (1 point), so its A9 average over other races is 1.
      makeFinish('r2', 'T', 1),
      makeFinish('r2', 'A', 2), makeFinish('r2', 'B', 3), makeFinish('r2', 'C', 4), makeFinish('r2', 'D', 5),
      makeFinish('r2', 'E', 2), makeFinish('r2', 'F', 3), makeFinish('r2', 'G', 4), makeFinish('r2', 'H', 5),
    ];
    const result = calculateFleetStandings(fleets, competitors, races, finishes);
    expect(pointsFor(result, 'f-irc', 'T')).toBe(8);   // stated value honoured
    expect(pointsFor(result, 'f-echo', 'T')).toBe(1);  // gap → A9 average of race 2
    expect(rejectionsFor(result, 'f-irc')).toHaveLength(0);
    expect(rejectionsFor(result, 'f-echo')).toEqual([{ competitorId: 'T', reason: 'rdg_missing_fleet_points' }]);
  });

  it('DPI gap (a fleet with no value) applies no penalty and flags it', () => {
    const races = [makeRace('r1', 1)];
    const finishes = [
      finish('r1', 'T', { sortOrder: 1, penaltyCode: 'DPI', penaltyOverrideByFleet: { 'f-irc': 3 } }),
      makeFinish('r1', 'A', 2), makeFinish('r1', 'B', 3), makeFinish('r1', 'C', 4), makeFinish('r1', 'D', 5),
      makeFinish('r1', 'E', 2), makeFinish('r1', 'F', 3), makeFinish('r1', 'G', 4), makeFinish('r1', 'H', 5),
    ];
    const result = calculateFleetStandings(fleets, competitors, races, finishes);
    expect(pointsFor(result, 'f-irc', 'T')).toBe(4);   // 1 + 3
    expect(pointsFor(result, 'f-echo', 'T')).toBe(1);  // gap → no penalty
    expect(rejectionsFor(result, 'f-irc')).toHaveLength(0);
    expect(rejectionsFor(result, 'f-echo')).toEqual([{ competitorId: 'T', reason: 'dpi_missing_fleet_points' }]);
  });

  it('a uniform scalar still applies to every fleet (no per-fleet map)', () => {
    const races = [makeRace('r1', 1)];
    const finishes = [
      finish('r1', 'T', { sortOrder: 1, resultCode: 'RDG', redressMethod: 'stated', redressPoints: 5 }),
      makeFinish('r1', 'A', 2), makeFinish('r1', 'B', 3), makeFinish('r1', 'C', 4), makeFinish('r1', 'D', 5),
      makeFinish('r1', 'E', 2), makeFinish('r1', 'F', 3), makeFinish('r1', 'G', 4), makeFinish('r1', 'H', 5),
    ];
    const result = calculateFleetStandings(fleets, competitors, races, finishes);
    expect(pointsFor(result, 'f-irc', 'T')).toBe(5);
    expect(pointsFor(result, 'f-echo', 'T')).toBe(5);
    expect(rejectionsFor(result, 'f-irc')).toHaveLength(0);
    expect(rejectionsFor(result, 'f-echo')).toHaveLength(0);
  });
});

// ─── RDG pool is reorder-stable (redress references races by id) ──────────────

describe('RDG pool is reorder-stable', () => {
  // Mirrors the 10-rdg-pool-restricted fixture: Alice (a) is granted A9(a)
  // redress in race r3, excluding r1 from the pool. Her average is over r2 and
  // r4 (1 pt each) = 1.0. Because redress references races by id, renumbering
  // the races (a reorder/insert) must not disturb the pool.
  const competitors = ['a', 'b', 'c'].map((id) => makeCompetitor(id));
  const finishes: Finish[] = [
    makeFinish('r1', 'a', 3), makeFinish('r1', 'b', 2), makeFinish('r1', 'c', 1),
    makeFinish('r2', 'a', 1), makeFinish('r2', 'b', 2), makeFinish('r2', 'c', 3),
    { ...makeFinish('r3', 'a', 3, 'RDG'), redressMethod: 'all_races', redressExcludeRaceIds: ['r1'] },
    makeFinish('r3', 'b', 1), makeFinish('r3', 'c', 2),
    makeFinish('r4', 'a', 1), makeFinish('r4', 'b', 2), makeFinish('r4', 'c', 3),
  ];

  const rdgValue = (races: Race[]): number => {
    const { standings } = calculateStandings(competitors, races, finishes, []);
    const alice = standings.find((s) => s.competitor.id === 'a')!;
    const rdgIdx = alice.raceCodes.findIndex((code) => code === 'RDG');
    return alice.racePoints[rdgIdx];
  };

  it('gives the documented 1.0 average in the natural race order', () => {
    const races = [makeRace('r1', 1), makeRace('r2', 2), makeRace('r3', 3), makeRace('r4', 4)];
    expect(rdgValue(races)).toBe(1.0);
  });

  it('is unchanged when the races are renumbered into a different order', () => {
    // Same race ids, different numbers (a full reorder): r4,r3,r2,r1 → 1..4.
    const reordered = [makeRace('r4', 1), makeRace('r3', 2), makeRace('r2', 3), makeRace('r1', 4)];
    expect(rdgValue(reordered)).toBe(1.0);
  });

  it('is unchanged when a new race is inserted ahead of the pool', () => {
    // Inserting a make-up race at the front pushes every number up by one; the
    // excluded race (r1) and the pool (r2, r4) are still selected by id.
    const withInsert = [
      makeRace('r-new', 1),
      makeRace('r1', 2), makeRace('r2', 3), makeRace('r3', 4), makeRace('r4', 5),
    ];
    const withInsertFinishes = [...finishes, makeFinish('r-new', 'a', 1), makeFinish('r-new', 'b', 2), makeFinish('r-new', 'c', 3)];
    const { standings } = calculateStandings(competitors, withInsert, withInsertFinishes, []);
    const alice = standings.find((s) => s.competitor.id === 'a')!;
    const rdgIdx = alice.raceCodes.findIndex((code) => code === 'RDG');
    expect(alice.racePoints[rdgIdx]).toBe(1.0);
  });
});
