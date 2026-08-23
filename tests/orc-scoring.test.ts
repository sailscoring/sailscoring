import { describe, expect, it } from 'vitest';

import { orcFleetProfile, orcTotRating } from '@/lib/orc-certificate';
import { calculateFleetStandings, calculateHandicapRaceScores } from '@/lib/scoring';
import type { Competitor, Finish, Fleet, OrcCertData, Race, RaceStart } from '@/lib/types';

// APHT values from the boats' real 2026 IRL certificates (see
// tests/fixtures/orc/): Impetuous (Corby 25) 0.9631, Mojo (J-80) 1.0089.
const impetuousCert: OrcCertData = {
  record: {
    RefNo: '051800048LU', YachtName: 'IMPETUOUS', Family: 'ORC', C_Type: 'CLUB',
    APHD: 623.0, APHT: 0.9631, IRL_5B_WL_M_TOT: 0.7841,
  },
  expiryDate: '2026-12-31T00:00:00.000Z',
  vppYear: 2026,
  importedAt: 0,
};
const mojoCert: OrcCertData = {
  record: {
    RefNo: '051800048F1', YachtName: 'MOJO', Family: 'ORC', C_Type: 'INTL',
    APHD: 594.7, APHT: 1.0089,
  },
  importedAt: 0,
};

const fleet: Fleet = { id: 'f1', seriesId: 's1', name: 'Class 2 ORC', displayOrder: 0, scoringSystem: 'orc' };

const baseComp = {
  seriesId: 's1', fleetIds: ['f1'], names: ['x'], club: '', gender: '' as const, age: null, createdAt: 0,
};
const impetuous: Competitor = { ...baseComp, id: 'imp', sailNumber: 'IRL 2507', orcCert: impetuousCert };
const mojo: Competitor = { ...baseComp, id: 'mojo', sailNumber: 'IRL 1551', orcCert: mojoCert };
const uncertified: Competitor = { ...baseComp, id: 'none', sailNumber: 'IRL 1' };

const races: Race[] = [{ id: 'r1', seriesId: 's1', raceNumber: 1, name: null, date: '2026-09-12', createdAt: 0 }];
const start: RaceStart = { id: 'rs1', raceId: 'r1', fleetIds: ['f1'], startTime: '14:00:00' };

const finish = (competitorId: string, sortOrder: number, finishTime: string): Finish => ({
  id: `r1-${competitorId}`, raceId: 'r1', competitorId, sortOrder, finishTime, resultCode: null,
  startPresent: true, penaltyCode: null, penaltyOverride: null, tiedWithPrevious: false,
  redressMethod: null, redressExcludeRaceIds: null, redressIncludeRaceIds: null,
  redressIncludeAllLater: false, redressPoints: null,
});

describe('ORC time-on-time scoring (APHT default)', () => {
  it('scores CT = APHT × ET, so a slower-rated boat can correct out ahead', () => {
    // Mojo crosses two minutes ahead; Impetuous wins on corrected time.
    const finishes = [finish('mojo', 1, '14:58:00'), finish('imp', 2, '15:00:00')];
    const result = calculateFleetStandings([fleet], [impetuous, mojo], races, finishes, [], 'seriesEntries', [start]);
    const standings = result.fleetStandings[0].standings;
    const byRank = [...standings].sort((a, b) => a.rank - b.rank).map((s) => s.competitor.id);
    expect(byRank).toEqual(['imp', 'mojo']);

    // Per-race arithmetic through the phase-A engine, with the applied-rating
    // map resolved exactly as calculateHandicapStandings resolves it.
    const tcfMap = new Map<string, number>();
    for (const c of [impetuous, mojo]) tcfMap.set(c.id, orcTotRating(c, fleet)!);
    const { scores } = calculateHandicapRaceScores(finishes, [impetuous, mojo], start, tcfMap, 'seriesEntries');
    const imp = scores.get('imp');
    const mojoScore = scores.get('mojo');
    expect(imp?.tcfApplied).toBe(0.9631);
    // CT rounds half-up to whole seconds (ORC rule 401.2, same as the engine's
    // existing convention): 3600 × 0.9631 = 3467.16 → 3467.
    expect(imp?.correctedTime).toBe(3467);
    // 3480 × 1.0089 = 3510.972 → 3511.
    expect(mojoScore?.correctedTime).toBe(3511);
  });

  it('rejects a competitor with no certificate as unrated', () => {
    const finishes = [finish('imp', 1, '15:00:00'), finish('none', 2, '15:01:00')];
    const result = calculateFleetStandings([fleet], [impetuous, uncertified], races, finishes, [], 'seriesEntries', [start]);
    const ids = result.fleetStandings[0].standings.map((s) => s.competitor.id);
    expect(ids).toContain('imp');
    expect(ids).not.toContain('none');
    expect(result.fleetStandings[0].rejections.some((r) => r.competitorId === 'none')).toBe(true);
  });
});

