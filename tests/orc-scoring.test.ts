import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { orcFieldKind, orcFleetProfile, orcSelectableOptions, orcTotRating, parseOrcRmsJson } from '@/lib/orc-certificate';
import { scorePcsRace, type PcsAllowances } from '@/lib/orc-pcs';
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

describe('ORC Performance Curve Scoring in the standings engine', () => {
  // Real certificates with the full allowance matrix.
  const { rms } = parseOrcRmsJson(
    readFileSync(join(process.cwd(), 'tests/fixtures/orc/downrms-irl-sample.json'), 'utf-8'),
  );
  const certComp = (id: string, sail: string, yachtName: string): Competitor => ({
    ...baseComp,
    id,
    sailNumber: sail,
    orcCert: { record: rms.find((r) => r.YachtName === yachtName)!, importedAt: 0 },
  });
  const impFull = certComp('imp', 'IRL 2507', 'IMPETUOUS');
  const mojoFull = certComp('mojo', 'IRL 1551', 'MOJO');
  const pcsFleet: Fleet = { ...fleet, orcProfile: { option: 'WL', kind: 'pcs' } };
  const pcsStart: RaceStart = { ...start, distanceNm: 3.9 };
  const finishes = [finish('mojo', 1, '14:56:30'), finish('imp', 2, '14:58:00')];

  it('per-race scores match the PCS module, scratch anchored at its elapsed time', () => {
    const result = calculateFleetStandings([pcsFleet], [impFull, mojoFull], races, finishes, [], 'seriesEntries', [pcsStart]);
    const entry = result.fleetStandings[0];
    const scores = entry.orcRaceScoresByRaceId?.get('r1');
    expect(scores).toBeDefined();

    // The same race scored by the module directly must agree exactly.
    const reference = scorePcsRace({
      course: { model: 'WL', distanceNm: 3.9 },
      boats: [
        { id: 'imp', allowances: impFull.orcCert!.record.Allowances as PcsAllowances, elapsedSeconds: 3480 },
        { id: 'mojo', allowances: mojoFull.orcCert!.record.Allowances as PcsAllowances, elapsedSeconds: 3390 },
      ],
    });
    for (const id of ['imp', 'mojo'] as const) {
      const want = reference.boats.find((b) => b.id === id)!;
      const got = scores!.get(id)!;
      expect(got.correctedTime).toBe(want.correctedSeconds);
      expect(got.tcfApplied).toBeCloseTo(want.todAtScoringWind, 9);
      expect(got.orc?.impliedWind).toBeCloseTo(want.impliedWind!, 9);
      expect(got.orc?.scoringWind).toBeCloseTo(reference.scoringWind, 9);
      expect(got.orc?.courseModel).toBe('WL');
    }
    // The scratch boat's corrected time is its elapsed time.
    const scratchId = reference.scratchBoatId!;
    const scratchScore = scores!.get(scratchId)!;
    expect(scratchScore.correctedTime).toBe(scratchScore.elapsedTime);
  });

  it('the start-level scoring-wind override (402.12) is applied and flagged', () => {
    const overridden: RaceStart = { ...pcsStart, orcScoringWind: 12 };
    const result = calculateFleetStandings([pcsFleet], [impFull, mojoFull], races, finishes, [], 'seriesEntries', [overridden]);
    const scores = result.fleetStandings[0].orcRaceScoresByRaceId?.get('r1');
    const imp = scores?.get('imp');
    expect(imp?.orc?.scoringWind).toBe(12);
    expect(imp?.orc?.scoringWindOverridden).toBe(true);
  });

  it('a PCS race with no recorded distance falls back to scratch', () => {
    const result = calculateFleetStandings([pcsFleet], [impFull, mojoFull], races, finishes, [], 'seriesEntries', [start]);
    const byRank = [...result.fleetStandings[0].standings].sort((a, b) => a.rank - b.rank).map((s) => s.competitor.id);
    // Crossing order: Mojo first.
    expect(byRank).toEqual(['mojo', 'imp']);
  });

  it('scores a constructed course from the start legs, matching the module', () => {
    const ccFleet: Fleet = { ...fleet, orcProfile: { option: 'CC', kind: 'pcs' } };
    // The ORC Race Management Guide's sample constructed course, 8.11 NM.
    const legs = [
      { distanceNm: 2.09, bearingDeg: 162, windDirectionDeg: 160 },
      { distanceNm: 0.06, bearingDeg: 60, windDirectionDeg: 155 },
      { distanceNm: 1.91, bearingDeg: 340, windDirectionDeg: 155 },
      { distanceNm: 1.89, bearingDeg: 161, windDirectionDeg: 160 },
      { distanceNm: 0.06, bearingDeg: 60, windDirectionDeg: 160 },
      { distanceNm: 1.91, bearingDeg: 340, windDirectionDeg: 160 },
      { distanceNm: 0.19, bearingDeg: 316, windDirectionDeg: 160 },
    ];
    const ccStart: RaceStart = { ...start, courseLegs: legs };
    // Elapsed: Impetuous 1:28:11, Mojo 1:26:30 (the parity fixture's times).
    const ccFinishes = [finish('mojo', 1, '15:26:30'), finish('imp', 2, '15:28:11')];
    const ccStartTimed = { ...ccStart, startTime: '14:00:00' };
    const result = calculateFleetStandings([ccFleet], [impFull, mojoFull], races, ccFinishes, [], 'seriesEntries', [ccStartTimed]);
    const scores = result.fleetStandings[0].orcRaceScoresByRaceId?.get('r1');
    expect(scores).toBeDefined();

    const reference = scorePcsRace({
      course: { legs: legs.map((l) => ({ distanceNm: l.distanceNm, courseDeg: l.bearingDeg, windDirectionDeg: l.windDirectionDeg })) },
      boats: [
        { id: 'imp', allowances: impFull.orcCert!.record.Allowances as PcsAllowances, elapsedSeconds: 5291 },
        { id: 'mojo', allowances: mojoFull.orcCert!.record.Allowances as PcsAllowances, elapsedSeconds: 5190 },
      ],
    });
    for (const id of ['imp', 'mojo'] as const) {
      const want = reference.boats.find((b) => b.id === id)!;
      const got = scores!.get(id)!;
      expect(got.correctedTime).toBe(want.correctedSeconds);
      expect(got.orc?.impliedWind).toBeCloseTo(want.impliedWind!, 9);
      expect(got.orc?.courseModel).toBe('CC');
      expect(got.orc?.distanceNm).toBeCloseTo(8.11, 9);
    }
  });

  it('a constructed-course race with no recorded legs falls back to scratch', () => {
    const ccFleet: Fleet = { ...fleet, orcProfile: { option: 'CC', kind: 'pcs' } };
    // A distance alone is not a constructed course.
    const result = calculateFleetStandings([ccFleet], [impFull, mojoFull], races, finishes, [], 'seriesEntries', [pcsStart]);
    const byRank = [...result.fleetStandings[0].standings].sort((a, b) => a.rank - b.rank).map((s) => s.competitor.id);
    expect(byRank).toEqual(['mojo', 'imp']);
  });

  it('a certificate without the allowance matrix is rejected on a PCS fleet', () => {
    const bare: Competitor = { ...baseComp, id: 'bare', sailNumber: 'X', orcCert: { record: { APHT: 0.95 }, importedAt: 0 } };
    const result = calculateFleetStandings([pcsFleet], [impFull, bare], races, [finish('imp', 1, '14:58:00')], [], 'seriesEntries', [pcsStart]);
    expect(result.fleetStandings[0].rejections.some((r) => r.competitorId === 'bare')).toBe(true);
  });
});

