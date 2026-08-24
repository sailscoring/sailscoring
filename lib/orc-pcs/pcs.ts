/**
 * ORC Performance Curve Scoring (PCS) — a faithful TypeScript port of ORC's
 * public-domain PCS module (PCSLib.pas, module version 1.4.0.10; see this
 * directory's README for provenance).
 *
 * The mechanics, per ORC Rating Systems rule 402: build each boat's
 * performance curve over the certificate's tabulated wind speeds — from a
 * pre-defined course model (windward/leeward, circular random, ocean) or
 * constructed from per-leg course data — invert it at the boat's achieved
 * speed to get the boat's implied wind, take the fleet's highest implied
 * wind as the race's scoring wind (402.9), and read each boat's
 * time-on-distance allowance at the scoring wind off its own curve to
 * produce corrected times (403.2 form, scratch boat anchored).
 *
 * Everything numeric — the parabolically-terminated cubic spline, the
 * 4-point Lagrange polar interpolation, the VMG cos-projection inside the
 * optimum beat/gybe angles, the current correction, the bisection with its
 * 1e-5 precision, and every rounding — matches the reference module by
 * construction, oddities included (they are called out inline).
 */

import { buildCubicSpline, splineInterpolate, type SplineCoefficients } from './spline';

/** The tabulated reach angles every certificate carries. */
const WIND_ANGLES = [52, 60, 75, 90, 110, 120, 135, 150] as const;

const APPROXIMATION_PRECISION = 1e-5;

/**
 * The certificate's time-allowance block, shaped exactly as the ORC
 * database's JSON serves it: seconds per nautical mile per tabulated true
 * wind speed. `R52`…`R150` are the reach columns; `Beat`/`Run` the optimum
 * VMG allowances with their boat-specific angles; `WL`/`CR`/`OC` the
 * pre-composed course models.
 */
export interface PcsAllowances {
  WindSpeeds?: number[];
  WindAngles?: number[];
  Beat?: number[];
  Run?: number[];
  BeatAngle?: number[];
  GybeAngle?: number[];
  WL?: number[];
  CR?: number[];
  OC?: number[];
  [key: string]: unknown;
}

export type PcsCourseModel = 'WL' | 'CR' | 'OC';

/** One leg of a constructed course (ORC rule 402.5). Bearings and wind
 *  directions are compass degrees; current is optional. A leg may instead
 *  reference a pre-defined curve (the module's per-leg WL/CR escape). */
export interface PcsLeg {
  distanceNm: number;
  /** Compass bearing of the leg. */
  courseDeg: number;
  /** Wind direction on the leg (TWA = windDirectionDeg − courseDeg). */
  windDirectionDeg: number;
  /** Optional per-leg wind speed (kt). When any leg carries one, the whole
   *  course collapses to a fixed wind ("special course" in ZW's terms). */
  windSpeedKts?: number;
  currentDirectionDeg?: number;
  currentSpeedKts?: number;
  /** Use a pre-defined curve for this leg instead of TWA interpolation. */
  predefined?: 'WL' | 'CR';
}

export type PcsCourse =
  | { model: PcsCourseModel; distanceNm: number }
  | { legs: PcsLeg[] };

export interface PcsBoatInput {
  id: string;
  allowances: PcsAllowances;
  /** Elapsed seconds for a finisher; omit for a non-finisher — the boat
   *  still gets an allowance at the scoring wind, but no implied wind and
   *  no corrected time, and it doesn't influence the scoring wind. */
  elapsedSeconds?: number;
}

export interface PcsBoatResult {
  id: string;
  /** The boat's implied wind (kt), finishers only — its achieved s/NM
   *  placed on its own performance curve (rule 402.8). */
  impliedWind?: number;
  /** Achieved speed in knots (distance / elapsed), finishers only. */
  velocity?: number;
  /** The boat's time-on-distance allowance (s/NM) at the scoring wind. */
  todAtScoringWind: number;
  /** Corrected seconds (finishers only): ES − round(ToD × D) +
   *  round(scratch ToD × D), each product rounded as the module rounds. */
  correctedSeconds?: number;
  /** The boat's course performance curve: its allowance (s/NM) at each
   *  tabulated wind speed — the published-transparency payload. */
  curve: number[];
  /** Non-fatal curve trouble (e.g. a non-monotonic spline segment). */
  warning?: string;
  /** The boat could not be scored (e.g. no bisection solution). */
  error?: string;
}

