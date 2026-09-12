import { describe, expect, it } from 'vitest';

import { buildOrcMix, legTwa, type OrcMix } from '@/lib/orc-mix';
import { scorePcsRace, type PcsAllowances } from '@/lib/orc-pcs';
import type { OrcCourseLeg } from '@/lib/types';

import sampleCerts from '@/scripts/data/orc-sample-certs.json';

/**
 * The eight real 2026 IRL certificates frozen as the sample series' rating
 * seed. Their published rows are the oracle: a mix that doesn't reproduce
 * them isn't describing the rating the boat actually sails on.
 */
const CERTS = (sampleCerts.records as Array<{ record: Record<string, unknown> }>).map((r) => ({
  name: r.record.YachtName as string,
  allowances: r.record.Allowances as PcsAllowances & Record<string, number[]>,
}));

/** The seven-leg Howth course used by the PCS parity fixtures. */
const HOWTH_LEGS: OrcCourseLeg[] = [
  { distanceNm: 2.09, bearingDeg: 162, windDirectionDeg: 160 },
  { distanceNm: 0.06, bearingDeg: 60, windDirectionDeg: 155 },
  { distanceNm: 1.91, bearingDeg: 340, windDirectionDeg: 155 },
  { distanceNm: 1.89, bearingDeg: 161, windDirectionDeg: 160 },
  { distanceNm: 0.06, bearingDeg: 60, windDirectionDeg: 160 },
  { distanceNm: 1.91, bearingDeg: 340, windDirectionDeg: 160 },
  { distanceNm: 0.19, bearingDeg: 316, windDirectionDeg: 160 },
];

const pcsLegs = (legs: OrcCourseLeg[]) =>
  legs.map((l) => ({
    distanceNm: l.distanceNm,
    courseDeg: l.bearingDeg,
    windDirectionDeg: l.windDirectionDeg,
  }));

/** The coefficient on each cell before the wind axis is applied — the cell
 *  weight divided back out by its column's spline weight. At a tabulated
 *  scoring wind only that column is meaningful, which is where the angle
 *  axis can be checked on its own. */
function courseCurveFrom(mix: OrcMix, windKt: number): number {
  const ci = mix.columns.findIndex((c) => c.windKt === windKt);
  const weight = mix.columns[ci].weight;
  return mix.rows.reduce((sum, row, ri) => sum + (mix.cells[ri][ci] / weight) * row.allowances[ci], 0);
}

function total(mix: OrcMix): number {
  return mix.cells.reduce((sum, row) => sum + row.reduce((s, c) => s + c, 0), 0);
}

describe('buildOrcMix — the grid is the certificate', () => {
  it('has the certificate’s own rows, in the order it prints them', () => {
    const mix = buildOrcMix({ allowances: CERTS[0].allowances, model: 'WL', scoringWind: 12 })!;
    expect(mix.rows.map((r) => r.label)).toEqual([
      'Beat VMG', '52°', '60°', '75°', '90°', '110°', '120°', '135°', '150°', 'Run VMG',
    ]);
    expect(mix.columns.map((c) => c.windKt)).toEqual([4, 6, 8, 10, 12, 14, 16, 20, 24]);
  });

  it('prints the allowance the certificate prints in every row', () => {
    const a = CERTS[0].allowances;
    const mix = buildOrcMix({ allowances: a, model: 'WL', scoringWind: 12 })!;
    expect(mix.rows[0].allowances).toEqual(a.Beat);
    expect(mix.rows[1].allowances).toEqual(a.R52);
    expect(mix.rows[9].allowances).toEqual(a.Run);
  });
});