describe('ORC wind-band selection (per-start option)', () => {
  const { rms } = parseOrcRmsJson(
    readFileSync(join(process.cwd(), 'tests/fixtures/orc/downrms-irl-sample.json'), 'utf-8'),
  );
  const certComp = (id: string, sail: string, yachtName: string): Competitor => ({
    ...baseComp,
    id,
    sailNumber: sail,
    orcCert: { record: rms.find((r) => r.YachtName === yachtName)!, importedAt: 0 },
  });
  const impFull = certComp('imp', 'IRL 2507', 'IMPETUOUS');
  const mojoFull = certComp('mojo', 'IRL 1551', 'MOJO');
  // Mojo 14:58:00 (ET 3480), Impetuous 15:00:00 (ET 3600).
  const finishes = [finish('mojo', 1, '14:58:00'), finish('imp', 2, '15:00:00')];

  function rankOrder(fleetUnderTest: Fleet, raceStart: RaceStart): string[] {
    const result = calculateFleetStandings([fleetUnderTest], [impFull, mojoFull], races, finishes, [], 'seriesEntries', [raceStart]);
    return [...result.fleetStandings[0].standings].sort((a, b) => a.rank - b.rank).map((s) => s.competitor.id);
  }

  it('the start-selected band replaces the fleet option and can flip the race', () => {
    // Default APHT (Imp 0.9631, Mojo 1.0089): Impetuous wins 3467 to 3511.
    expect(rankOrder(fleet, start)).toEqual(['imp', 'mojo']);
    // The IRL five-band W/L Medium band (Imp 0.8211, Mojo 0.8383): Mojo
    // corrects to 2917 against Impetuous's 2956 — the band flips the race.
    const banded: RaceStart = { ...start, orcOption: 'IRL_5B_WL_M_TOT' };
    expect(rankOrder(fleet, banded)).toEqual(['mojo', 'imp']);
    // The audit block names the applied band.
    const result = calculateFleetStandings([fleet], [impFull, mojoFull], races, finishes, [], 'seriesEntries', [banded]);
    const score = result.fleetStandings[0].orcRaceScoresByRaceId?.get('r1')?.get('imp');
    expect(score?.orc?.option).toBe('IRL_5B_WL_M_TOT');
    expect(score?.tcfApplied).toBe(0.8211);
  });

  it('an option of another kind switches the race to that method', () => {
    // A ToD option on a ToT-default fleet scores the race time-on-distance —
    // the option decides the method, not the fleet default.
    const todStart: RaceStart = { ...start, distanceNm: 3.9, orcOption: 'IRL_5B_WL_M_TOD' };
    const result = calculateFleetStandings([fleet], [impFull, mojoFull], races, finishes, [], 'seriesEntries', [todStart]);
    const imp = result.fleetStandings[0].orcRaceScoresByRaceId?.get('r1')?.get('imp');
    expect(imp?.orc?.option).toBe('IRL_5B_WL_M_TOD');
    expect(imp?.tcfApplied).toBe(impFull.orcCert!.record.IRL_5B_WL_M_TOD as number);
    expect(imp?.orc?.distanceNm).toBe(3.9);
  });

  it('a race switched to time-on-distance without a course distance falls back to scratch', () => {
    const mismatched: RaceStart = { ...start, orcOption: 'IRL_5B_WL_M_TOD' };
    // Crossing order: Mojo first.
    expect(rankOrder(fleet, mismatched)).toEqual(['mojo', 'imp']);
  });

  it('a time-on-distance fleet takes ToD bands, scratch per race', () => {
    const todFleet: Fleet = { ...fleet, orcProfile: { option: 'APHD', kind: 'tod' } };
    const banded: RaceStart = { ...start, distanceNm: 3.9, orcOption: 'IRL_5B_WL_M_TOD' };
    const result = calculateFleetStandings([todFleet], [impFull, mojoFull], races, finishes, [], 'seriesEntries', [banded]);
    const scores = result.fleetStandings[0].orcRaceScoresByRaceId?.get('r1');
    const imp = scores?.get('imp');
    expect(imp?.orc?.option).toBe('IRL_5B_WL_M_TOD');
    // The band's own values set the per-race scratch allowance.
    const impTod = impFull.orcCert!.record.IRL_5B_WL_M_TOD as number;
    const mojoTod = mojoFull.orcCert!.record.IRL_5B_WL_M_TOD as number;
    expect(imp?.orc?.scratchTod).toBe(Math.min(impTod, mojoTod));
    expect(imp?.tcfApplied).toBe(impTod);
  });

  it('orcSelectableOptions discovers band fields from the stored certificates', () => {
    const options = orcSelectableOptions([impFull, mojoFull]);
    const byOption = new Map(options.map((o) => [o.option, o.kind]));
    expect(byOption.get('IRL_5B_WL_M_TOT')).toBe('tot');
    expect(byOption.get('IRL_5B_WL_M_TOD')).toBe('tod');
    expect(byOption.get('TN_Inshore_Low')).toBe('tot');
    expect(byOption.get('TND_Inshore_Low')).toBe('tod');
    expect(byOption.has('APHT')).toBe(false);
    expect(byOption.has('YachtName')).toBe(false);
  });

  it('orcFieldKind reads the naming conventions', () => {
    expect(orcFieldKind('IRL_5B_WL_H_TOT')).toBe('tot');
    expect(orcFieldKind('US_CHIMAC_UP_L_TOD')).toBe('tod');
    expect(orcFieldKind('TN_Offshore_High')).toBe('tot');
    expect(orcFieldKind('TND_Offshore_High')).toBe('tod');
    expect(orcFieldKind('APHT')).toBeNull();
    expect(orcFieldKind('CDL')).toBeNull();
  });
});