export interface PcsRaceInput {
  course: PcsCourse;
  boats: PcsBoatInput[];
  /** Race-committee scoring wind (kt) replacing the winner's implied wind
   *  (rule 402.12). */
  scoringWindOverride?: number;
  /** Rank by each boat's own implied wind (rule 402.10). Off by default —
   *  402.9's fleet-wide scoring wind is the standard method. */
  useBoatImpliedWind?: boolean;
}

export interface PcsRaceResult {
  /** The wind speed corrected times were computed at: the best finisher's
   *  implied wind, or the override. */
  scoringWind: number;
  /** The tabulated wind speeds the curves run over (the curve x-axis). */
  windSpeeds: number[];
  /** Lowest allowance at the scoring wind — the scratch boat's. */
  scratchTod: number;
  scratchBoatId: string | null;
  distanceNm: number;
  boats: PcsBoatResult[];
  /** True when rule 402.10 per-boat implied wind actually decided the
   *  corrected times (requires the input flag and no fixed-wind curves). */
  boatImpliedWindUsed: boolean;
}

// ─── Rounding, exactly as the module rounds ─────────────────────────────────

/** Delphi SimpleRoundTo(x, 0): nearest integer, half away from zero. All
 *  quantities here are positive, where that is Math.round. */
const round0 = Math.round;

/** SimpleRoundTo(x, -5): nearest 1e-5. */
function round5(x: number): number {
  return Math.round(x * 1e5) / 1e5;
}

function degToRad(d: number): number {
  return (d * Math.PI) / 180;
}

// ─── Lagrange interpolation over the polar ──────────────────────────────────

function lagrange(x: number, xi: number[], yi: number[]): number {
  let result = 0;
  const n = xi.length;
  for (let k = 0; k < n; k++) {
    let a1 = 1;
    let a2 = 1;
    let p1 = 1;
    let p2 = 1;
    for (let i = 0; i < k; i++) {
      a1 *= x - xi[i];
      p1 *= xi[k] - xi[i];
    }
    for (let i = k + 1; i < n; i++) {
      a2 *= x - xi[i];
      p2 *= xi[k] - xi[i];
    }
    result += p1 === 0 || p2 === 0 ? 0 : ((a1 * a2) / (p1 * p2)) * yi[k];
  }
  return result;
}

/** 4-point windowed Lagrange: the window is the two points below and (up to)
 *  two at/above the first node ≥ x. */
function lagrangeEx(x: number, xi: number[], yi: number[]): number {
  let j = -1;
  for (let i = 0; i < xi.length; i++) {
    if (xi[i] >= x) {
      j = i;
      break;
    }
  }
  if (j < 0) throw new PcsError(`Incorrect x value "${x}"`);
  const ne = Math.min(j + 1, xi.length - 1);
  const ns = Math.max(j - 2, 0);
  return lagrange(x, xi.slice(ns, ne + 1), yi.slice(ns, ne + 1));
}

export class PcsError extends Error {}

// ─── Performance curves ─────────────────────────────────────────────────────

/** A curve of time allowances (s/NM) over the tabulated wind speeds, with
 *  the module's spline-backed velocity interpolation and implied-wind
 *  bisection. */
class PcsCurve {
  handicaps: number[];
  /** Weighted per-leg wind speed for a fixed-wind ("special") course. */
  fixedWindSpeed = 0;
  private vCoefs: SplineCoefficients | null = null;

  constructor(readonly windSpeeds: number[], handicaps?: number[]) {
    this.handicaps = handicaps ? [...handicaps] : new Array<number>(windSpeeds.length).fill(0);
  }

  velocity(i: number): number {
    return this.handicaps[i] === 0 ? Infinity : 3600 / this.handicaps[i];
  }

