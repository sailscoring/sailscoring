import type { Finish } from './types';

/**
 * A race's finishes with at most one row per competitor.
 *
 * A boat has one result in a race, so she should have one row. Data written
 * before linking an unknown sail number folded into the boat's existing row
 * can hold two — the placed row the sheet shows, and a check-in or coded row
 * left off it. Everything that looks a boat's finish up by competitor goes
 * through here so that the sheet and the scoring agree on which row counts:
 * the placed one, since that is the row the scorer sees and edits. Among
 * rows equally placed (or equally not), the later one wins, as a plain
 * last-write map would have it.
 *
 * Rows without a competitor (unknown sail numbers) are all kept. Order is
 * preserved.
 */
export function oneFinishPerCompetitor<F extends Pick<Finish, 'competitorId' | 'sortOrder'>>(
  finishes: readonly F[],
): F[] {
  const chosen = new Map<string, F>();
  let duplicated = false;
  for (const f of finishes) {
    if (f.competitorId === null) continue;
    const prior = chosen.get(f.competitorId);
    if (prior) duplicated = true;
    if (!prior || f.sortOrder !== null || prior.sortOrder === null) chosen.set(f.competitorId, f);
  }
  if (!duplicated) return [...finishes];
  return finishes.filter((f) => f.competitorId === null || chosen.get(f.competitorId) === f);
}
