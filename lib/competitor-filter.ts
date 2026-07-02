/**
 * Client-side filter predicate for the competitors table. Matching is
 * case-insensitive over the identity fields a scorer would recognise a
 * boat by; a multi-word query requires every word to match somewhere
 * ("j24 smith" narrows to J24s helmed by a Smith).
 */
import type { Competitor } from './types';

function haystack(c: Competitor): string {
  return [
    c.sailNumber,
    c.boatName,
    c.boatClass,
    c.name,
    c.helm,
    c.owner,
    c.crewName,
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