  setVelocity(i: number, v: number): void {
    this.handicaps[i] = v === 0 ? Infinity : 3600 / v;
    this.vCoefs = null;
  }

  /** All allowances identical — a degenerate flat curve. */
  fixed(): boolean {
    return this.handicaps.every((h) => h === this.handicaps[0]);
  }

  private maxHandicap(): number {
    return Math.max(...this.handicaps);
  }

  private minHandicap(): number {
    return Math.min(...this.handicaps);
  }

  /** Velocity (kt) at a wind speed. The spline runs through (0, 0), the
   *  tabulated points, and a flat pad at x = 10000, exactly as the module
   *  builds it. */
  interpolateVelocity(wind: number): number {
    if (!this.vCoefs) {
      const n = this.windSpeeds.length;
      const x = new Array<number>(n + 2);
      const y = new Array<number>(n + 2);
      x[0] = 0;
      y[0] = this.fixed() ? this.velocity(0) : 0;
      for (let i = 0; i < n; i++) {
        x[i + 1] = this.windSpeeds[i];
        y[i + 1] = this.velocity(i);
      }
      x[n + 1] = 10000;
      y[n + 1] = this.velocity(n - 1);
      this.vCoefs = buildCubicSpline(x, y);
    }
    return splineInterpolate(this.vCoefs, wind);
  }

  /** Implied wind for an achieved velocity: bisection over the tabulated
   *  wind range, clamped at the curve's fastest/slowest allowance (which is
   *  what clamps implied wind to the certificate's 4–24 kt — rule 402.8). */
  approximateWind(velocity: number): number {
    let lo = this.windSpeeds[0];
    let hi = this.windSpeeds[this.windSpeeds.length - 1];
    if (velocity <= 3600 / this.maxHandicap()) return lo;
    if (velocity >= 3600 / this.minHandicap()) return hi;
    let result = (lo + hi) / 2;
    let calc = this.interpolateVelocity(result);
    let count = 0;
    while (Math.abs(velocity - calc) > APPROXIMATION_PRECISION) {
      if (velocity < calc) hi = result;
      else lo = result;
      result = (lo + hi) / 2;
      calc = this.interpolateVelocity(result);
      if (++count > 100) throw new PcsError('No Solution');
    }
    return result;
  }

  /** The module's monotonicity check: tabulated velocities must not
   *  decrease, and the spline must be strictly increasing sampled at
   *  0.01 kt across the tabulated range. Throws on violation. */
  check(): void {
    if (this.fixed()) return;
    for (let i = 1; i < this.handicaps.length; i++) {
      if (this.velocity(i) < this.velocity(i - 1)) {
        throw new PcsError('Curve is not monotonic');
      }
    }
    let prev = -Infinity;
    for (let i = this.windSpeeds[0] * 100; i <= this.windSpeeds[this.windSpeeds.length - 1] * 100; i++) {
      const v = this.interpolateVelocity(i / 100);
      if (v <= prev) {
        throw new PcsError(`Curve spline is not monotonic at W=${(i / 100).toFixed(2)}, V=${v}`);
      }
      prev = v;
    }
  }
}

// ─── A boat's certificate data as curves ────────────────────────────────────

function allowanceArray(a: PcsAllowances, key: string, n: number): number[] {
  const raw = a[key];
  if (!Array.isArray(raw) || raw.length < n || raw.some((v) => typeof v !== 'number')) {
    throw new PcsError(`certificate allowances lack ${key}`);
  }
  return (raw as number[]).slice(0, n);
}

class PcsBoat {
  readonly windSpeeds: number[];
  readonly beatAngles: number[];
  readonly runAngles: number[];
  private readonly beat: PcsCurve;
  private readonly run: PcsCurve;
  private readonly reach: Map<number, PcsCurve>;
  private readonly models: Record<PcsCourseModel, PcsCurve>;

