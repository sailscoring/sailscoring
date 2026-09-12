/**
 * The mix behind an ORC rating.
 *
 * A certificate publishes a boat's predicted performance as a matrix: time
 * allowances in s/NM at each tabulated true wind speed by each true wind
 * angle. Every ORC scoring method is a weighted mix of those cells, and this
 * module recovers the weights so a published page can show which part of the
 * boat's polar a race actually paid for.
 *
 * Two axes, computed separately and multiplied:
 *
 * - **Rows** carry the course. A windward/leeward model is 50 % upwind and
 *   50 % downwind at optimum VMG (rule 402.4(a)) — on every certificate,
 *   `0.5·Beat + 0.5·Run` reproduces the printed `WL` row exactly. A
 *   constructed course is its legs, each weighted by its share of the
 *   distance (rule 402.5), which is how the module builds the course curve
 *   in the first place.
 * - **Columns** carry the wind. Performance Curve Scoring reads the curve at
 *   one scoring wind (rule 402.9) through a cubic spline over the tabulated
 *   wind speeds. Since a spline is linear in its node values, the weights it
 *   applies are exact and recoverable — one column at 100 % when the scoring
 *   wind lands on a tabulated speed, and otherwise a signed kernel spread
 *   over the neighbours. That kernel sums to one only to within a few parts
 *   in ten thousand: the module pins its spline through the origin, and off
 *   a tabulated speed that node takes a sliver of the interpolation with it.
 *
 * The spline interpolates boat speeds rather than allowances, so away from a
 * tabulated wind speed the weighted sum of allowances lands near the applied
 * allowance without landing on it. `exact` says which case a mix is in, and
 * `weightedSum` is reported beside `appliedTod` so the gap is visible rather
 * than hidden.
 *
 * All-purpose ('CR') and coastal ('OC') models are not decomposed: the
 * all-purpose rows need the mean of the VMG projection across each angle
 * band rather than the tabulated cell, and no published course model defines
 * the coastal row at all.
 */

import { buildCubicSpline, splineInterpolate, scorePcsRace, type PcsAllowances } from './orc-pcs';
import type { OrcCourseLeg } from './types';

/** A model whose rows this module can decompose. */
export type OrcMixModel = 'WL' | 'CC';

export interface OrcMixRow {
  label: string;
  /** The secondary line under the label — the leg's angle, or "optimum VMG". */
  detail: string;
  /** Share of the course distance. */
  share: number;
  /** The row's allowance (s/NM) at each tabulated wind speed. */
  allowances: number[];
}

export interface OrcMixColumn {
  windKt: number;
  /** The spline's weight on this wind speed at the scoring wind. */
  weight: number;
}

export interface OrcMix {
  columns: OrcMixColumn[];
  rows: OrcMixRow[];
  /** rows × columns: the share of the rating each cell carries. */
  cells: number[][];
  /** The scoring wind the curve was read at (kt). */
  scoringWind: number;
  /** Σ cell × allowance (s/NM). */
  weightedSum: number;
  /** The allowance the fleet was actually corrected on (s/NM). */
  appliedTod: number;
  /** The scoring wind landed on a tabulated speed, so one column carries the
   *  whole rating and `weightedSum` equals `appliedTod`. */
  exact: boolean;
}

export interface OrcMixInput {
  allowances: PcsAllowances;
  model: OrcMixModel;
  /** Required for 'CC'. */
  legs?: OrcCourseLeg[];
  scoringWind: number;
}

/** The module's velocity spline: through the origin, the tabulated points,
 *  and a flat pad far to the right — the same nodes `PcsCurve` builds. */
function velocitySpline(windSpeeds: number[], allowances: number[]): (at: number) => number {
  const velocities = allowances.map((a) => 3600 / a);
  const coefs = buildCubicSpline(
    [0, ...windSpeeds, 10000],
    [0, ...velocities, velocities[velocities.length - 1]],
  );
  return (at: number) => splineInterpolate(coefs, at);
}

/** The spline's weight on each tabulated wind speed at `at`. The spline is a
 *  linear operator on its node values, so a unit impulse on each node
 *  recovers its weight exactly; the finite difference is exact arithmetic on
 *  a linear function, not an approximation of a derivative. */
function windWeights(windSpeeds: number[], allowances: number[], at: number): number[] {
  const base = velocitySpline(windSpeeds, allowances)(at);
  const velocities = allowances.map((a) => 3600 / a);
  const step = 1e-4;
  return velocities.map((_, j) => {
    const perturbed = [...velocities];
    perturbed[j] += step;
    const coefs = buildCubicSpline(
      [0, ...windSpeeds, 10000],
      [0, ...perturbed, perturbed[perturbed.length - 1]],
    );
    return (splineInterpolate(coefs, at) - base) / step;
  });
}

