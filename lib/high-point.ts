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
