/**
 * Per-race scoring options — the shared vocabulary for `Race.discardPolicy`
 * and `Race.pointsMultiplier` (#342).
 *
 * Pure, so both the engine and the client UI can use it: the dialog's preview
 * line ("1st scores 2, 2nd 4, 3rd 6") is computed with the same function the
 * standings are, which is the only way the two can't drift.
 */

import type { Race, RaceDiscardPolicy } from './types';

/** How a race's scores count once the weighting is applied.
 *
 *  Rounded to a tenth (0.05 up, as RRS A9 rounds averages), keeping the
 *  engine-wide invariant that a race score is a multiple of 0.1 — a ×1.5 on a
 *  shared 2.5 would otherwise land on 3.75. */
export function weightedRacePoints(points: number, multiplier: number | undefined): number {
  if (multiplier == null || multiplier === 1) return points;
  return Math.floor(points * multiplier * 10 + 0.5) / 10;
}

/** The multiplier a race actually applies (absent means it counts once). */
export function raceMultiplier(race: Pick<Race, 'pointsMultiplier'>): number {
  return race.pointsMultiplier ?? 1;
}

export function racePolicy(race: Pick<Race, 'discardPolicy'>): RaceDiscardPolicy {
  return race.discardPolicy ?? 'normal';
}

/** Whether a race carries any option at all — what the chip, the badges and
 *  the standings legend all key off. */
export function hasScoringOptions(
  race: Pick<Race, 'discardPolicy' | 'pointsMultiplier'>,
): boolean {
  return racePolicy(race) !== 'normal' || raceMultiplier(race) !== 1;
}

export const DISCARD_POLICY_LABEL: Record<RaceDiscardPolicy, string> = {
  normal: 'Normal',
  mustCount: 'Must count',
  discardFirst: 'Discard first',
};

export const DISCARD_POLICY_HINT: Record<RaceDiscardPolicy, string> = {
  normal: "discarded if it's a competitor's worst",
  mustCount: "never discarded, even if it's the worst",
  discardFirst: 'dropped before any other race, whatever the points',
};

/** "×2", "×0.5" — the multiplier as it appears in a badge or column header. */
export function formatMultiplier(multiplier: number): string {
  return `×${multiplier}`;
}

/**
 * One-line summary of a race's options for a chip or badge row: "×2 · must
 * count", "must count", "×0.5". Empty when the race is ordinary — callers
 * decide whether that reads as "standard" or as nothing at all.
 */
export function scoringOptionsSummary(
  race: Pick<Race, 'discardPolicy' | 'pointsMultiplier'>,
): string {
  const parts: string[] = [];
  const multiplier = raceMultiplier(race);
  if (multiplier !== 1) parts.push(formatMultiplier(multiplier));
  const policy = racePolicy(race);
  if (policy !== 'normal') parts.push(DISCARD_POLICY_LABEL[policy].toLowerCase());
  return parts.join(' · ');
}

/**
 * The dialog's preview of what a weighting does to the top places, as a
 * sentence: "1st scores 2, 2nd 4, 3rd 6 …". Scoring is low-point throughout
 * (RRS Appendix A), so a place's score is its position — the preview is the
 * weighting applied to 1, 2, 3.
 */
export function weightingPreview(multiplier: number): string {
  const places = ['1st', '2nd', '3rd'];
  const scores = places.map((_, i) => weightedRacePoints(i + 1, multiplier));
  return `1st scores ${scores[0]}, 2nd ${scores[1]}, 3rd ${scores[2]} …`;
}

/**
 * A legend line naming what each option on a race does, for the foot of a
 * standings table where the arithmetic would otherwise have to be inferred.
 * Empty for an ordinary race.
 */
export function scoringOptionsLegend(
  race: Pick<Race, 'discardPolicy' | 'pointsMultiplier'>,
  raceLabel: string,
): string {
  const clauses: string[] = [];
  const multiplier = raceMultiplier(race);
  if (multiplier !== 1) {
    clauses.push(multiplier === 2 ? 'counts double' : `counts ${formatMultiplier(multiplier)}`);
  }
  const policy = racePolicy(race);
  if (policy === 'mustCount') clauses.push('must count and is never discarded');
  if (policy === 'discardFirst') clauses.push('is discarded before any other race');
  if (clauses.length === 0) return '';
  return `${raceLabel} ${clauses.join(', and ')}.`;
}
