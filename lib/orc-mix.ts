/**
 * The mix behind an ORC rating.
 *
 * A certificate publishes a boat's predicted performance as a matrix: an
 * allowance in seconds per mile at each of nine true wind speeds by each of
 * ten true wind angles, from optimum beat VMG through 52°–150° to optimum
 * run VMG. Every ORC scoring method is a weighted mix of those cells, and
 * this module recovers the weights so a published page can show the
 * certificate's own table with the share of the rating in each cell.
 *
 * Two axes, computed separately and multiplied.
 *
 * **Rows: the course, as a distribution of true wind angles.** Every course
 * model is one — a windward/leeward model is half the distance at 0° and
 * half at 180° (rule 402.4(a)); all-purpose is an equal distribution of
 * every wind direction, a circumnavigation of a circular island
 * (402.4(b)); a constructed course is one angle per leg, weighted by its
 * share of the distance (402.5). Each angle is then attributed back to the
 * cells the module reads it from: inside the optimum beat and gybe angles
 * that is the Beat or Run VMG cell projected by the cosine of the angle,
 * and between them it is a Lagrange interpolation over the neighbouring
 * tabulated angles. Both are linear in the cells, so the attribution is
 * exact: the weights times the certificate's own numbers reproduce the
 * course's allowance at every tabulated wind speed.
 *
 * The weights sum to one only when every angle is sailed dead upwind, dead
 * downwind, or at a tabulated angle. A beat leg sailed 15° off the wind
 * covers its distance for cos(15°) of the VMG allowance, so a constructed
 * course usually comes to a little under 100 % — which is a fact about the
 * course, not a rounding error.
 *
 * **Columns: the wind.** Performance Curve Scoring reads the curve at one
 * scoring wind (rule 402.9) through a cubic spline over the tabulated wind
 * speeds. A spline is linear in its node values, so the weights it applies
 * are exact and recoverable — one column at 100 % when the scoring wind
 * lands on a tabulated speed, and otherwise a signed kernel spread over the
 * neighbours. That kernel sums to one only to within a few parts in ten
 * thousand: the module pins its spline through the origin, and off a
 * tabulated speed that node takes a sliver of the interpolation with it.
 *
 * Unlike the angle axis, the wind axis is not exact in allowance space: the
 * spline interpolates boat speeds, so away from a tabulated wind speed the
 * weighted sum of allowances lands near the applied allowance without
 * landing on it. `exact` says which case a mix is in, and `weightedSum` is
 * reported beside `appliedTod` so the gap is visible rather than hidden.
 *
 * A leg carrying a tidal current is not decomposed. The module's current
 * correction adds the along-leg current to the boat's speed before reading
 * the polar, and that term belongs to no cell on the certificate.
 */

import { buildCubicSpline, splineInterpolate, type PcsAllowances } from './orc-pcs';
import type { OrcCourseLeg } from './types';

/** A course model whose angles this module can enumerate. */
export type OrcMixModel = 'WL' | 'CR' | 'CC';

export interface OrcMixRow {
  /** The certificate's own row heading: 'Beat VMG', '52°', …, 'Run VMG'. */
  label: string;
  /** The allowance (s/NM) the certificate prints at each wind speed. */
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

/** How finely the all-purpose circle is sampled. Quarter-degree steps put
 *  the reconstruction of the certificate's own all-purpose row inside the
 *  0.1 s/NM it is printed to. */
const CIRCLE_STEP_DEG = 0.25;

const rad = (deg: number) => (deg * Math.PI) / 180;

/** True wind angle of a leg, folded to 0–180°. */
export function legTwa(leg: OrcCourseLeg): number {
  return Math.abs(((leg.windDirectionDeg - leg.bearingDeg + 540) % 360) - 180);
}

/** One point on the boat's polar, tagged with the certificate cell it comes
 *  from and the cosine between that cell's allowance and this point's. */
interface PolarPoint {
  angle: number;
  velocity: number;
  row: number;
  cos: number;
}

/** Lagrange over an arbitrary set of points, exactly as the module does it. */
function lagrange(x: number, xi: number[], yi: number[]): number {
  let result = 0;
  for (let k = 0; k < xi.length; k++) {
    let a1 = 1;
    let a2 = 1;
    let p1 = 1;
    let p2 = 1;
    for (let i = 0; i < k; i++) {
      a1 *= x - xi[i];
      p1 *= xi[k] - xi[i];
    }
    for (let i = k + 1; i < xi.length; i++) {
      a2 *= x - xi[i];
      p2 *= xi[k] - xi[i];
    }
    result += p1 === 0 || p2 === 0 ? 0 : ((a1 * a2) / (p1 * p2)) * yi[k];
  }
  return result;
}

export class OrcMixBuilder {
  private readonly windSpeeds: number[];
  private readonly rowAllowances: number[][];
  private readonly beatAngle: number[];
  private readonly gybeAngle: number[];
  private readonly polars: PolarPoint[][];

