// How finely a course is recorded for ORC scoring: its legs as measured, and
// its length as rule 401.3 records it.

const round = (n: number, dp: number): number => Math.round(n * 10 ** dp) / 10 ** dp;

/**
 * A leg's distance as it is kept: to 0.001 NM, about 2 m, which is as finely
 * as a leg is measured. ORC gives no precision for a leg — rule 401.3's
 * 0.01 NM is for the course's length (see {@link courseLength}) — and ORC
 * Scorer keeps a leg as it was entered, weighting the course by it, and only
 * prints it to 0.01. Every leg reaching storage goes through here.
 */
export function legDistance(nm: number): number {
  return round(nm, 3);
}

/**
 * A course's length as ORC records it for corrected time: to 0.01 NM (rule
 * 401.3, "when the length of the course is needed for calculation of
 * corrected time, it shall be recorded to a precision of 0.01 NM"). For a
 * constructed course it is the legs added as kept and then rounded, which
 * also clears the noise floating-point addition leaves.
 */
export function courseLength(nm: number): number {
  return round(nm, 2);
}