describe('buildOrcMix — the course on the rows', () => {
  it('splits a windward/leeward model half beat VMG, half run VMG', () => {
    for (const cert of CERTS) {
      const mix = buildOrcMix({ allowances: cert.allowances, model: 'WL', scoringWind: 12 })!;
      const ci = mix.columns.findIndex((c) => c.windKt === 12);
      expect(mix.cells[0][ci]).toBeCloseTo(0.5, 10);
      expect(mix.cells[9][ci]).toBeCloseTo(0.5, 10);
      // Half the certificate's rows play no part at all.
      for (let r = 1; r <= 8; r++) expect(mix.cells[r][ci]).toBe(0);
    }
  });

  // The identity the picture rests on: the weights times the certificate's
  // own printed numbers are the allowance the curve was built from. Exact,
  // not approximate — both the cosine projection inside the optimum angles
  // and the Lagrange interpolation between them are linear in the cells.
  it('reproduces a constructed course’s allowance from the cells alone', () => {
    for (const cert of CERTS) {
      const mix = buildOrcMix({
        allowances: cert.allowances,
        model: 'CC',
        legs: HOWTH_LEGS,
        scoringWind: 12,
      })!;
      const scored = scorePcsRace({
        course: { legs: pcsLegs(HOWTH_LEGS) },
        boats: [{ id: 'a', allowances: cert.allowances, elapsedSeconds: 5000 }],
        scoringWindOverride: 12,
      });
      expect(courseCurveFrom(mix, 12)).toBeCloseTo(scored.boats[0].curve[4], 6);
    }
  });

  it('reproduces the certificate’s own all-purpose row', () => {
    for (const cert of CERTS) {
      const mix = buildOrcMix({ allowances: cert.allowances, model: 'CR', scoringWind: 12 })!;
      // Within the 0.1 s/NM the certificate is printed to; the residual is
      // the step the circle is sampled at, nothing else.
      expect(courseCurveFrom(mix, 12)).toBeCloseTo(cert.allowances.CR![4], 0);
    }
  });

  it('spreads all-purpose across every angle, beating the largest share', () => {
    const mix = buildOrcMix({ allowances: CERTS[0].allowances, model: 'CR', scoringWind: 12 })!;
    const ci = mix.columns.findIndex((c) => c.windKt === 12);
    const shares = mix.cells.map((row) => row[ci]);
    for (const share of shares) expect(share).toBeGreaterThan(0);
    expect(shares.indexOf(Math.max(...shares))).toBe(0);
  });

  it('weights a constructed course’s beat and run by the distance sailed on each', () => {
    // Six of the seven legs are within a couple of degrees of dead up or
    // downwind, so nearly the whole rating sits in the two VMG rows.
    const mix = buildOrcMix({
      allowances: CERTS[0].allowances,
      model: 'CC',
      legs: HOWTH_LEGS,
      scoringWind: 12,
    })!;
    const ci = mix.columns.findIndex((c) => c.windKt === 12);
    expect(mix.cells[0][ci]).toBeCloseTo(0.491, 2);
    expect(mix.cells[9][ci]).toBeCloseTo(0.481, 2);
  });
});

describe('buildOrcMix — what the weights come to', () => {
  it('comes to exactly one on a model course sailed dead up and downwind', () => {
    const mix = buildOrcMix({ allowances: CERTS[0].allowances, model: 'WL', scoringWind: 12 })!;
    expect(total(mix)).toBeCloseTo(1, 9);
  });

  // A beat leg sailed 15° off the wind covers its distance for cos(15°) of
  // the VMG allowance, so a real course comes to a shade under 100%. That
  // is a fact about the course, and the grid shows it rather than
  // normalising it away.
  it('comes to a little under one on a course sailed at real angles', () => {
    const mix = buildOrcMix({
      allowances: CERTS[0].allowances,
      model: 'CC',
      legs: HOWTH_LEGS,
      scoringWind: 12,
    })!;
    expect(total(mix)).toBeLessThan(1);
    expect(total(mix)).toBeGreaterThan(0.95);
  });
});