/** One leg's allowance curve over the tabulated wind speeds. Unit distance:
 *  the leg's share of the course is applied separately, on the row. */
function legCurve(allowances: PcsAllowances, leg: OrcCourseLeg): number[] {
  return scorePcsRace({
    course: {
      legs: [
        {
          distanceNm: 1,
          courseDeg: leg.bearingDeg,
          windDirectionDeg: leg.windDirectionDeg,
          ...(leg.currentSpeedKts != null ? { currentSpeedKts: leg.currentSpeedKts } : {}),
          ...(leg.currentDirectionDeg != null ? { currentDirectionDeg: leg.currentDirectionDeg } : {}),
        },
      ],
    },
    boats: [{ id: 'mix', allowances, elapsedSeconds: 3600 }],
  }).boats[0].curve;
}

/** True wind angle of a leg, folded to 0–180°. */
export function legTwa(leg: OrcCourseLeg): number {
  return Math.abs(((leg.windDirectionDeg - leg.bearingDeg + 540) % 360) - 180);
}

function pointOfSail(twa: number, beatAngle: number, gybeAngle: number): string {
  if (twa <= beatAngle) return 'beating';
  if (twa >= gybeAngle) return 'running';
  if (twa < 80) return 'close reach';
  if (twa <= 100) return 'beam reach';
  return 'broad reach';
}

/** The beat and gybe angles at a wind speed, interpolated between the
 *  tabulated speeds — they move enough across the range (37°–45° to windward
 *  on a typical cruiser-racer) to be worth reading at the scoring wind. */
function anglesAt(windSpeeds: number[], angles: number[], at: number): number {
  if (at <= windSpeeds[0]) return angles[0];
  const last = windSpeeds.length - 1;
  if (at >= windSpeeds[last]) return angles[last];
  const i = windSpeeds.findIndex((w) => w > at);
  const span = windSpeeds[i] - windSpeeds[i - 1];
  const t = (at - windSpeeds[i - 1]) / span;
  return angles[i - 1] + t * (angles[i] - angles[i - 1]);
}

/**
 * Build the weight matrix behind a PCS race's applied allowance. Returns
 * undefined when the certificate lacks the rows the model needs, or when a
 * constructed course arrives without legs.
 */
export function buildOrcMix(input: OrcMixInput): OrcMix | undefined {
  const { allowances, model, legs, scoringWind } = input;
  const windSpeeds = allowances.WindSpeeds;
  const beat = allowances.Beat;
  const run = allowances.Run;
  if (!windSpeeds?.length || !beat?.length || !run?.length) return undefined;
  if (windSpeeds.length !== beat.length || windSpeeds.length !== run.length) return undefined;

  let rows: OrcMixRow[];
  let courseCurve: number[];

  if (model === 'WL') {
    rows = [
      { label: 'Beat', detail: 'optimum VMG', share: 0.5, allowances: beat },
      { label: 'Run', detail: 'optimum VMG', share: 0.5, allowances: run },
    ];
    courseCurve = windSpeeds.map((_, i) => 0.5 * beat[i] + 0.5 * run[i]);
  } else {
    if (!legs?.length) return undefined;
    const total = legs.reduce((sum, leg) => sum + leg.distanceNm, 0);
    if (!(total > 0)) return undefined;
    const beatAngle = allowances.BeatAngle ?? [];
    const gybeAngle = allowances.GybeAngle ?? [];
    const beatAt = beatAngle.length ? anglesAt(windSpeeds, beatAngle, scoringWind) : 40;
    const gybeAt = gybeAngle.length ? anglesAt(windSpeeds, gybeAngle, scoringWind) : 160;
    rows = legs.map((leg, i) => {
      const twa = legTwa(leg);
      return {
        label: `Leg ${i + 1}`,
        detail: `${leg.distanceNm.toFixed(2)} NM · TWA ${Math.round(twa)}° · ${pointOfSail(twa, beatAt, gybeAt)}`,
        share: leg.distanceNm / total,
        allowances: legCurve(allowances, leg),
      };
    });
    courseCurve = windSpeeds.map((_, i) => rows.reduce((sum, r) => sum + r.share * r.allowances[i], 0));
  }

  const weights = windWeights(windSpeeds, courseCurve, scoringWind);
  const columns = windSpeeds.map((windKt, i) => ({ windKt, weight: weights[i] }));
  const cells = rows.map((r) => weights.map((w) => r.share * w));
  const weightedSum = rows.reduce(
    (sum, r, ri) => sum + r.allowances.reduce((s, a, ci) => s + cells[ri][ci] * a, 0),
    0,
  );
  const appliedTod = 3600 / velocitySpline(windSpeeds, courseCurve)(scoringWind);
  const lit = weights.filter((w) => Math.abs(w) > 1e-6).length;

  return { columns, rows, cells, scoringWind, weightedSum, appliedTod, exact: lit === 1 };
}
