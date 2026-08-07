/**
 * Client-side filter predicate for the competitors table. Matching is
 * case-insensitive over the identity fields a scorer would recognise a
 * boat by; a multi-word query requires every word to match somewhere
 * ("j24 smith" narrows to J24s helmed by a Smith).
 *
 * The alternative and bow numbers are searchable too: a scorer holding a
 * finish sheet written in whatever number the boat actually showed needs to
 * find the entry from that number, not only from the registered one.
 */
import type { Competitor } from './types';

function haystack(c: Competitor): string {
  return [
    c.sailNumber,
    ...(c.alternativeSailNumbers ?? []),
    c.bowNumber,
    c.boatName,
    c.boatClass,
    ...c.names,
    ...(c.helms ?? []),
    ...(c.owners ?? []),
    ...(c.crewNames ?? []),
    c.club,
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
}

export function competitorMatchesFilter(c: Competitor, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = haystack(c);
  return words.every((w) => hay.includes(w));
}