  constructor(a: PcsAllowances) {
    if (!Array.isArray(a.WindSpeeds) || a.WindSpeeds.length < 2) {
      throw new PcsError('certificate allowances lack WindSpeeds');
    }
    this.windSpeeds = [...a.WindSpeeds];
    const n = this.windSpeeds.length;
    this.beatAngles = allowanceArray(a, 'BeatAngle', n);
    this.runAngles = allowanceArray(a, 'GybeAngle', n);
    this.beat = new PcsCurve(this.windSpeeds, allowanceArray(a, 'Beat', n));
    this.run = new PcsCurve(this.windSpeeds, allowanceArray(a, 'Run', n));
    this.reach = new Map(
      WIND_ANGLES.map((angle) => [angle, new PcsCurve(this.windSpeeds, allowanceArray(a, `R${angle}`, n))]),
    );
    this.models = {
      WL: new PcsCurve(this.windSpeeds, allowanceArray(a, 'WL', n)),
      CR: new PcsCurve(this.windSpeeds, allowanceArray(a, 'CR', n)),
      OC: new PcsCurve(this.windSpeeds, allowanceArray(a, 'OC', n)),
    };
  }

  modelCurve(model: PcsCourseModel): PcsCurve {
    return this.models[model];
  }

  /** The boat's polar at one tabulated wind speed: (angle, velocity) points
   *  from optimum beat to optimum run. The extra points 2° inside each
   *  optimum, at the same VMG, are the module's own (kept "to maintain
   *  Altura compatibility"). */
  private polar(wsIndex: number): { angles: number[]; velocities: number[] } {
    const angles: number[] = [];
    const velocities: number[] = [];
    const add = (angle: number, v: number) => {
      angles.push(angle);
      velocities.push(v);
    };
    const beatAngle = this.beatAngles[wsIndex];
    const runAngle = this.runAngles[wsIndex];
    add(beatAngle - 2, this.beat.velocity(wsIndex) / Math.cos(degToRad(beatAngle - 2)));
    add(beatAngle, this.beat.velocity(wsIndex) / Math.cos(degToRad(beatAngle)));
    for (const angle of WIND_ANGLES) {
      if (angle > beatAngle && angle < runAngle) {
        add(angle, this.reach.get(angle)!.velocity(wsIndex));
      }
    }
    add(runAngle, this.run.velocity(wsIndex) / Math.cos(Math.PI - degToRad(runAngle)));
    add(runAngle + 2, this.run.velocity(wsIndex) / Math.cos(Math.PI - degToRad(runAngle + 2)));
    return { angles, velocities };
  }

  /** Allowances over the wind speeds for a true wind angle: VMG projected
   *  inside the optimum beat/gybe angles, Lagrange over the polar between
   *  them. */
  calculateCurve(twaIn: number, curve: PcsCurve): void {
    let twa = twaIn;
    if (twa < 0) twa += 360;
    if (twa > 180) twa = 360 - twa;
    for (let i = 0; i < this.windSpeeds.length; i++) {
      if (twa <= this.beatAngles[i]) {
        curve.handicaps[i] = this.beat.handicaps[i] * Math.cos(degToRad(twa));
        continue;
      }
      if (twa >= this.runAngles[i]) {
        curve.handicaps[i] = this.run.handicaps[i] * Math.cos(Math.PI - degToRad(twa));
        continue;
      }
      const polar = this.polar(i);
      curve.handicaps[i] = 3600 / lagrangeEx(twa, polar.angles, polar.velocities);
    }
  }

