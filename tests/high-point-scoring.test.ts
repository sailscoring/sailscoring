/**
 * High-point scoring in the engine: the two formulas, the fleet size each
 * race is scored from, the code defaults per formula, and the standings'
 * direction — discards, order and tie-break all reversed.
 */
import { describe, it, expect } from 'vitest';
import { applyScoringPenalty, calculateRaceScores, calculateStandings } from '@/lib/scoring';
import { buildCodeTable, seriesCodeProblems, seriesCodeTable } from '@/lib/scoring-codes';
import { chips3, highPointOf, highPointPlacePoints, highPointPlaceStep, lowPointRefusal, type HighPointScoring } from '@/lib/high-point';
import { weightedRacePoints } from '@/lib/race-scoring-options';
import type { Competitor, Finish, Race, SeriesScoringCode } from '@/lib/types';

const BOATS_BEATEN: HighPointScoring = { formula: 'boatsBeaten', pointForComingToStart: false };
const HP_SCORING: HighPointScoring = { formula: 'boatsBeaten', pointForComingToStart: true };
const CHIPS3: HighPointScoring = { formula: 'chips3', pointForComingToStart: false };

const tenth = (x: number) => weightedRacePoints(x, 1);

function competitor(id: string): Competitor {
  return { id, seriesId: 's', fleetIds: ['f'], sailNumber: id, names: [id], clubs: [], gender: '', age: null, createdAt: 0 };
}

function race(n: number, pointsMultiplier?: number): Race {
  return { id: `r${n}`, seriesId: 's', raceNumber: n, name: null, date: '2026-01-01', createdAt: 0, ...(pointsMultiplier ? { pointsMultiplier } : {}) };
}

function finish(raceId: string, competitorId: string, opts: { place?: number; code?: string; tied?: boolean; redressPoints?: number } = {}): Finish {
  return {
    id: `${raceId}-${competitorId}`, raceId, competitorId,
    sortOrder: opts.place ?? null, tiedWithPrevious: opts.tied ?? false,
    resultCode: opts.code ?? null, startPresent: null, penaltyCode: null, penaltyOverride: null,
    redressMethod: opts.redressPoints != null ? 'stated' : null, redressExcludeRaceIds: null, redressIncludeRaceIds: null,
    redressIncludeAllLater: false, redressPoints: opts.redressPoints ?? null,
  };
}

/** One race: the boats in order, then coded boats, as [id, code] pairs. */
function scoreRace(hp: HighPointScoring, order: string[], coded: [string, string][] = [], absent: string[] = [], codes: SeriesScoringCode[] = []) {
  const boats = [...order, ...coded.map(([id]) => id), ...absent].map(competitor);
  const finishes = [
    ...order.map((id, i) => finish('r1', id, { place: i + 1 })),
    ...coded.map(([id, code]) => finish('r1', id, { code })),
  ];
  const scores = calculateRaceScores(finishes, boats, buildCodeTable('seriesEntries', codes, hp));
  return (id: string) => scores.get(id)!.points;
}

describe('CHIPS3', () => {
  it('scores a lone boat 86.1 and a win nearer 100 the bigger the fleet', () => {
    expect(tenth(chips3(1, 1))).toBe(86.1);
    expect([2, 5, 10, 20].map((n) => tenth(chips3(1, n)))).toEqual([88.2, 92.7, 96.8, 99.4]);
    expect(tenth(chips3(1, 30))).toBe(99.9);
  });

  it('scores the last finisher and the place after the last as the settings preview shows', () => {
    expect([2, 5, 10, 20].map((n) => tenth(chips3(n, n)))).toEqual([74.6, 50.1, 27.9, 12.6]);
    expect([2, 5, 10, 20].map((n) => tenth(chips3(n + 1, n)))).toEqual([61.0, 39.4, 20.3, 8.0]);
  });
});

describe('boats beaten', () => {
  it('scores n + 1 − place, and the place after the last 0', () => {
    expect([1, 2, 10].map((p) => highPointPlacePoints(BOATS_BEATEN, p, 10))).toEqual([10, 9, 1]);
    expect(highPointPlacePoints(BOATS_BEATEN, 11, 10)).toBe(0);
  });

  it('adds a point for coming to the start, so the place after the last scores 1', () => {
    expect(highPointPlacePoints(HP_SCORING, 1, 10)).toBe(11);
    expect(highPointPlacePoints(HP_SCORING, 11, 10)).toBe(1);
  });
});

