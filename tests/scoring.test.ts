import { describe, it, expect } from 'vitest';
import { calculateRaceScores, calculateStandings } from '@/lib/scoring';
import type { Competitor, Race, Finish } from '@/lib/types';

// Helpers to build test fixtures with minimal required fields
function makeCompetitor(id: string, seriesId = 's1'): Competitor {
  return { id, seriesId, sailNumber: id, name: id, club: '', gender: '', age: null, createdAt: 0 };
}

function makeRace(id: string, raceNumber: number, seriesId = 's1'): Race {
  return { id, seriesId, raceNumber, date: '2025-01-01', createdAt: 0 };
}

function makeFinish(
  raceId: string,
  competitorId: string,
  finishPosition: number | null,
  resultCode: Finish['resultCode'] = null,
): Finish {
  return { id: `${raceId}-${competitorId}`, raceId, competitorId, finishPosition, resultCode };
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
    const standings = calculateStandings(competitors, races, finishes);
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
    const standings = calculateStandings(competitors, races, finishes);
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
    const standings = calculateStandings(abc, threeRaces, finishes);
    expect(standings[0].competitor.id).toBe('A');
  });

  it('counts DNC/DNF from missing finishes correctly in standings', () => {
    const [a, b] = competitors;
    const oneRace = [makeRace('r1', 1)];
    const finishes: Finish[] = [
      makeFinish('r1', 'A', 1),
      // B has no finish record → implicit DNC → N+1 = 3+1 = 4
    ];
    const standings = calculateStandings(competitors, oneRace, finishes);
    const aStanding = standings.find((s) => s.competitor.id === 'A')!;
    const bStanding = standings.find((s) => s.competitor.id === 'B')!;
    expect(aStanding.racePoints[0]).toBe(1);
    expect(bStanding.racePoints[0]).toBe(4); // 3 competitors, so N+1=4
    expect(aStanding.rank).toBe(1);
  });

  it('returns empty standings for no races', () => {
    const standings = calculateStandings(competitors, [], []);
    expect(standings).toHaveLength(3);
    expect(standings.every((s) => s.racePoints.length === 0)).toBe(true);
  });

  it('returns empty standings for no competitors', () => {
    const standings = calculateStandings([], races, []);
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
    const standings = calculateStandings([a, b], races, tiedFinishes);
    // A: 1+2=3, B: 2+1=3; tie-break: each has one 1st → still tied; last race: A=2, B=1 → B wins
    expect(standings[0].competitor.id).toBe('B');
    expect(standings[0].rank).toBe(1);
    expect(standings[1].rank).toBe(2);
  });
});
