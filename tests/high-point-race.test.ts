/**
 * The scorer's side of a high-point race: each fleet's size, the codes a
 * declared boat can be given, the boats with nothing recorded, and the
 * weighting preview in the race's scoring options.
 */
import { describe, it, expect } from 'vitest';
import { boatsWithNoResult, declaredCodes, raceFleetSizes } from '@/lib/high-point-race';
import { buildCodeTable } from '@/lib/scoring-codes';
import { highPointWeightingPreview } from '@/lib/race-scoring-options';
import type { Competitor, Finish, Fleet, SeriesScoringCode } from '@/lib/types';

const fleets: Fleet[] = [
  { id: 'a', seriesId: 's', name: 'IRC 1', displayOrder: 0, scoringSystem: 'scratch' },
  { id: 'b', seriesId: 's', name: 'IRC 2', displayOrder: 1, scoringSystem: 'scratch' },
];
const boat = (id: string, fleet: string): Competitor => ({
  id, seriesId: 's', fleetIds: [fleet], sailNumber: id, names: [id], clubs: [], gender: '', age: null, createdAt: 0,
});
const row = (competitorId: string, opts: { place?: number; code?: string }): Finish => ({
  id: `f-${competitorId}`, raceId: 'r', competitorId, sortOrder: opts.place ?? null, tiedWithPrevious: false,
  resultCode: opts.code ?? null, startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null,
  redressExcludeRaceIds: null, redressIncludeRaceIds: null, redressIncludeAllLater: false, redressPoints: null,
});
const DTP: SeriesScoringCode = { code: 'DTP', description: 'Declared, did not race', kind: 'replace', rule: { type: 'fixedPoints', points: 8 }, discardable: true, countsInFleetSize: true };

describe('a high-point race, for the scorer', () => {
  const boats = [boat('1', 'a'), boat('2', 'a'), boat('3', 'a'), boat('4', 'b'), boat('5', 'b')];
  const finishes = [row('1', { place: 1 }), row('2', { code: 'DTP' }), row('3', { code: 'DNC' }), row('4', { place: 2 })];

  it('counts each fleet’s boats whose result counts toward its size', () => {
    const codes = buildCodeTable('seriesEntries', [DTP], { formula: 'chips3', pointForComingToStart: false });
    expect(raceFleetSizes(fleets, boats, finishes, codes).map((e) => [e.fleet.name, e.fleetSize])).toEqual([['IRC 1', 2], ['IRC 2', 1]]);
  });

  it('offers the series’ own codes that count, and the boats with nothing recorded', () => {
    expect(declaredCodes([DTP, { ...DTP, code: 'XYZ', countsInFleetSize: false }, { code: 'DNS', kind: 'replace', rule: { type: 'fixedPoints', points: 1 }, discardable: true }]).map((c) => c.code)).toEqual(['DTP']);
    expect(boatsWithNoResult(boats, finishes).map((b) => b.id)).toEqual(['5']);
  });

  it('previews a weighting on a 10-boat race', () => {
    expect(highPointWeightingPreview(1.2, { formula: 'boatsBeaten', pointForComingToStart: false })).toBe('1st of 10 scores 12.0, 5th of 10 scores 7.2');
    expect(highPointWeightingPreview(1.2, { formula: 'chips3', pointForComingToStart: false })).toBe('1st of 10 scores 116.1, 5th of 10 scores 79.4');
  });
});