describe('a race scored high point', () => {
  it('counts finishers and DNFs in n, not DNCs or boats with no result', () => {
    // Bray's Sunday race 4 shape: seven finishers, two DNFs, n = 9.
    const points = scoreRace(HP_SCORING, ['a', 'b', 'c', 'd', 'e', 'f', 'g'], [['h', 'DNF'], ['i', 'DNF'], ['j', 'DNC']], ['k']);
    expect(['a', 'g', 'h', 'j', 'k'].map(points)).toEqual([10, 4, 1, 0, 0]);
  });

  it('averages the points of tied places', () => {
    const boats = ['a', 'b', 'c', 'd'].map(competitor);
    const finishes = [
      finish('r1', 'a', { place: 1 }), finish('r1', 'b', { place: 2 }),
      finish('r1', 'c', { place: 3, tied: true }), finish('r1', 'd', { place: 4 }),
    ];
    const scores = calculateRaceScores(finishes, boats, buildCodeTable('seriesEntries', [], BOATS_BEATEN));
    expect(['a', 'b', 'c', 'd'].map((id) => scores.get(id)!.points)).toEqual([4, 2.5, 2.5, 1]);
  });

  it('under boats beaten, counts an OCS and scores it the place after the last', () => {
    const points = scoreRace(HP_SCORING, ['a', 'b', 'c', 'd', 'e', 'f'], [['o', 'OCS']]);
    expect([points('a'), points('o')]).toEqual([8, 1]);
  });

  it('under CHIPS3, scores a disqualification 0 and leaves a DNS out of n', () => {
    const points = scoreRace(CHIPS3, ['a', 'b', 'c', 'd', 'e', 'f'], [['s', 'DNS'], ['o', 'OCS'], ['r', 'RET']]);
    // n = 6 finishers + OCS + RET = 8.
    expect(points('a')).toBeCloseTo(chips3(1, 8), 10);
    expect(points('r')).toBeCloseTo(chips3(9, 8), 10);
    expect([points('s'), points('o')]).toEqual([0, 0]);
  });

  it('counts a series code marked to count, at its fixed points', () => {
    const dtp: SeriesScoringCode = { code: 'DTP', description: 'Declared, did not race', kind: 'replace', rule: { type: 'fixedPoints', points: 8 }, discardable: true, countsInFleetSize: true };
    // ISORA 2026 race 01CW1: five finishers and two DTPs make n = 7.
    const points = scoreRace(CHIPS3, ['a', 'b', 'c', 'd', 'e'], [['x', 'DTP'], ['y', 'DTP']], [], [dtp]);
    expect(weightedRacePoints(points('a'), 0.7)).toBe(66.3);
    expect(weightedRacePoints(points('x'), 0.7)).toBe(5.6);
  });

  it('lets a series change whether a built-in counts', () => {
    const dns: SeriesScoringCode = { code: 'DNS', kind: 'replace', rule: { type: 'fixedPoints', points: 1 }, discardable: true };
    // Bray's Sailwave-era race 1: six finishers and five DNS, DNS fixed 1, no start point.
    const points = scoreRace(BOATS_BEATEN, ['a', 'b', 'c', 'd', 'e', 'f'], [['p', 'DNS'], ['q', 'DNS'], ['r', 'DNS'], ['s', 'DNS'], ['t', 'DNS']], [], [dns]);
    expect([points('a'), points('f'), points('p')]).toEqual([11, 6, 1]);
    const uncounted = scoreRace(BOATS_BEATEN, ['a', 'b'], [['p', 'DNS']], [], [{ ...dns, countsInFleetSize: false }]);
    expect(uncounted('a')).toBe(2);
  });
});

