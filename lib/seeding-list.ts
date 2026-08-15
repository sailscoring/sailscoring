/**
 * Joining an organising authority's seed ranking to the entry list.
 *
 * A seeding committee assigns the initial qualifying fleets from a ranking it
 * did not produce — a World Sailing ranking table for an Olympic class, a class
 * association's own qualification list. That document ranks *sailors*; so, at a
 * championship where boats are chartered, does the entry list. The World
 * Sailing Sailor ID is the only key the two reliably share, which is why this
 * module joins on it and treats everything else as a suggestion.
 *
 * What lands on the competitor is `seed`, which the split-fleet initial
 * assignment orders by. The rank written is the one the ranking states — a
 * global rank of 3, 17, 240 — not a densified 1..n over the entries present.
 * Ordering is all `seedOrder` needs, and preserving the published numbers lets
 * a scorer check the import against the document it came from.
 *
 * Sailors with no row in the ranking are left with no seed. That is the
 * correct outcome, not a failure: the ranking is global and an entry list is
 * not, so unranked sailors sort to the bottom, which is where a seeding
 * committee puts them.
 */

import { nameTokens, namesAgree } from './person-names';
import { normalizeWorldSailingId } from './world-sailing';

/** One row of the supplied ranking, already column-mapped. */
export interface SeedingListRow {
  /** 1-based row number in the source document, for error reporting. */
  rowNumber: number;
  /** The rank as stated. */
  rank: number;
  worldSailingId?: string;
  name?: string;
  nationality?: string;
}

/** What a competitor in the series can carry into the join. */
export interface SeedingCandidate {
  id: string;
  worldSailingId?: string;
  names: readonly string[];
  nationality?: string;
}

export type SeedingMatchBasis = 'world-sailing-id' | 'name-and-nation';

export interface SeedingMatch {
  row: SeedingListRow;
  competitorId: string;
  basis: SeedingMatchBasis;
}

export interface SeedingPlan {
  /** Joined on the Sailor ID — applied without asking. */
  matched: SeedingMatch[];
  /** Joined on name and nation instead. Offered, never applied silently: a
   *  name match is a guess, and a wrong seed puts a sailor in the wrong fleet
   *  on day one. */
  suggested: SeedingMatch[];
  /** Ranking rows that matched nobody. Usually unremarkable — the ranking
   *  covers a class, the entry list covers an event. */
  unmatchedRows: SeedingListRow[];
  /** Competitors no ranking row reached. The interesting direction: these are
   *  the sailors who will sort below the ranked ones. */
  unrankedCompetitorIds: string[];
  /** Rows dropped before matching, with the reason. */
  rejected: { row: SeedingListRow; reason: string }[];
}

/**
 * Canonical form of a person's name for the fallback join: accents folded,
 * case and punctuation dropped, and the name parts sorted so that
 * "Murphy Mark" and "Mark Murphy" agree. Aggressive on purpose — it only ever
 * produces a suggestion for a human to confirm.
 */