describe('ORC time-on-distance scoring (403.2)', () => {
  const todFleet: Fleet = { ...fleet, orcProfile: { option: 'APHD', kind: 'tod' } };

  it('reproduces the ZW manual worked example, rounding included', () => {
    // reference-docs:tool-manuals/zw/Manual-ZW-6.md: fleet-lowest ToD 621.8;
    // boat ToD 681.7, elapsed 00:46:51 = 2811 s, course 5.15 NM →
    // Δ 59.9 × 5.15 = 308.485 → CT 2502.515 → 00:41:43 (2503 s).
    const boats: Competitor[] = [
      { ...baseComp, id: 'scr', sailNumber: 'S1', orcCert: { record: { APHD: 621.8 }, importedAt: 0 } },
      { ...baseComp, id: 'b', sailNumber: 'S2', orcCert: { record: { APHD: 681.7 }, importedAt: 0 } },
    ];
    const start14: RaceStart = { ...start, distanceNm: 5.15 };
    const finishes = [finish('scr', 1, '14:40:00'), finish('b', 2, '14:46:51')];
    const tcfMap = new Map([['scr', 621.8], ['b', 681.7]]);
    const { scores } = calculateHandicapRaceScores(finishes, boats, start14, tcfMap, 'seriesEntries', {
      distanceNm: 5.15,
      scratchTod: 621.8,
    });
    // The scratch boat's CT is its elapsed time.
    expect(scores.get('scr')?.correctedTime).toBe(2400);
    expect(scores.get('b')?.correctedTime).toBe(2503);
    expect(scores.get('b')?.tcfApplied).toBe(681.7);
  });

  it('standings: corrects against the scratch boat over the start distance', () => {
    // APHD: Mojo 594.7 (scratch), Impetuous 623.0; a 3.24 NM course.
    // Mojo crosses first (ET 2151 → CT 2151); Impetuous ET 2209 −
    // 28.3 × 3.24 = 2117.308 → 2117 — wins on corrected time.
    const todStart: RaceStart = { ...start, startTime: '15:15:00', distanceNm: 3.24 };
    const finishes = [finish('mojo', 1, '15:50:51'), finish('imp', 2, '15:51:49')];
    const result = calculateFleetStandings([todFleet], [impetuous, mojo], races, finishes, [], 'seriesEntries', [todStart]);
    const byRank = [...result.fleetStandings[0].standings].sort((a, b) => a.rank - b.rank).map((s) => s.competitor.id);
    expect(byRank).toEqual(['imp', 'mojo']);
  });

  it('standings: a ToD race with no recorded distance falls back to scratch', () => {
    const finishes = [finish('mojo', 1, '15:50:51'), finish('imp', 2, '15:51:49')];
    const result = calculateFleetStandings([todFleet], [impetuous, mojo], races, finishes, [], 'seriesEntries', [{ ...start, startTime: '15:15:00' }]);
    // Crossing order: Mojo first.
    const byRank = [...result.fleetStandings[0].standings].sort((a, b) => a.rank - b.rank).map((s) => s.competitor.id);
    expect(byRank).toEqual(['mojo', 'imp']);
  });

  it('a certificate lacking the ToD field leaves the boat unrated', () => {
    const noField: Competitor = { ...baseComp, id: 'nf', sailNumber: 'X', orcCert: { record: { APHT: 0.95 }, importedAt: 0 } };
    const todStart: RaceStart = { ...start, distanceNm: 3.24 };
    const result = calculateFleetStandings([todFleet], [impetuous, noField], races, [finish('imp', 1, '15:00:00')], [], 'seriesEntries', [todStart]);
    expect(result.fleetStandings[0].rejections.some((r) => r.competitorId === 'nf')).toBe(true);
  });
});

describe('orcFleetProfile / orcTotRating', () => {
  it('defaults to APHT time-on-time', () => {
    expect(orcFleetProfile(fleet)).toEqual({ option: 'APHT', kind: 'tot' });
    expect(orcTotRating(impetuous, fleet)).toBe(0.9631);
  });

  it('reads the configured option off the certificate by field name', () => {
    const banded: Fleet = { ...fleet, orcProfile: { option: 'IRL_5B_WL_M_TOT', kind: 'tot' } };
    expect(orcTotRating(impetuous, banded)).toBe(0.7841);
    // Mojo's certificate lacks the field → unrated under this option.
    expect(orcTotRating(mojo, banded)).toBeNull();
  });

  it('yields no time-on-time rating for a time-on-distance option', () => {
    const tod: Fleet = { ...fleet, orcProfile: { option: 'APHD', kind: 'tod' } };
    expect(orcTotRating(impetuous, tod)).toBeNull();
  });
});