describe('high-point standings', () => {
  const boats = ['a', 'b', 'c'].map(competitor);
  const codes = buildCodeTable('seriesEntries', [], BOATS_BEATEN);

  it('ranks the highest total first and discards the lowest score', () => {
    const races = [race(1), race(2), race(3)];
    const finishes = [
      finish('r1', 'a', { place: 1 }), finish('r1', 'b', { place: 2 }), finish('r1', 'c', { place: 3 }),
      finish('r2', 'b', { place: 1 }), finish('r2', 'a', { place: 2 }), finish('r2', 'c', { place: 3 }),
      finish('r3', 'a', { place: 1 }), finish('r3', 'c', { place: 2 }),
    ];
    const { standings } = calculateStandings(boats, races, finishes, [{ minRaces: 3, discardCount: 1 }], codes);
    expect(standings.map((s) => s.competitor.id)).toEqual(['a', 'b', 'c']);
    const a = standings[0];
    expect(a.racePoints).toEqual([3, 2, 2]);
    // Two equal lowest scores: the earlier race goes.
    expect(a.raceDiscards).toEqual([false, true, false]);
    expect(a.netPoints).toBe(5);
    // b missed race 3: a DNC scores 0, and is what she discards.
    expect(standings[1].racePoints).toEqual([2, 3, 0]);
    expect(standings[1].raceDiscards).toEqual([false, false, true]);
  });

  it('breaks a tie on the best counted scores, the highest first, then the last race', () => {
    const races = [race(1), race(2)];
    const finishes = [
      finish('r1', 'a', { place: 1 }), finish('r1', 'b', { place: 2 }), finish('r1', 'c', { place: 3 }),
      finish('r2', 'b', { place: 1 }), finish('r2', 'a', { place: 2 }), finish('r2', 'c', { place: 3 }),
    ];
    const { standings } = calculateStandings(boats, races, finishes, [], codes);
    // a and b are 5 each with a 3 and a 2: A8.1 can't part them, and b won
    // the last race.
    expect(standings.map((s) => [s.competitor.id, s.netPoints, s.rank])).toEqual([['b', 5, 1], ['a', 5, 2], ['c', 2, 3]]);
  });

  it('rounds each race once, after its weighting', () => {
    const chipsCodes = buildCodeTable('seriesEntries', [], CHIPS3);
    const finishes = [finish('r1', 'a', { place: 1 }), finish('r1', 'b', { place: 2 }), finish('r1', 'c', { place: 3 })];
    const { standings } = calculateStandings(boats, [race(1, 0.7)], finishes, [], chipsCodes);
    // 2nd of 3 is 77.4996 × 0.7 = 54.25 → 54.2. Rounding CHIPS3 to 77.5
    // first would give 54.3.
    expect(standings.find((s) => s.competitor.id === 'b')!.racePoints[0]).toBe(54.2);
  });

  it('counts a race nobody finished when its boats have results that count', () => {
    const dtp: SeriesScoringCode = { code: 'DTP', description: 'Declared, did not race', kind: 'replace', rule: { type: 'fixedPoints', points: 8 }, discardable: true, countsInFleetSize: true };
    const dtpCodes = buildCodeTable('seriesEntries', [dtp], CHIPS3);
    const finishes = [finish('r1', 'a', { code: 'DTP' }), finish('r1', 'b', { code: 'DTP' })];
    const { standings } = calculateStandings(boats, [race(1, 1.2)], finishes, [], dtpCodes);
    const a = standings.find((s) => s.competitor.id === 'a')!;
    expect(a.raceExcluded).toEqual([false]);
    expect(a.racePoints).toEqual([9.6]);
    // A race with nothing but DNCs in it is struck, as an abandoned one is.
    const struck = calculateStandings(boats, [race(1)], [finish('r1', 'a', { code: 'DNC' })], [], dtpCodes).standings[0];
    expect(struck.raceExcluded).toEqual([true]);
  });

  it('leaves a boat given redress out of n', () => {
    const four = ['a', 'b', 'c', 'd'].map(competitor);
    const finishes = [
      finish('r1', 'a', { place: 1 }), finish('r1', 'b', { place: 2 }), finish('r1', 'c', { place: 3 }),
      finish('r1', 'd', { code: 'RDG', redressPoints: 2.7 }),
    ];
    const { standings } = calculateStandings(four, [race(1)], finishes, [], buildCodeTable('seriesEntries', [], HP_SCORING));
    expect(standings.map((s) => [s.competitor.id, s.racePoints[0]])).toEqual([['a', 4], ['b', 3], ['d', 2.7], ['c', 2]]);
  });
});