  /** One leg's curve: the TWA curve, then the module's current correction —
   *  which, faithfully to the reference, adds the along-leg current to the
   *  VMG projections but not to the mid-range polar lookup. */
  legCurve(leg: PcsLeg, curve: PcsCurve): void {
    // The raw TWA is deliberately not normalized here: the reference module
    // normalizes inside calculateCurve but applies the current correction to
    // the raw difference, and a leg with wind just left of the bow (raw TWA
    // −2°) corrects differently from one just right of it (+2°).
    const twaRaw = leg.windDirectionDeg - leg.courseDeg;
    this.calculateCurve(twaRaw, curve);
    const currentSpeed = leg.currentSpeedKts ?? 0;
    if (currentSpeed <= 0) return;
    const currentBearing = (leg.currentDirectionDeg ?? 0) - leg.courseDeg;
    const legCurrent = currentSpeed * Math.cos(degToRad(currentBearing));
    const crossCurrent = currentSpeed * Math.sin(degToRad(currentBearing));
    for (let i = 0; i < this.windSpeeds.length; i++) {
      const boatSpeed = curve.velocity(i);
      const currentAngle = (Math.atan2(crossCurrent, boatSpeed) * 180) / Math.PI;
      let corrected = twaRaw - 2 * currentAngle;
      if (corrected < 0) corrected += 360;
      if (corrected > 180) corrected = 360 - corrected;
      if (corrected <= this.beatAngles[i]) {
        curve.setVelocity(i, (this.beat.velocity(i) + legCurrent) / Math.cos(degToRad(corrected)));
        continue;
      }
      if (corrected >= this.runAngles[i]) {
        curve.setVelocity(i, (this.run.velocity(i) + legCurrent) / Math.cos(Math.PI - degToRad(corrected)));
        continue;
      }
      const polar = this.polar(i);
      curve.handicaps[i] = 3600 / lagrangeEx(corrected, polar.angles, polar.velocities);
    }
  }

  /** The constructed-course curve: each leg's curve weighted by its share
   *  of the distance. When any leg declares a wind speed, the whole course
   *  collapses to a fixed allowance at the distance-weighted wind. */
  scratchCurve(legs: PcsLeg[]): PcsCurve {
    const totalDistance = legs.reduce((sum, leg) => sum + leg.distanceNm, 0);
    const anyFixedWind = legs.some((leg) => (leg.windSpeedKts ?? 0) !== 0);
    const result = new PcsCurve(this.windSpeeds);
    for (const leg of legs) {
      const legCurve = new PcsCurve(this.windSpeeds);
      if (leg.predefined === 'WL') legCurve.handicaps = [...this.models.WL.handicaps];
      else if (leg.predefined === 'CR') legCurve.handicaps = [...this.models.CR.handicaps];
      else this.legCurve(leg, legCurve);
      const weight = leg.distanceNm / totalDistance;
      if (anyFixedWind) {
        let ws = leg.windSpeedKts ?? 0;
        ws = Math.min(ws, this.windSpeeds[this.windSpeeds.length - 1]);
        ws = Math.max(ws, this.windSpeeds[0]);
        const h = 3600 / legCurve.interpolateVelocity(ws);
        for (let j = 0; j < result.handicaps.length; j++) {
          result.handicaps[j] += h * weight;
        }
        result.fixedWindSpeed += ws * weight;
      } else {
        for (let j = 0; j < result.handicaps.length; j++) {
          result.handicaps[j] += legCurve.handicaps[j] * weight;
        }
      }
    }
    return result;
  }
}

// ─── Race scoring (the module's TPCSRace.Score) ─────────────────────────────

