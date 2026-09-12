import { describe, expect, it } from 'vitest';

import { buildOrcMix, legTwa, type OrcMix } from '@/lib/orc-mix';
import { scorePcsRace, type PcsAllowances } from '@/lib/orc-pcs';
import type { OrcCourseLeg } from '@/lib/types';

import sampleCerts from '@/scripts/data/orc-sample-certs.json';

/**
 * The eight real 2026 IRL certificates frozen as the sample series' rating
 * seed. Their published single numbers are the oracle: a mix that doesn't
 * reproduce them isn't describing the rating the boat actually sails on.
 */
const CERTS = (sampleCerts.records as Array<{ record: Record<string, unknown> }>).map((r) => ({
  name: r.record.YachtName as string,
  allowances: r.record.Allowances as PcsAllowances,
  ILCWA: r.record.ILCWA as number,
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

function total(mix: OrcMix): number {
  return mix.cells.reduce((sum, row) => sum + row.reduce((s, c) => s + c, 0), 0);
}

describe('buildOrcMix — the windward/leeward model', () => {
  it('is half the beat allowance and half the run allowance', () => {
    for (const cert of CERTS) {
      const mix = buildOrcMix({ allowances: cert.allowances, model: 'WL', scoringWind: 12 })!;
      expect(mix.rows.map((r) => r.label)).toEqual(['Beat', 'Run']);
      expect(mix.rows.map((r) => r.share)).toEqual([0.5, 0.5]);
    }
  });

  // The claim the whole picture rests on: those two rows, mixed 50/50, are
  // the WL curve the certificate prints — so the weights describe the rating
  // rather than approximating it.
  it('reproduces the certificate WL row at every tabulated wind speed', () => {
    for (const cert of CERTS) {
      const a = cert.allowances;
      const printed = a.WL as number[];
      a.WindSpeeds!.forEach((_, i) => {
        // The certificate prints to 0.1 s/NM, so agreement to half a step is
        // the strongest claim the printed row can carry — and every boat
        // meets it at every wind speed.
        expect(Math.abs(0.5 * a.Beat![i] + 0.5 * a.Run![i] - printed[i])).toBeLessThanOrEqual(0.0501);
      });
    }
  });
});

describe('buildOrcMix — constructed courses', () => {
  it('weights each leg by its share of the distance', () => {
    const mix = buildOrcMix({
      allowances: CERTS[0].allowances,
      model: 'CC',
      legs: HOWTH_LEGS,
      scoringWind: 12,
    })!;
    expect(mix.rows).toHaveLength(HOWTH_LEGS.length);
    const distance = HOWTH_LEGS.reduce((s, l) => s + l.distanceNm, 0);
    mix.rows.forEach((row, i) => {
      expect(row.share).toBeCloseTo(HOWTH_LEGS[i].distanceNm / distance, 10);
    });
    expect(mix.rows.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1, 10);
  });

  it('names each leg by the point of sail it was actually sailed on', () => {
    const mix = buildOrcMix({
      allowances: CERTS[0].allowances,
      model: 'CC',
      legs: HOWTH_LEGS,
      scoringWind: 12,
    })!;
    expect(mix.rows[0].detail).toContain('beating');
    expect(mix.rows[2].detail).toContain('running');
    expect(mix.rows[1].detail).toContain('beam reach');
  });

  it('returns nothing for a constructed course with no legs', () => {
    expect(buildOrcMix({ allowances: CERTS[0].allowances, model: 'CC', scoringWind: 12 })).toBeUndefined();
    expect(buildOrcMix({ allowances: CERTS[0].allowances, model: 'CC', legs: [], scoringWind: 12 })).toBeUndefined();
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

  // The weights sum to one rather than exactly one: the module pins its
  // spline through the origin, and that node takes a few parts in ten
  // thousand of the interpolation with it. Tabulated speeds are unaffected,
  // where the node sits on a point the spline passes through anyway.
  it('keeps the cells summing to the whole rating either way', () => {
    for (const wind of [10, 12, 20]) {
      expect(total(buildOrcMix({ allowances: CERTS[0].allowances, model: 'WL', scoringWind: wind })!))
        .toBeCloseTo(1, 6);
    }
    for (const wind of [11.4, 15.75]) {
      expect(total(buildOrcMix({ allowances: CERTS[0].allowances, model: 'WL', scoringWind: wind })!))
        .toBeCloseTo(1, 3);
    }
  });
});

describe('buildOrcMix — against the allowance the fleet was scored on', () => {
  it('matches the module exactly at a tabulated scoring wind', () => {
    for (const cert of CERTS) {
      const mix = buildOrcMix({ allowances: cert.allowances, model: 'WL', scoringWind: 12 })!;
      expect(mix.weightedSum).toBeCloseTo(mix.appliedTod, 6);
    }
  });

  it('reports the applied allowance the PCS module computes', () => {
    const allowances = CERTS[0].allowances;
    const mix = buildOrcMix({ allowances, model: 'CC', legs: HOWTH_LEGS, scoringWind: 11.5 })!;
    // The same course through the scoring engine, with the scoring wind
    // pinned by the race committee — the number the fleet corrects against.
    const scored = scorePcsRace({
      course: {
        legs: HOWTH_LEGS.map((l) => ({
          distanceNm: l.distanceNm,
          courseDeg: l.bearingDeg,
          windDirectionDeg: l.windDirectionDeg,
        })),
      },
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

describe('buildOrcMix — certificates it cannot decompose', () => {
  it('returns nothing without the beat and run rows', () => {
    expect(buildOrcMix({ allowances: { WindSpeeds: [6, 8] }, model: 'WL', scoringWind: 8 })).toBeUndefined();
    expect(
      buildOrcMix({ allowances: { WindSpeeds: [6, 8], Beat: [900, 800] }, model: 'WL', scoringWind: 8 }),
    ).toBeUndefined();
  });

  it('returns nothing when the rows are a different length from the wind speeds', () => {
    expect(
      buildOrcMix({
        allowances: { WindSpeeds: [6, 8, 10], Beat: [900, 800], Run: [700, 600] },
        model: 'WL',
        scoringWind: 8,
      }),
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
