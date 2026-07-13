/**
 * Pure matching primitives for the cross-series competitor-identity spine
 * (#212). Where `rating-match.ts` matches a competitor to an external *rating*
 * by sail number and boat name, this module matches a competitor to a recurring
 * *person* across series — the signals the reconcile pass clusters on.
 *
 * Pure: no `server-only`, no network, no DB. Designed for a single-handed
 * junior dinghy class (IODAI Optimists) where the recurring identity is a
 * person, so the spine is the person's name, corroborated by club and (where
 * present) implied birth year. Sail-number continuity is handled by
 * `rating-match.ts` (`sailNumberParts` / `sailNumbersMatch`).
 *
 * The deliberate bias: across a 17-year corpus, names recur and sail numbers
 * turn over, so name is the cross-season spine and the matcher tolerates
 * initial-vs-full given names. It refuses to fuse two different given names
 * sharing a surname (`Jack` vs `John Keating`) — namesakes stay split, because
 * a wrong split is one click to fix in the reconcile UI and a wrong merge
 * silently corrupts a career arc.
 */

/** A person's name decomposed for matching. `full` never matches when empty. */
export interface NormalizedPersonName {
  /** Normalised surname (last whitespace-separated token). */
  surname: string;
  /** Normalised given-name tokens, in order. */
  given: string[];
  /** All tokens joined by a space — a stable canonical form for display/debug. */
  full: string;
}

/** Lowercase, strip diacritics, drop everything that isn't a letter. */
function normalizeToken(token: string): string {
  return token
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z]/g, '');
}

/**
 * Decompose a `"Firstname … Surname"` string into normalised given tokens and a
 * surname. Apostrophes, hyphens, accents and case are folded
 * (`"Aoife O'Toole"` → given `["aoife"]`, surname `"otoole"`). The last
 * whitespace-separated token is taken as the surname — correct for the Irish
 * junior-sailing names this targets; compound surnames (`"van der Berg"`) fold
 * to their final token, which is conservative (more likely to split than fuse).
 * Empty / punctuation-only input yields an all-empty result that never matches.
 */
export function normalizePersonName(name: string | undefined): NormalizedPersonName {
  const tokens = (name ?? '')
    .trim()
    .split(/\s+/)
    .map(normalizeToken)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return { surname: '', given: [], full: '' };
  const surname = tokens[tokens.length - 1];
  const given = tokens.slice(0, -1);
  return { surname, given, full: tokens.join(' ') };
}

/** Whether two given-name tokens are compatible: equal, or one a single-letter
 *  initial of the other (`"j"` ~ `"john"`). */
function givenTokensCompatible(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length === 1) return b.startsWith(a);
  if (b.length === 1) return a.startsWith(b);
  return false;
}

/**
 * Whether two normalised names plausibly refer to the same person. Surnames
 * must be equal and non-empty; *both* sides must carry at least one given name,
 * and the leading given tokens must all be compatible (`givenTokensCompatible`,
 * so `"J Keating"` ~ `"John Keating"`). Differing concrete first names
 * (`"Jack"` vs `"John"`) never match.
 *
 * A **bare surname matches nobody**: a row recorded as just `"Dempsey"` is not
 * evidence that it's the *same* Dempsey as any other, and treating it as a
 * match makes it a hub that fuses every same-surname person (the real
 * three-sibling Dempsey over-merge: a lone `"Dempsey"` row bridged Ella,
 * Edward, and Jonathan into one identity). Such rows stay unlinked singletons
 * for the scorer to attach by hand — the deliberate under-merge bias.
 */
export function personNamesMatch(
  a: NormalizedPersonName,
  b: NormalizedPersonName,
): boolean {
  if (!a.surname || a.surname !== b.surname) return false;
  if (a.given.length === 0 || b.given.length === 0) return false;
  const n = Math.min(a.given.length, b.given.length);
  for (let i = 0; i < n; i++) {
    if (!givenTokensCompatible(a.given[i], b.given[i])) return false;
  }
  return true;
}

/**
 * Split a club field into its normalised constituent clubs. Sailors commonly
 * list more than one (`"WHSC / RCYC"`, `"TBSC/CHSC"`) — splitting on `/` lets a
 * later season's `"RCYC"` corroborate an earlier `"WHSC / RCYC"`. Lowercased,
 * punctuation and whitespace stripped per token.
 */
export function normalizeClubs(club: string | undefined): string[] {
  return (club ?? '')
    .split('/')
    .map((c) => c.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, ''))
    .filter((c) => c.length > 0);
}

/**
 * Whether two club fields share at least one club, treating an empty field as
 * compatible (unknown, not disqualifying). A corroborating signal only — never
 * sufficient on its own to link.
 */
export function clubsOverlap(a: string | undefined, b: string | undefined): boolean {
  const ca = normalizeClubs(a);
  const cb = normalizeClubs(b);
  if (ca.length === 0 || cb.length === 0) return true;
  return ca.some((c) => cb.includes(c));
}

/**
 * Implied birth year from a competitor's age at a dated event:
 * `raceYear − age`. A *transient* reconciliation signal — recomputed from the
 * linked rows each pass, never persisted (see the schema note). Returns null
 * when age is unrecorded (true of most pre-2020 IODAI rows) or the race year is
 * unknown, so the matcher must treat null as "no signal", not a conflict.
 */
export function impliedBirthYear(
  age: number | null | undefined,
  raceYear: number | null | undefined,
): number | null {
  if (age == null || raceYear == null || !Number.isFinite(raceYear)) return null;
  return raceYear - age;
}

/**
 * Whether two implied birth years *conflict* — both known and more than a year
 * apart (one year of slop absorbs age-cutoff and rounding differences between
 * events). A conflict is a hard split signal: it separates two real namesakes.
 * Returns false when either year is unknown (no signal, never blocks a link).
 */
export function birthYearsConflict(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return false;
  return Math.abs(a - b) > 1;
}

/**
 * Whether a name is the archive ingest's placeholder for a blank helm field
 * ("Unknown Competitor (1620)", ADR-010). Placeholders exist so competitor
 * listings sort sensibly, but they are *not* evidence of identity: two
 * unknowns sharing a reused sail number are not the same sailor, so the
 * matcher must treat these rows exactly like blank names — never clustered,
 * never suggested.
 */
export function isPlaceholderName(name: string | undefined): boolean {
  return /^unknown competitor\b/i.test((name ?? '').trim());
}