export function normalizePersonName(value: string | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

/** Every name a competitor could be listed under in a ranking. */
function candidateNameKeys(c: SeedingCandidate): string[] {
  return c.names.map(normalizePersonName).filter(Boolean);
}

function nameNationKey(name: string, nationality: string | undefined): string {
  return `${name} ${(nationality ?? '').trim().toUpperCase()}`;
}

function nationKey(nationality: string | undefined): string {
  return (nationality ?? '').trim().toUpperCase();
}

/**
 * When the canonical name key misses, compare the way two lists of the same
 * sailors actually differ — a middle name in one and not the other, a
 * shortened given name, a letter of transliteration. A ranking published by
 * an organising authority and an entry list typed by a club rarely agree on
 * all of that.
 *
 * Nation still has to agree exactly, as it does for the canonical key, and
 * the result is still only ever a suggestion.
 */
function looseNameHits(
  row: SeedingListRow,
  candidates: readonly SeedingCandidate[],
): SeedingCandidate[] {
  const theirs = nameTokens(row.name);
  if (theirs.length === 0) return [];
  const nation = nationKey(row.nationality);
  return candidates.filter(
    (c) =>
      nationKey(c.nationality) === nation &&
      c.names.some((name) => namesAgree(nameTokens(name), theirs) !== 'different'),
  );
}

/**
 * Plan the join. Nothing is written here — the caller decides which
 * suggestions to accept and applies the result.
 */
export function planSeedingImport(
  rows: readonly SeedingListRow[],
  competitors: readonly SeedingCandidate[],
): SeedingPlan {
  const matched: SeedingMatch[] = [];
  const suggested: SeedingMatch[] = [];
  const unmatchedRows: SeedingListRow[] = [];
  const rejected: { row: SeedingListRow; reason: string }[] = [];

  const byId = new Map<string, SeedingCandidate[]>();
  for (const c of competitors) {
    const id = normalizeWorldSailingId(c.worldSailingId);
    if (!id) continue;
    const list = byId.get(id);
    if (list) list.push(c);
    else byId.set(id, [c]);
  }

  // Name+nation keys are built only for competitors with no Sailor ID match to
  // make — a sailor already joined by ID is never second-guessed by a name.
  const byNameNation = new Map<string, SeedingCandidate[]>();
  for (const c of competitors) {
    for (const key of candidateNameKeys(c)) {
      const k = nameNationKey(key, c.nationality);
      const list = byNameNation.get(k);
      if (list) list.push(c);
      else byNameNation.set(k, [c]);
    }
  }

  const claimed = new Set<string>();
  const seenRanks = new Set<number>();
  // Two passes, so an ID match always wins a competitor over a name match on
  // some other row — regardless of which row came first in the document.
  const remaining: SeedingListRow[] = [];
  for (const row of rows) {
    if (!Number.isInteger(row.rank) || row.rank <= 0) {
      rejected.push({ row, reason: 'no usable rank' });
      continue;
    }
    if (seenRanks.has(row.rank)) {
      // A ranking with a repeated rank is a mis-mapped column far more often
      // than a genuine dead heat, and a duplicated seed silently breaks the
      // assignment pattern's alternation.
      rejected.push({ row, reason: `rank ${row.rank} appears more than once` });
      continue;
    }
    seenRanks.add(row.rank);

    const id = normalizeWorldSailingId(row.worldSailingId);
    const hits = id ? (byId.get(id) ?? []) : [];
    if (hits.length === 1) {
      matched.push({ row, competitorId: hits[0].id, basis: 'world-sailing-id' });
      claimed.add(hits[0].id);
      continue;
    }
    if (hits.length > 1) {
      rejected.push({ row, reason: `Sailor ID ${id} is on more than one entry` });
      continue;
    }
    remaining.push(row);
  }

  for (const row of remaining) {
    const key = normalizePersonName(row.name);
    const exact = key
      ? (byNameNation.get(nameNationKey(key, row.nationality)) ?? []).filter(
          (c) => !claimed.has(c.id),
        )
      : [];
    // The looser comparison only gets a say where the canonical key found
    // nobody, so an exactly-spelled name is never passed over for a near one.
    const hits =
      exact.length > 0 ? exact : looseNameHits(row, competitors.filter((c) => !claimed.has(c.id)));
    // Unique in both directions or not at all — the same conservatism
    // `matchLikelySameBoat` applies. Two sailors sharing a name and a nation
    // is exactly the case a human has to settle.
    if (hits.length === 1) {
      suggested.push({ row, competitorId: hits[0].id, basis: 'name-and-nation' });
      // Claimed even though it is only a suggestion: one competitor holds one
      // seed, so a later row must look elsewhere.
      claimed.add(hits[0].id);
      continue;
    }
    unmatchedRows.push(row);
  }

  const reached = new Set([
    ...matched.map((m) => m.competitorId),
    ...suggested.map((m) => m.competitorId),
  ]);
  return {
    matched,
    suggested,
    unmatchedRows,
    unrankedCompetitorIds: competitors.filter((c) => !reached.has(c.id)).map((c) => c.id),
    rejected,
  };
}

/** Header detection for the ranking's columns. Separate from the competitor
 *  importer's: a ranking has a rank column, which an entry list does not, and
 *  its name column is a person rather than a boat. */
export type SeedingColumn = 'rank' | 'worldSailingId' | 'name' | 'nationality' | 'ignore';

export function autoDetectSeedingColumn(header: string): SeedingColumn {
  const h = header.trim().replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  if (/world\s*sailing|sailor\s*id|\bwsid\b|\bws\s*id\b|\bisaf\b|ifperson/.test(h))
    return 'worldSailingId';
  if (/\brank\b|\branking\b|\bseed(ing)?\b|\bpos(ition)?\b|^#$/.test(h)) return 'rank';
  if (/\bnat\b|nationality|country|\bnoc\b|\bmna\b/.test(h)) return 'nationality';
  if (/name|sailor|helm|competitor/.test(h)) return 'name';
  return 'ignore';
}