describe('the series code table', () => {
  it('reads the points system off the series', () => {
    expect(seriesCodeTable({ dnfScoring: 'seriesEntries' }).highPoint).toBeUndefined();
    expect(seriesCodeTable({ dnfScoring: 'seriesEntries', pointsSystem: 'highPoint' }).highPoint).toEqual(BOATS_BEATEN);
    expect(highPointOf({ pointsSystem: 'highPoint', highPointFormula: 'chips3', pointForComingToStart: true })).toEqual(CHIPS3);
  });

  it('defaults the built-ins per formula', () => {
    const counts = { entries: 12, startingArea: 11, finishers: 8, fleetSize: 10 };
    const bb = buildCodeTable('seriesEntries', [], HP_SCORING);
    expect(['DNC', 'DNF', 'RET', 'DNS', 'OCS', 'DSQ'].map((c) => bb.replacePoints(c, counts))).toEqual([0, 1, 1, 1, 1, 1]);
    expect(['DNC', 'DNS', 'RDG'].map((c) => bb.countsInFleetSize(c))).toEqual([false, true, false]);
    const ch = buildCodeTable('seriesEntries', [], CHIPS3);
    expect(tenth(ch.replacePoints('DNF', counts)!)).toBe(20.3);
    expect(tenth(ch.replacePoints('RET', counts)!)).toBe(20.3);
    expect(['DNC', 'DNS', 'OCS', 'DSQ', 'BFD'].map((c) => ch.replacePoints(c, counts))).toEqual([0, 0, 0, 0, 0]);
    expect(['DNS', 'OCS'].map((c) => ch.countsInFleetSize(c))).toEqual([false, true]);
  });
});

describe('the scoring codes, as a high-point series reads them', () => {
  it('lists the built-ins at their high-point defaults', async () => {
    const { codeRows, ruleShortText, ruleSentence } = await import('@/lib/scoring-codes-text');
    const rows = codeRows('seriesEntries', [], CHIPS3);
    expect(rows.add.map((r) => [r.code, r.status, ruleShortText(r.scored, CHIPS3)])).toEqual([
      ['ZFP', 'rrs', '20% of the place after the last'],
    ]);
    expect(ruleSentence(rows.add[0].scored, CHIPS3)).toBe(
      'A boat scored ZFP is scored as if she had finished lower by 20% of the place after the last boat in her fleet’s race, to the nearest tenth of a place, but is never scored worse than DNF. Other boats’ scores are unchanged. It can be discarded.',
    );
    const byCode = new Map(rows.replace.map((r) => [r.code, r]));
    expect(ruleShortText(byCode.get('DNF')!.scored, CHIPS3)).toBe('the place after the last');
    expect(ruleShortText(byCode.get('DNS')!.scored, CHIPS3)).toBe('0 points · not in the fleet size');
    expect(ruleShortText(byCode.get('OCS')!.scored, CHIPS3)).toBe('0 points');
    expect([...byCode.values()].every((r) => r.status === 'rrs')).toBe(true);
  });

  it('marks a code changed when only its fleet-size answer differs', async () => {
    const { codesSummary } = await import('@/lib/scoring-codes-text');
    const dns: SeriesScoringCode = { code: 'DNS', kind: 'replace', rule: { type: 'fixedPoints', points: 0 }, discardable: true, countsInFleetSize: true };
    expect(codesSummary('seriesEntries', [dns], CHIPS3)).toEqual({ added: [], changed: ['DNS'] });
    expect(codesSummary('seriesEntries', [{ ...dns, countsInFleetSize: undefined }], CHIPS3)).toEqual({ added: [], changed: [] });
  });

  it('previews what a code scores in a 10-boat race', async () => {
    const { highPointCodePreview, highPointPreview } = await import('@/lib/scoring-codes-text');
    const dnf: SeriesScoringCode = { code: 'DNF', kind: 'replace', rule: { type: 'placeAfter', base: 'entries', plus: 1 }, discardable: true };
    expect(highPointCodePreview(dnf, 'seriesEntries', [], CHIPS3)).toBe(20.3);
    expect(highPointCodePreview(dnf, 'seriesEntries', [], HP_SCORING)).toBe(1);
    expect(highPointPreview('seriesEntries', [], HP_SCORING)).toEqual({
      sizes: [2, 5, 10, 20], first: [3, 6, 11, 21], last: [2, 2, 2, 2], dnf: [1, 1, 1, 1],
    });
  });
});