describe('ORC per-race scoring options (the method is a per-fleet-per-race choice)', () => {
  const { rms } = parseOrcRmsJson(
    readFileSync(join(process.cwd(), 'tests/fixtures/orc/downrms-irl-sample.json'), 'utf-8'),
  );
  const certComp = (id: string, sail: string, yachtName: string): Competitor => ({
    ...baseComp,
    id,
    sailNumber: sail,
    orcCert: { record: rms.find((r) => r.YachtName === yachtName)!, importedAt: 0 },
  });
  const impFull = certComp('imp', 'IRL 2507', 'IMPETUOUS');
  const mojoFull = certComp('mojo', 'IRL 1551', 'MOJO');
  const twoRaces: Race[] = [
    { id: 'r1', seriesId: 's1', raceNumber: 1, name: null, date: '2026-09-12', createdAt: 0 },
    { id: 'r2', seriesId: 's1', raceNumber: 2, name: null, date: '2026-09-12', createdAt: 0 },
  ];
  const raceFinish = (raceId: string, competitorId: string, sortOrder: number, finishTime: string): Finish => ({
    ...finish(competitorId, sortOrder, finishTime), id: `${raceId}-${competitorId}`, raceId,
  });

  it('a ToT-default fleet scores one race on constructed-course PCS via the start option', () => {
    // The ORC Race Management Guide's sample constructed course, 8.11 NM.
    const legs = [
      { distanceNm: 2.09, bearingDeg: 162, windDirectionDeg: 160 },
      { distanceNm: 0.06, bearingDeg: 60, windDirectionDeg: 155 },
      { distanceNm: 1.91, bearingDeg: 340, windDirectionDeg: 155 },
      { distanceNm: 1.89, bearingDeg: 161, windDirectionDeg: 160 },
      { distanceNm: 0.06, bearingDeg: 60, windDirectionDeg: 160 },
      { distanceNm: 1.91, bearingDeg: 340, windDirectionDeg: 160 },
      { distanceNm: 0.19, bearingDeg: 316, windDirectionDeg: 160 },
    ];
    const starts: RaceStart[] = [
      { id: 'rs1', raceId: 'r1', fleetIds: ['f1'], startTime: '14:00:00' },
      { id: 'rs2', raceId: 'r2', fleetIds: ['f1'], startTime: '14:00:00', orcOption: 'CC', courseLegs: legs },
    ];
    const finishes = [
      raceFinish('r1', 'mojo', 1, '14:58:00'), raceFinish('r1', 'imp', 2, '15:00:00'),
      raceFinish('r2', 'mojo', 1, '15:26:30'), raceFinish('r2', 'imp', 2, '15:28:11'),
    ];
    const result = calculateFleetStandings([fleet], [impFull, mojoFull], twoRaces, finishes, [], 'seriesEntries', starts);
    const byRace = result.fleetStandings[0].orcRaceScoresByRaceId;

    // Race 1: the fleet default (APHT time-on-time), named in the audit.
    const r1Imp = byRace?.get('r1')?.get('imp');
    expect(r1Imp?.orc?.option).toBe('APHT');
    expect(r1Imp?.tcfApplied).toBe(0.9631);
    expect(r1Imp?.correctedTime).toBe(3467);

    // Race 2: the start's option — full PCS over the constructed course,
    // matching the module scored directly.
    const reference = scorePcsRace({
      course: { legs: legs.map((l) => ({ distanceNm: l.distanceNm, courseDeg: l.bearingDeg, windDirectionDeg: l.windDirectionDeg })) },
      boats: [
        { id: 'imp', allowances: impFull.orcCert!.record.Allowances as PcsAllowances, elapsedSeconds: 5291 },
        { id: 'mojo', allowances: mojoFull.orcCert!.record.Allowances as PcsAllowances, elapsedSeconds: 5190 },
      ],
    });
    for (const id of ['imp', 'mojo'] as const) {
      const want = reference.boats.find((b) => b.id === id)!;
      const got = byRace!.get('r2')!.get(id)!;
      expect(got.correctedTime).toBe(want.correctedSeconds);
      expect(got.orc?.impliedWind).toBeCloseTo(want.impliedWind!, 9);
      expect(got.orc?.option).toBe('CC');
      expect(got.orc?.courseModel).toBe('CC');
    }
  });

  it('a PCS-default fleet scores one race on a certificate single number via the start option', () => {
    const pcsFleet: Fleet = { ...fleet, orcProfile: { option: 'WL', kind: 'pcs' } };
    const aphtStart: RaceStart = { ...start, orcOption: 'APHT' };
    const finishes = [finish('mojo', 1, '14:58:00'), finish('imp', 2, '15:00:00')];
    const result = calculateFleetStandings([pcsFleet], [impFull, mojoFull], races, finishes, [], 'seriesEntries', [aphtStart]);
    const scores = result.fleetStandings[0].orcRaceScoresByRaceId?.get('r1');
    const imp = scores?.get('imp');
    // Plain APHT time-on-time: 3600 × 0.9631 → 3467, beating Mojo's 3511.
    expect(imp?.orc?.option).toBe('APHT');
    expect(imp?.tcfApplied).toBe(0.9631);
    expect(imp?.correctedTime).toBe(3467);
    expect(scores?.get('mojo')?.correctedTime).toBe(3511);
    // No PCS ingredients on a single-number race.
    expect(imp?.orc?.impliedWind).toBeUndefined();
    expect(imp?.orc?.scoringWind).toBeUndefined();
  });

  it('a boat missing the race option\'s field goes unscored that race, not rejected from the series', () => {
    // Mojo's trimmed certificate carries APHT but no IRL five-band fields.
    const mojoTrimmed: Competitor = { ...baseComp, id: 'mojo', sailNumber: 'IRL 1551', orcCert: mojoCert };
    const banded: RaceStart = { ...start, orcOption: 'IRL_5B_WL_M_TOT' };
    const finishes = [finish('mojo', 1, '14:58:00'), finish('imp', 2, '15:00:00')];
    const result = calculateFleetStandings([fleet], [impFull, mojoTrimmed], races, finishes, [], 'seriesEntries', [banded]);
    const entry = result.fleetStandings[0];
    // Rated for the series (APHT default), so not rejected…
    expect(entry.rejections).toEqual([]);
    expect(entry.standings.map((s) => s.competitor.id)).toContain('mojo');
    // …but unscored in the banded race, where Impetuous scores alone.
    const scores = entry.orcRaceScoresByRaceId?.get('r1');
    expect(scores?.get('imp')?.rank).toBe(1);
    expect(scores?.has('mojo')).toBe(false);
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
