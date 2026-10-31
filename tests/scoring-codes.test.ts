import { describe, it, expect } from 'vitest';
import { calculateRaceScores, calculateStandings } from '@/lib/scoring';
import { buildCodeTable, type SeriesScoringCode } from '@/lib/scoring-codes';
import type { Competitor, Finish, PenaltyCode, Race, ResultCode } from '@/lib/types';

// The series' own codes aren't in the RRS code types.
const result = (code: string) => code as ResultCode;
const penalty = (code: string) => code as PenaltyCode;

function makeCompetitor(id: string): Competitor {
  return { id, seriesId: 's1', fleetIds: ['f1'], sailNumber: id, names: [id], clubs: [], gender: '', age: null, createdAt: 0 };
}

function makeFinish(
  competitorId: string,
  sortOrder: number | null,
  resultCode: string | null = null,
  extra: Partial<Finish> = {},
): Finish {
  return {
    id: `r1-${competitorId}`, raceId: 'r1', competitorId, sortOrder, resultCode: resultCode === null ? null : result(resultCode), startPresent: null,
    penaltyCode: null, penaltyOverride: null, redressMethod: null, redressExcludeRaceIds: null,
    redressIncludeRaceIds: null, tiedWithPrevious: false, redressIncludeAllLater: false, redressPoints: null,
    ...extra,
  };
}

// Ten boats entered; seven come to the start, four finish.
const competitors = 'ABCDEFGHIJ'.split('').map(makeCompetitor);
const sheet = (codes: Record<string, string>): Finish[] => [
  makeFinish('A', 1),
  makeFinish('B', 2),
  makeFinish('C', 3),
  makeFinish('D', 4),
  makeFinish('E', null, codes.E ?? 'DNF'),
  makeFinish('F', null, codes.F ?? 'DNS'),
  makeFinish('G', null, codes.G ?? 'OCS'),
  // H, I and J have no row: implicit DNC.
];

const TLE: SeriesScoringCode = {
  code: 'TLE',
  description: 'Time limit expired (SI 16.1)',
  kind: 'replace',
  rule: { type: 'placeAfter', base: 'finishers', plus: 1 },
  capAtDnf: true,
  discardable: true,
};

describe('the built-in codes, described the RRS way', () => {
  it('scores DNS to BFD as DNF, and DNC on the boats entered, under A5.2', () => {
    const scores = calculateRaceScores(sheet({}), competitors, buildCodeTable('seriesEntries'));
    expect(scores.get('E')?.points).toBe(11);
    expect(scores.get('F')?.points).toBe(11);
    expect(scores.get('H')?.points).toBe(11);
  });

  it('scores the DNF group on the starting area, and DNC on the boats entered, under A5.3', () => {
    const scores = calculateRaceScores(sheet({}), competitors, buildCodeTable('startingArea'));
    expect(scores.get('E')?.points).toBe(8);
    expect(scores.get('G')?.points).toBe(8);
    expect(scores.get('H')?.points).toBe(11);
  });

  it('accepts the A5 rule alone, as callers always have', () => {
    const viaTable = calculateRaceScores(sheet({}), competitors, buildCodeTable('startingArea'));
    const viaRule = calculateRaceScores(sheet({}), competitors, 'startingArea');
    expect([...viaRule.values()]).toEqual([...viaTable.values()]);
  });
});