  /** Row 0 is Beat VMG and the last row Run VMG, with the tabulated angles
   *  in between — the order the certificate prints them in. */
  constructor(
    private readonly labels: string[],
    a: PcsAllowances,
    angles: number[],
  ) {
    this.windSpeeds = a.WindSpeeds as number[];
    this.beatAngle = a.BeatAngle as number[];
    this.gybeAngle = a.GybeAngle as number[];
    this.rowAllowances = [
      a.Beat as number[],
      ...angles.map((angle) => a[`R${angle}`] as number[]),
      a.Run as number[],
    ];
    const runRow = this.rowAllowances.length - 1;
    this.polars = this.windSpeeds.map((_, i) => {
      const beat = this.beatAngle[i];
      const gybe = this.gybeAngle[i];
      const beatVelocity = 3600 / this.rowAllowances[0][i];
      const runVelocity = 3600 / this.rowAllowances[runRow][i];
      const points: PolarPoint[] = [];
      // The two points 2° inside each optimum are the module's own, kept
      // there "to maintain Altura compatibility"; both are the VMG cell
      // projected onto their angle, so both attribute to that cell.
      for (const angle of [beat - 2, beat]) {
        points.push({ angle, velocity: beatVelocity / Math.cos(rad(angle)), row: 0, cos: Math.cos(rad(angle)) });
      }
      angles.forEach((angle, k) => {
        if (angle > beat && angle < gybe) {
          points.push({ angle, velocity: 3600 / this.rowAllowances[k + 1][i], row: k + 1, cos: 1 });
        }
      });
      for (const angle of [gybe, gybe + 2]) {
        const cos = Math.cos(Math.PI - rad(angle));
        points.push({ angle, velocity: runVelocity / cos, row: runRow, cos });
      }
      return points;
    });
  }

  get rows(): OrcMixRow[] {
    return this.labels.map((label, k) => ({ label, allowances: this.rowAllowances[k] }));
  }

  /**
   * The coefficients one true wind angle puts on each certificate cell at
   * one wind speed, such that Σ coefficient × cell is the allowance the
   * module computes for a leg sailed at that angle.
   */
  private angleCoefficients(windIndex: number, twa: number): number[] {
    const out = new Array<number>(this.rowAllowances.length).fill(0);
    if (twa <= this.beatAngle[windIndex]) {
      out[0] = Math.cos(rad(twa));
      return out;
    }
    if (twa >= this.gybeAngle[windIndex]) {
      out[out.length - 1] = Math.cos(Math.PI - rad(twa));
      return out;
    }
    const polar = this.polars[windIndex];
    const angles = polar.map((p) => p.angle);
    const first = angles.findIndex((angle) => angle >= twa);
    const end = Math.min(first + 1, angles.length - 1);
    const start = Math.max(first - 2, 0);
    const windowPoints = polar.slice(start, end + 1);
    const xi = windowPoints.map((p) => p.angle);
    const yi = windowPoints.map((p) => p.velocity);
    const base = lagrange(twa, xi, yi);
    const allowance = 3600 / base;
    const step = 1e-6;
    windowPoints.forEach((point, k) => {
      const bumped = [...yi];
      bumped[k] += step;
      // The interpolation is linear in the polar velocities, so a unit
      // impulse recovers each point's weight exactly. Velocities are
      // reciprocal allowances, so a weight on a velocity becomes a weight
      // on that point's allowance scaled by allowance/pointAllowance — the
      // identity that turns a harmonic mean back into an arithmetic one,
      // keeping Σ coefficient × cell equal to the allowance.
      const weight = (lagrange(twa, xi, bumped) - base) / step;
      out[point.row] += weight * (allowance / (3600 / point.velocity)) * point.cos;
    });
    return out;
  }

