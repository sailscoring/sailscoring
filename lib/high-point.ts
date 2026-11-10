/**
 * High-point scoring: a boat scores for the boats she beats, a race she
 * misses scores 0, and the highest total wins. The alternative to RRS
 * Appendix A's low point that some clubs score long series with (Bray SC's
 * dinghy series, ISORA's offshore season).
 */

import type { HighPointFormula, Series } from './types';

/** The series fields that say how it scores points. */
export type PointsSystemFields = Pick<Series, 'pointsSystem' | 'highPointFormula' | 'pointForComingToStart'>;

/**
 * A series' points-system fields, normalised for storage and the file
 * formats: low point carries none of them, high point always names its
 * formula, and the point for coming to the start belongs to boats beaten
 * alone. Every key is present, so spreading the result over a stored series
 * also clears what a low-point source doesn't carry.
 */
export function pointsSystemFields(s: Partial<PointsSystemFields>): PointsSystemFields {
  if (s.pointsSystem !== 'highPoint') {
    return { pointsSystem: undefined, highPointFormula: undefined, pointForComingToStart: undefined };
  }
  const formula: HighPointFormula = s.highPointFormula ?? 'boatsBeaten';
  return {
    pointsSystem: 'highPoint',
    highPointFormula: formula,
    pointForComingToStart: formula === 'boatsBeaten' && s.pointForComingToStart ? true : undefined,
  };
}

/** How a high-point series scores: the formula, and for boats beaten whether
 *  a boat earns a point for coming to the start. Absent is low point. */
export interface HighPointScoring {
  formula: HighPointFormula;
  pointForComingToStart: boolean;
}

/** The high-point scoring a series states, or undefined for low point. */
export function highPointOf(s: Partial<PointsSystemFields>): HighPointScoring | undefined {
  const f = pointsSystemFields(s);
  if (f.pointsSystem !== 'highPoint') return undefined;
  return { formula: f.highPointFormula!, pointForComingToStart: f.pointForComingToStart === true };
}

/**
 * Chipstead SC's CHIPS3 points for place `p` of `n` boats, unrounded:
 *
 *   95 · [ ((n+1−p)/n) · (1 − 0.986682·e^(−0.1622·n)) + 0.81475·e^(−0.1622·n) ] + 5
 *
 * A win scores 86.1 alone and approaches 100 as the fleet grows; the place
 * after the last (p = n + 1) is what a retirement scores. Rounding is left to
 * the standings, which round once, after the race's weighting — the only
 * order that reproduces ISORA's published scores.
 */
export function chips3(p: number, n: number): number {
  if (n <= 0) return 0;
  const e = Math.exp(-0.1622 * n);
  return 95 * (((n + 1 - p) / n) * (1 - 0.986682 * e) + 0.81475 * e) + 5;
}

/**
 * The points for place `p` in a race of `n` boats, unrounded. Boats beaten
 * is n + 1 − p, one more with the point for coming to the start; CHIPS3 is
 * the formula above. Never below 0: a code set to the place two after the
 * last can't take points away.
 */
export function highPointPlacePoints(hp: HighPointScoring, p: number, n: number): number {
  if (hp.formula === 'chips3') return Math.max(0, chips3(p, n));
  return Math.max(0, n + 1 - p) + (hp.pointForComingToStart ? 1 : 0);
}

/** The points boats tied for `count` places from `firstPlace` share (RRS A7):
 *  the average of the places' points, unrounded. */
export function highPointTiedPoints(hp: HighPointScoring, firstPlace: number, count: number, n: number): number {
  let sum = 0;
  for (let k = 0; k < count; k++) sum += highPointPlacePoints(hp, firstPlace + k, n);
  return sum / count;
}

/**
 * What one place is worth in a race of `n` boats: the points a boat loses by
 * finishing a place lower. Both formulas are linear in the place, so a
 * penalty of 4.2 places is 4.2 of these. Boats beaten: 1. CHIPS3: 9.9 in a
 * fleet of 6, 4.6 in a fleet of 20.
 */
export function highPointPlaceStep(hp: HighPointScoring, n: number): number {
  if (hp.formula !== 'chips3') return 1;
  if (n <= 0) return 0;
  return (95 * (1 - 0.986682 * Math.exp(-0.1622 * n))) / n;
}

/**
 * What a percentage penalty comes to in a race of `n` boats. In low point
 * rule 44.3(c)'s percentage is a share of the DNF score, which is a place,
 * the one after the last; high point takes that share of place n + 1, to the
 * nearest tenth of a place, at what a place is worth.
 */
export function highPointPercentPenalty(hp: HighPointScoring, percent: number, n: number): { places: number; points: number } {
  const places = Math.round((percent * (n + 1)) / 10) / 10;
  return { places, points: places * highPointPlaceStep(hp, n) };
}

/** What a series holds that high point can’t score. */
export interface HighPointBlockers {
  /** The series is a split-fleet championship. */
  splitFleet?: boolean;
}

/**
 * Why a series can’t score high point as it stands, in the scorer’s words,
 * or null when it can. Refused rather than scored wrongly: the split-fleet
 * stages’ medal doubling and carried scores are written for low point, where
 * more points are worse.
 */
export function highPointRefusal(b: HighPointBlockers): string | null {
  if (b.splitFleet) {
    return 'A split-fleet championship can’t be scored high point: its stages are scored low point.';
  }
  return null;
}

/**
 * Why a series can’t score low point as it stands, or null when it can: a
 * code of its own that takes a share of the boat’s points is a high-point
 * penalty. In low point a share of a low score would cost the boats that
 * finished well the least.
 */
export function lowPointRefusal(scoringCodes: readonly { code: string; rule: { type: string } }[] = []): string | null {
  const codes = scoringCodes.filter((c) => c.rule.type === 'reducePercent').map((c) => c.code);
  if (codes.length === 0) return null;
  return `A low-point series can’t score a code that takes a share of the boat’s points (${codes.join(', ')}). Change or remove ${codes.length === 1 ? 'it' : 'them'} first.`;
}

/** The points system in a few words, as the Scoring card's collapsed line
 *  and a published caption name it: "Low point", "High point (boats
 *  beaten)", "High point (boats beaten, +1 for coming to the start)",
 *  "High point (CHIPS3)". */
export function pointsSystemSummary(s: Partial<PointsSystemFields>): string {
  const hp = highPointOf(s);
  if (!hp) return 'Low point';
  if (hp.formula === 'chips3') return 'High point (CHIPS3)';
  return hp.pointForComingToStart ? 'High point (boats beaten, +1 for coming to the start)' : 'High point (boats beaten)';
}

/** The note a published page carries under its results, saying how points
 *  were scored — a reader used to low point needs telling the order runs the
 *  other way. */
export function pointsSystemNote(hp: HighPointScoring): string {
  if (hp.formula === 'chips3') {
    return 'High point: each race scores CHIPS3 for the boats in it, × the race’s weighting; highest total wins.';
  }
  return `High point: 1 point for finishing and 1 for each boat beaten${hp.pointForComingToStart ? ', and 1 for coming to the start' : ''}; highest total wins.`;
}

/** A high-point race table's caption: what a reader needs to check a score —
 *  "High point · 11 boats in the race · weight 1.2". */
export function highPointRaceCaption(fleetSize: number, multiplier: number | undefined): string {
  const boats = `${fleetSize} ${fleetSize === 1 ? 'boat' : 'boats'} in the race`;
  return `High point · ${boats}${multiplier != null && multiplier !== 1 ? ` · weight ${multiplier}` : ''}`;
}
