/**
 * Cubic-spline interpolation, ported from the spline3 unit of ORC's
 * public-domain PCS module (itself derived from the ALGLIB project,
 * copyright 23.06.2007 Bochkanov Sergey). The port is deliberately
 * literal — bit-for-bit agreement with the reference module is the whole
 * point — covering only the pieces PCS uses: the cubic spline with
 * parabolically-terminated boundaries (boundary type 0) and its
 * evaluation.
 *
 * The packed coefficient table layout is the ALGLIB one:
 *   c[0] = table length, c[1] = 3 (cubic), c[2] = n,
 *   c[3..3+n-1] = x[i], then per-interval [y, d, c2, c3] quadruples.
 */

export type SplineCoefficients = number[];

/** Ascending-x sort of paired points (the reference heap-sorts; inputs here
 *  are already ascending, but the sort is kept so behaviour matches for any
 *  input). */
function sortPoints(x: number[], y: number[], d?: number[]): void {
  const idx = x.map((_, i) => i).sort((a, b) => x[a] - x[b]);
  const xs = idx.map((i) => x[i]);
  const ys = idx.map((i) => y[i]);
  const ds = d ? idx.map((i) => d[i]) : undefined;
  for (let i = 0; i < x.length; i++) {
    x[i] = xs[i];
    y[i] = ys[i];
    if (d && ds) d[i] = ds[i];
  }
}

function solveTridiagonal(a: number[], b: number[], c: number[], d: number[], n: number): number[] {
  a = [...a];
  b = [...b];
  c = [...c];
  d = [...d];
  const x = new Array<number>(n);
  a[0] = 0;
  c[n - 1] = 0;
  for (let k = 1; k <= n - 1; k++) {
    const t = a[k] / b[k - 1];
    b[k] = b[k] - t * c[k - 1];
    d[k] = d[k] - t * d[k - 1];
  }
  x[n - 1] = d[n - 1] / b[n - 1];
  for (let k = n - 2; k >= 0; k--) {
    x[k] = (d[k] - c[k] * x[k + 1]) / b[k];
  }
  return x;
}

function buildHermiteSpline(x: number[], y: number[], d: number[], n: number): SplineCoefficients {
  x = [...x];
  y = [...y];
  d = [...d];
  sortPoints(x, y, d);
  const tblSize = 3 + n + (n - 1) * 4;
  const c = new Array<number>(tblSize);
  c[0] = tblSize;
  c[1] = 3;
  c[2] = n;
  for (let i = 0; i <= n - 1; i++) c[3 + i] = x[i];
  for (let i = 0; i <= n - 2; i++) {
    const delta = x[i + 1] - x[i];
    const delta2 = delta * delta;
    const delta3 = delta * delta2;
    c[3 + n + 4 * i + 0] = y[i];
    c[3 + n + 4 * i + 1] = d[i];
    c[3 + n + 4 * i + 2] = (3 * (y[i + 1] - y[i]) - 2 * d[i] * delta - d[i + 1] * delta) / delta2;
    c[3 + n + 4 * i + 3] = (2 * (y[i] - y[i + 1]) + d[i] * delta + d[i + 1] * delta) / delta3;
  }
  return c;
}

/**
 * Build the cubic spline the PCS module builds: parabolically terminated at
 * both ends (the reference passes boundary type 0 everywhere).
 */
export function buildCubicSpline(xIn: number[], yIn: number[]): SplineCoefficients {
  const n = xIn.length;
  if (n < 2) throw new Error('buildCubicSpline: fewer than 2 points');
  const x = [...xIn];
  const y = [...yIn];
  // N=2 with parabolic termination degenerates to the natural-boundary case
  // in the reference; that in turn is a straight line through the points.
  if (n === 2) {
    sortPoints(x, y);
    const slope = (y[1] - y[0]) / (x[1] - x[0]);
    return buildHermiteSpline(x, y, [slope, slope], n);
  }
  sortPoints(x, y);

  const a1 = new Array<number>(n);
  const a2 = new Array<number>(n);
  const a3 = new Array<number>(n);
  const b = new Array<number>(n);

  // Left boundary: parabolic termination.
  a1[0] = 0;
  a2[0] = 1;
  a3[0] = 1;
  b[0] = (2 * (y[1] - y[0])) / (x[1] - x[0]);

  for (let i = 1; i <= n - 2; i++) {
    a1[i] = x[i + 1] - x[i];
    a2[i] = 2 * (x[i + 1] - x[i - 1]);
    a3[i] = x[i] - x[i - 1];
    b[i] =
      ((3 * (y[i] - y[i - 1])) / (x[i] - x[i - 1])) * (x[i + 1] - x[i]) +
      ((3 * (y[i + 1] - y[i])) / (x[i + 1] - x[i])) * (x[i] - x[i - 1]);
  }

  // Right boundary: parabolic termination.
  a1[n - 1] = 1;
  a2[n - 1] = 1;
  a3[n - 1] = 0;
  b[n - 1] = (2 * (y[n - 1] - y[n - 2])) / (x[n - 1] - x[n - 2]);

  const d = solveTridiagonal(a1, a2, a3, b, n);
  return buildHermiteSpline(x, y, d, n);
}

export function splineInterpolate(c: SplineCoefficients, xValue: number): number {
  if (Math.round(c[1]) !== 3) throw new Error('splineInterpolate: incorrect coefficient table');
  const n = Math.round(c[2]);
  // Binary search over [x[0] … x[n-2]] (x[n-1] excluded), as the reference.
  let l = 3;
  let r = 3 + n - 2 + 1;
  while (l !== r - 1) {
    const m = Math.floor((l + r) / 2);
    if (c[m] >= xValue) r = m;
    else l = m;
  }
  const x = xValue - c[l];
  const m = 3 + n + 4 * (l - 3);
  return c[m] + x * (c[m + 1] + x * (c[m + 2] + x * c[m + 3]));
}