describe('a series code that replaces the result', () => {
  it('scores the place after the finishers', () => {
    const scores = calculateRaceScores(sheet({ E: 'TLE' }), competitors, buildCodeTable('seriesEntries', [TLE]));
    expect(scores.get('E')?.points).toBe(5);
    expect(scores.get('E')?.resultCode).toBe('TLE');
  });

  it('never scores more than DNF when capped', () => {
    // Nobody finished: the place after the finishers is 1 + 0, but under a
    // rule that adds 20 it would pass DNF's 11 — the cap holds it there.
    const wide: SeriesScoringCode = { ...TLE, rule: { type: 'placeAfter', base: 'finishers', plus: 20 } };
    const scores = calculateRaceScores(sheet({ E: 'TLE' }), competitors, buildCodeTable('seriesEntries', [wide]));
    expect(scores.get('E')?.points).toBe(11);
  });

  it('scores a fixed number of points', () => {
    const fixed: SeriesScoringCode = { code: 'OOD', description: 'Race officer duty', kind: 'replace', rule: { type: 'fixedPoints', points: 3 }, discardable: true };
    const scores = calculateRaceScores(sheet({ E: 'OOD' }), competitors, buildCodeTable('seriesEntries', [fixed]));
    expect(scores.get('E')?.points).toBe(3);
  });

  it('counts the boat as having come to the start unless it scores as DNC', () => {
    const asDnc: SeriesScoringCode = { code: 'xDNC', description: 'Excused', kind: 'replace', rule: { type: 'sameAs', code: 'DNC' }, discardable: true };
    const table = buildCodeTable('startingArea', [TLE, asDnc]);
    expect(table.cameToStart('TLE')).toBe(true);
    expect(table.cameToStart('xDNC')).toBe(false);
    // F scored xDNC no longer counts in the starting area: 6 + 1.
    const scores = calculateRaceScores(sheet({ F: 'xDNC' }), competitors, table);
    expect(scores.get('E')?.points).toBe(7);
    expect(scores.get('F')?.points).toBe(11);
  });

  it('can be made non-discardable', () => {
    const races: Race[] = [1, 2, 3].map((n) => ({ id: `r${n}`, seriesId: 's1', raceNumber: n, name: null, date: '2026-11-01', createdAt: 0 }));
    const boats = [makeCompetitor('A'), makeCompetitor('B')];
    const finishes: Finish[] = races.flatMap((r) => [
      { ...makeFinish('A', 1), id: `${r.id}-A`, raceId: r.id, ...(r.raceNumber === 3 ? { sortOrder: null, resultCode: result('XPA') } : {}) },
      { ...makeFinish('B', 2), id: `${r.id}-B`, raceId: r.id },
    ]);
    const xpa: SeriesScoringCode = { code: 'XPA', description: 'Penalty accepted', kind: 'replace', rule: { type: 'fixedPoints', points: 9 }, discardable: false };
    const { standings } = calculateStandings(boats, races, finishes, [{ minRaces: 3, discardCount: 1 }], buildCodeTable('seriesEntries', [xpa]));
    const a = standings.find((s) => s.competitor.id === 'A')!;
    expect(a.raceDiscards[2]).toBe(false);
    expect(a.netPoints).toBe(10);
  });
});

describe('a series code that adds to the finishing place', () => {
  it('adds its points, capped at DNF, leaving other boats alone', () => {
    const sop: SeriesScoringCode = { code: 'SOP', description: 'Failed to sign out (SI 19.1)', kind: 'add', rule: { type: 'addPoints', points: 2 }, discardable: true };
    const finishes = sheet({}).map((f) => (f.competitorId === 'B' ? { ...f, penaltyCode: penalty('SOP') } : f));
    const scores = calculateRaceScores(finishes, competitors, buildCodeTable('seriesEntries', [sop]));
    expect(scores.get('B')?.points).toBe(4);
    expect(scores.get('C')?.points).toBe(3);
  });
});

describe('a changed built-in code', () => {
  it('moves the codes scored as DNF with it', () => {
    const dnf: SeriesScoringCode = { code: 'DNF', kind: 'replace', rule: { type: 'placeAfter', base: 'finishers', plus: 1 }, discardable: true };
    const scores = calculateRaceScores(sheet({}), competitors, buildCodeTable('seriesEntries', [dnf]));
    expect(scores.get('E')?.points).toBe(5);
    expect(scores.get('F')?.points).toBe(5);
    expect(scores.get('H')?.points).toBe(11);
  });

  it('keeps DNC out of the starting area when it scores as DNF', () => {
    const dnc: SeriesScoringCode = { code: 'DNC', kind: 'replace', rule: { type: 'sameAs', code: 'DNF' }, discardable: true };
    const table = buildCodeTable('startingArea', [dnc]);
    expect(table.cameToStart('DNC')).toBe(false);
    const scores = calculateRaceScores(sheet({}), competitors, table);
    expect(scores.get('H')?.points).toBe(8);
  });

  it('matches the DBSC rule it replaces', () => {
    const dnc: SeriesScoringCode = { code: 'DNC', kind: 'replace', rule: { type: 'sameAs', code: 'DNF' }, discardable: true };
    const changed = calculateRaceScores(sheet({}), competitors, buildCodeTable('startingArea', [dnc]));
    const dbsc = calculateRaceScores(sheet({}), competitors, 'startingAreaInclDnc');
    expect([...changed.values()]).toEqual([...dbsc.values()]);
  });

  it('changes ZFP’s percentage', () => {
    const zfp: SeriesScoringCode = { code: 'ZFP', kind: 'add', rule: { type: 'addPercent', percent: 10 }, discardable: true };
    const finishes = sheet({}).map((f) => (f.competitorId === 'B' ? { ...f, penaltyCode: penalty('ZFP') } : f));
    // 10% of DNF's 11 is 1.1, on top of second place.
    const scores = calculateRaceScores(finishes, competitors, buildCodeTable('seriesEntries', [zfp]));
    expect(scores.get('B')?.points).toBe(3.1);
  });
});