describe('a penalty in high point', () => {
  const penalised = (over: Partial<Finish>): Finish => ({ ...finish('r1', 'a', { place: 3 }), ...over });
  const SOP: SeriesScoringCode = { code: 'SOP', description: 'Failed to sign out', kind: 'add', rule: { type: 'addPoints', points: 2 }, discardable: true };

  it('is worth a point a place under boats beaten, and CHIPS3’s gap between places', () => {
    expect(highPointPlaceStep(BOATS_BEATEN, 10)).toBe(1);
    expect(highPointPlaceStep(CHIPS3, 20)).toBeCloseTo(chips3(1, 20) - chips3(2, 20), 10);
    expect(highPointPlaceStep(CHIPS3, 20)).toBeCloseTo(chips3(19, 20) - chips3(20, 20), 10);
  });

  it('takes off under boats beaten exactly what low point adds', () => {
    // 10 boats, 3rd: low point 3 + 20% of 11 = 5.2; boats beaten 8 − 2.2 = 5.8.
    const hp = buildCodeTable('seriesEntries', [SOP], BOATS_BEATEN);
    const lp = buildCodeTable('seriesEntries', [SOP]);
    for (const over of [{ penaltyCode: 'ZFP' }, { penaltyCode: 'SCP', penaltyOverride: 30 }, { penaltyCode: 'DPI', penaltyOverride: 4 }, { penaltyCode: 'SOP' }] as Partial<Finish>[]) {
      const low = applyScoringPenalty(3, penalised(over), 11, undefined, lp);
      const high = applyScoringPenalty(8, penalised(over), 0, undefined, hp, 10);
      expect(high, String(over.penaltyCode)).toBeCloseTo(11 - low, 10);
    }
  });

  it('takes a percentage in places under CHIPS3', () => {
    const codes = buildCodeTable('seriesEntries', [], CHIPS3);
    const scored = applyScoringPenalty(chips3(3, 20), penalised({ penaltyCode: 'SCP' }), chips3(21, 20), undefined, codes, 20);
    expect(scored).toBeCloseTo(chips3(7.2, 20), 10);
  });

  it('never leaves a boat with fewer points than DNF scores, nor lifts her to it', () => {
    const codes = buildCodeTable('seriesEntries', [], CHIPS3);
    expect(applyScoringPenalty(17.2, penalised({ penaltyCode: 'ZFP' }), 15, undefined, codes, 20)).toBe(15);
    expect(applyScoringPenalty(12.6, penalised({ penaltyCode: 'ZFP' }), 15, undefined, codes, 20)).toBe(12.6);
  });

  it('takes a share of her own points for a series code that says so, whatever DNF scores', async () => {
    const { ruleSentence, ruleShortText } = await import('@/lib/scoring-codes-text');
    const CMP: SeriesScoringCode = { code: 'CMP', description: 'Finish not declared', kind: 'add', rule: { type: 'reducePercent', percent: 30 }, discardable: true };
    expect(seriesCodeProblems([CMP])).toEqual([]);
    expect(seriesCodeProblems([{ ...CMP, rule: { type: 'reducePercent', percent: 0 } }])[0].message).toBe('Enter the percentage as a number from 1 to 100, e.g. 30.');
    expect(seriesCodeProblems([{ ...CMP, kind: 'replace' }])[0].message).toBe('A code that replaces the result can’t use that rule.');

    const codes = buildCodeTable('seriesEntries', [CMP], CHIPS3);
    expect(applyScoringPenalty(90, penalised({ penaltyCode: 'CMP' }), 15, undefined, codes, 20)).toBeCloseTo(63, 10);
    expect(applyScoringPenalty(17, penalised({ penaltyCode: 'CMP' }), 15, undefined, codes, 20)).toBeCloseTo(11.9, 10);
    // Low point has no such penalty: the engine leaves the boat alone.
    expect(applyScoringPenalty(3, penalised({ penaltyCode: 'CMP' }), 11, undefined, buildCodeTable('seriesEntries', [CMP]))).toBe(3);

    expect(ruleShortText(CMP, CHIPS3)).toBe('30% of her points');
    expect(ruleSentence(CMP, CHIPS3)).toBe('A boat scored CMP loses 30% of her points for the race. Other boats’ scores are unchanged. It can be discarded.');
    expect(lowPointRefusal([CMP])).toBe('A low-point series can’t score a code that takes a share of the boat’s points (CMP). Change or remove it first.');
    expect(lowPointRefusal([SOP])).toBeNull();
  });

  it('leaves every other boat’s score alone', () => {
    const boats = ['a', 'b', 'c', 'd'].map(competitor);
    const finishes = boats.map((b, i) => finish('r1', b.id, { place: i + 1 }));
    finishes[1] = { ...finishes[1], penaltyCode: 'DPI', penaltyOverride: 2 };
    const scores = calculateRaceScores(finishes, boats, buildCodeTable('seriesEntries', [], BOATS_BEATEN));
    expect(boats.map((b) => scores.get(b.id)!.points)).toEqual([4, 1, 2, 1]);
  });
});