export function scorePcsRace(input: PcsRaceInput): PcsRaceResult {
  const distanceNm =
    'legs' in input.course
      ? input.course.legs.reduce((sum, leg) => sum + leg.distanceNm, 0)
      : input.course.distanceNm;

  interface Working {
    input: PcsBoatInput;
    boat?: PcsBoat;
    curve?: PcsCurve;
    result: PcsBoatResult;
  }
  const working: Working[] = input.boats.map((b) => ({
    input: b,
    result: { id: b.id, todAtScoringWind: NaN, curve: [] },
  }));

  let boatIwUsed = input.useBoatImpliedWind ?? false;
  let minWs = Infinity;
  let maxWs = -Infinity;

  for (const w of working) {
    try {
      w.boat = new PcsBoat(w.input.allowances);
      w.curve =
        'legs' in input.course
          ? w.boat.scratchCurve(input.course.legs)
          : w.boat.modelCurve(input.course.model);
      w.result.curve = [...w.curve.handicaps];
      minWs = Math.min(minWs, w.boat.windSpeeds[0]);
      maxWs = Math.max(maxWs, w.boat.windSpeeds[w.boat.windSpeeds.length - 1]);
      boatIwUsed = boatIwUsed && !w.curve.fixed();
      if (w.input.elapsedSeconds != null && w.input.elapsedSeconds > 0) {
        const velocity = distanceNm / (w.input.elapsedSeconds / 3600);
        w.result.velocity = velocity;
        w.result.impliedWind = w.curve.fixed()
          ? w.curve.fixedWindSpeed
          : Math.max(w.boat.windSpeeds[0], round5(w.curve.approximateWind(velocity)));
      }
      try {
        w.curve.check();
      } catch (e) {
        w.result.warning = e instanceof Error ? e.message : String(e);
      }
    } catch (e) {
      w.result.error = e instanceof Error ? e.message : String(e);
    }
  }

  // The race's scoring wind: the best finisher's implied wind (402.9),
  // snapped to the tabulated range ends within the bisection precision —
  // unless the race committee overrides it (402.12).
  let scoringWind = 0;
  for (const w of working) {
    if (w.result.impliedWind == null || w.result.error) continue;
    scoringWind = Math.max(scoringWind, w.result.impliedWind);
    if (Math.abs(scoringWind - minWs) < APPROXIMATION_PRECISION) scoringWind = minWs;
    if (Math.abs(scoringWind - maxWs) < APPROXIMATION_PRECISION) scoringWind = maxWs;
  }
  if (input.scoringWindOverride != null) {
    scoringWind = Math.min(Math.max(input.scoringWindOverride, minWs), maxWs);
  }

  // Allowance at the scoring wind, per boat; the lowest is the scratch boat
  // (first-lowest on ties, matching the module's strict comparison).
  let scratchTod = 9999;
  let scratchBoatId: string | null = null;
  let scratch: Working | null = null;
  for (const w of working) {
    if (!w.curve || w.result.error) continue;
    w.result.todAtScoringWind = 3600 / w.curve.interpolateVelocity(scoringWind);
    if (scratchTod > w.result.todAtScoringWind) {
      scratchTod = w.result.todAtScoringWind;
      scratchBoatId = w.input.id;
      scratch = w;
    }
  }

  if (boatIwUsed && input.useBoatImpliedWind) {
    // Rule 402.10: each boat corrected from its own implied wind against the
    // scratch boat's curve. Ported for completeness; snapped range ends keep
    // the reference's special cases.
    for (const w of working) {
      if (!w.curve || w.result.error || w.result.impliedWind == null || w.input.elapsedSeconds == null || !scratch?.curve) continue;
      const es = w.input.elapsedSeconds;
      let corrected = 0;
      const iw = w.result.impliedWind;
      const atEnd = (end: number) => Math.abs(iw - end) < APPROXIMATION_PRECISION;
      if (atEnd(minWs) || atEnd(maxWs)) {
        const snapped = atEnd(minWs) ? minWs : maxWs;
        w.result.impliedWind = snapped;
        corrected =
          es -
          round0((3600 / w.curve.interpolateVelocity(snapped)) * distanceNm) +
          round0((3600 / scratch.curve.interpolateVelocity(snapped)) * distanceNm);
      }
      if (corrected === 0) {
        corrected = round0((3600 / scratch.curve.interpolateVelocity(w.result.impliedWind)) * distanceNm);
      }
      w.result.correctedSeconds = corrected;
    }
  } else {
    // Rule 402.9: CT = ES − round(ToD × D) + round(scratch ToD × D). The
    // products round separately, matching the module (and so possibly a
    // second apart from rounding the delta once).
    for (const w of working) {
      if (!w.curve || w.result.error || w.input.elapsedSeconds == null) continue;
      w.result.correctedSeconds =
        w.input.elapsedSeconds -
        round0(w.result.todAtScoringWind * distanceNm) +
        round0(scratchTod * distanceNm);
    }
  }

  const first = working.find((w) => w.boat);
  return {
    scoringWind,
    windSpeeds: first?.boat ? [...first.boat.windSpeeds] : [],
    scratchTod,
    scratchBoatId,
    distanceNm,
    boats: working.map((w) => w.result),
    boatImpliedWindUsed: Boolean(boatIwUsed && input.useBoatImpliedWind),
  };
}