  /** The course's coefficients on every cell: rows × wind speeds. */
  build(shares: Array<{ twa: number; share: number }>): number[][] {
    const grid = this.rowAllowances.map(() => new Array<number>(this.windSpeeds.length).fill(0));
    this.windSpeeds.forEach((_, i) => {
      for (const { twa, share } of shares) {
        const coefficients = this.angleCoefficients(i, twa);
        coefficients.forEach((c, row) => {
          grid[row][i] += share * c;
        });
      }
    });
    return grid;
  }
}

/** The angles a course model puts the boat on, and the share of the
 *  distance sailed at each. */
function angleShares(
  model: OrcMixModel,
  legs: OrcCourseLeg[] | undefined,
): Array<{ twa: number; share: number }> | undefined {
  if (model === 'WL') {
    return [
      { twa: 0, share: 0.5 },
      { twa: 180, share: 0.5 },
    ];
  }
  if (model === 'CR') {
    const shares: Array<{ twa: number; share: number }> = [];
    const count = Math.round(180 / CIRCLE_STEP_DEG);
    for (let k = 0; k < count; k++) {
      shares.push({ twa: (k + 0.5) * CIRCLE_STEP_DEG, share: 1 / count });
    }
    return shares;
  }
  if (!legs?.length) return undefined;
  // A current on any leg puts a term in the allowance that belongs to no
  // cell, so the course as a whole stops being a mix of the certificate.
  if (legs.some((leg) => (leg.currentSpeedKts ?? 0) !== 0)) return undefined;
  const distance = legs.reduce((sum, leg) => sum + leg.distanceNm, 0);
  if (!(distance > 0)) return undefined;
  return legs.map((leg) => ({ twa: legTwa(leg), share: leg.distanceNm / distance }));
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

/** The spline's weight on each tabulated wind speed at `at`. */
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

/**
 * Build the weight matrix behind a PCS race's applied allowance. Returns
 * undefined when the certificate lacks the rows the mix needs, or when the
 * course isn't one the mix is defined over.
 */
export function buildOrcMix(input: OrcMixInput): OrcMix | undefined {
  const { allowances, model, legs, scoringWind } = input;
  const windSpeeds = allowances.WindSpeeds;
  const angles = allowances.WindAngles;
  if (!windSpeeds?.length || !angles?.length) return undefined;
  const needed = ['Beat', 'Run', 'BeatAngle', 'GybeAngle', ...angles.map((a) => `R${a}`)];
  for (const key of needed) {
    const row = allowances[key];
    if (!Array.isArray(row) || row.length !== windSpeeds.length || row.some((v) => typeof v !== 'number')) {
      return undefined;
    }
  }

  const shares = angleShares(model, legs);
  if (!shares) return undefined;

  const labels = ['Beat VMG', ...angles.map((a) => `${a}°`), 'Run VMG'];
  const builder = new OrcMixBuilder(labels, allowances, angles);
  const coefficients = builder.build(shares);
  const rows = builder.rows;

  // The course's own allowance curve, which is what the wind spline runs
  // over: Σ coefficient × cell at each tabulated wind speed.
  const courseCurve = windSpeeds.map((_, i) =>
    rows.reduce((sum, row, k) => sum + coefficients[k][i] * row.allowances[i], 0),
  );

  const weights = windWeights(windSpeeds, courseCurve, scoringWind);
  const columns = windSpeeds.map((windKt, i) => ({ windKt, weight: weights[i] }));
  const cells = coefficients.map((row) => row.map((c, i) => c * weights[i]));
  const weightedSum = rows.reduce(
    (sum, row, k) => sum + row.allowances.reduce((s, a, i) => s + cells[k][i] * a, 0),
    0,
  );
  const appliedTod = 3600 / velocitySpline(windSpeeds, courseCurve)(scoringWind);
  const lit = weights.filter((w) => Math.abs(w) > 1e-6).length;

  return { columns, rows, cells, scoringWind, weightedSum, appliedTod, exact: lit === 1 };
}