describe('buildOrcMix — the wind axis', () => {
  it('puts the whole rating in one column when the scoring wind is tabulated', () => {
    for (const cert of CERTS) {
      const mix = buildOrcMix({ allowances: cert.allowances, model: 'WL', scoringWind: 12 })!;
      expect(mix.exact).toBe(true);
      const lit = mix.columns.filter((c) => Math.abs(c.weight) > 1e-6);
      expect(lit).toHaveLength(1);
      expect(lit[0].windKt).toBe(12);
      expect(lit[0].weight).toBeCloseTo(1, 6);
    }
  });

  // Between tabulated speeds the spline reaches past its neighbours, so some
  // weights go negative. That is the module's own arithmetic, not a defect —
  // it is why the block is labelled an attribution rather than an identity.
  it('spreads a signed kernel summing to one when it is not', () => {
    const mix = buildOrcMix({ allowances: CERTS[0].allowances, model: 'WL', scoringWind: 11.4 })!;
    expect(mix.exact).toBe(false);
    expect(mix.columns.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1, 3);
    expect(mix.columns.some((c) => c.weight < -1e-3)).toBe(true);
  });

  it('matches the module exactly at a tabulated scoring wind', () => {
    for (const cert of CERTS) {
      const mix = buildOrcMix({ allowances: cert.allowances, model: 'WL', scoringWind: 12 })!;
      expect(mix.weightedSum).toBeCloseTo(mix.appliedTod, 6);
    }
  });

  it('reports the applied allowance the PCS module computes', () => {
    const allowances = CERTS[0].allowances;
    const mix = buildOrcMix({ allowances, model: 'CC', legs: HOWTH_LEGS, scoringWind: 11.5 })!;
    const scored = scorePcsRace({
      course: { legs: pcsLegs(HOWTH_LEGS) },
      boats: [{ id: 'a', allowances, elapsedSeconds: 5000 }],
      scoringWindOverride: 11.5,
    });
    expect(mix.appliedTod).toBeCloseTo(scored.boats[0].todAtScoringWind, 4);
  });

  it('lands close to the applied allowance between tabulated winds, without claiming to match', () => {
    const mix = buildOrcMix({ allowances: CERTS[0].allowances, model: 'WL', scoringWind: 11.5 })!;
    expect(mix.exact).toBe(false);
    expect(Math.abs(mix.weightedSum - mix.appliedTod)).toBeGreaterThan(0.01);
    expect(Math.abs(mix.weightedSum - mix.appliedTod)).toBeLessThan(3);
  });
});

describe('buildOrcMix — courses and certificates it cannot decompose', () => {
  it('returns nothing for a constructed course with no legs', () => {
    const a = CERTS[0].allowances;
    expect(buildOrcMix({ allowances: a, model: 'CC', scoringWind: 12 })).toBeUndefined();
    expect(buildOrcMix({ allowances: a, model: 'CC', legs: [], scoringWind: 12 })).toBeUndefined();
  });

  // The current correction adds the along-leg current to the boat's speed
  // before the polar is read, and that term belongs to no cell.
  it('returns nothing for a leg carrying a tidal current', () => {
    const legs: OrcCourseLeg[] = [
      { ...HOWTH_LEGS[0], currentSpeedKts: 1.2, currentDirectionDeg: 40 },
      ...HOWTH_LEGS.slice(1),
    ];
    expect(buildOrcMix({ allowances: CERTS[0].allowances, model: 'CC', legs, scoringWind: 12 })).toBeUndefined();
  });

  it('returns nothing without the rows the grid is made of', () => {
    const a = CERTS[0].allowances;
    expect(buildOrcMix({ allowances: { WindSpeeds: [6, 8] }, model: 'WL', scoringWind: 8 })).toBeUndefined();
    expect(
      buildOrcMix({ allowances: { ...a, R90: undefined }, model: 'WL', scoringWind: 12 }),
    ).toBeUndefined();
    expect(
      buildOrcMix({ allowances: { ...a, GybeAngle: undefined }, model: 'WL', scoringWind: 12 }),
    ).toBeUndefined();
  });

  it('returns nothing when a row is a different length from the wind speeds', () => {
    const a = CERTS[0].allowances;
    expect(
      buildOrcMix({ allowances: { ...a, Run: a.Run!.slice(0, 5) }, model: 'WL', scoringWind: 12 }),
    ).toBeUndefined();
  });
});

describe('legTwa', () => {
  it('folds the wind onto 0–180 whichever side of the bow it is', () => {
    expect(legTwa({ distanceNm: 1, bearingDeg: 0, windDirectionDeg: 90 })).toBeCloseTo(90, 6);
    expect(legTwa({ distanceNm: 1, bearingDeg: 90, windDirectionDeg: 0 })).toBeCloseTo(90, 6);
    expect(legTwa({ distanceNm: 1, bearingDeg: 340, windDirectionDeg: 160 })).toBeCloseTo(180, 6);
    expect(legTwa({ distanceNm: 1, bearingDeg: 162, windDirectionDeg: 160 })).toBeCloseTo(2, 6);
  });
});
