/**
 * "Likely the same boat" matching — the shared identity heuristic behind
 * sail-number-change detection on CSV re-import and the possible-duplicates
 * tier of Find duplicates.
 *
 * The premise: a boat's sail number can change between imports, but its
 * identity fields (boat name, primary person, helm) and fleet membership
 * rarely change at the same time. So two records with the same fleet set and
 * a matching non-empty boat name or person name — but different sail
 * numbers — are probably one boat.
 *
 * Pairing is deliberately conservative: a pair survives only when it is the
 * unique match in both directions. When two candidates could each claim the
 * same partner, neither is paired — creating a duplicate the scorer can see
 * is better than silently merging the wrong boat.
 */

/** Case- and whitespace-insensitive canonical form of an identity field.
 *  Empty (or whitespace-only) values normalise to '' and never match. */
export function normalizeIdentity(value: string | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

/** A record on either side of the pairing: a CSV row that matched no
 *  existing competitor, or an existing competitor whose sail number
 *  disappeared from the CSV. */
export interface MatchEntry<T> {
  /** The caller's underlying record (a row index, a Competitor, …). */
  item: T;
  /** Canonical key for the fleet set the record belongs to. Records only
   *  ever pair within the same key. */
  fleetKey: string;
  boatName: string;
  /** Primary identifying person (Competitor.name / the CSV primary column). */
  name: string;
  helm: string;
}

export interface MatchPair<A, B> {
  a: A;
  b: B;
  /** Which identity field matched — for display in review UIs. */
  matchedOn: 'boat name' | 'name';
}

function identityEdges<A, B>(a: MatchEntry<A>, b: MatchEntry<B>): 'boat name' | 'name' | null {
  if (a.fleetKey !== b.fleetKey) return null;
  const boatA = normalizeIdentity(a.boatName);
  if (boatA && boatA === normalizeIdentity(b.boatName)) return 'boat name';
  const nameA = normalizeIdentity(a.name);
  const helmA = normalizeIdentity(a.helm);
  const nameB = normalizeIdentity(b.name);
  const helmB = normalizeIdentity(b.helm);
  // Any non-empty person-field agreement counts: a person recorded as the
  // primary in one import can show up in the helm column of the next.
  for (const x of [nameA, helmA]) {
    if (x && (x === nameB || x === helmB)) return 'name';
  }
  return null;
}

/**
 * Pairs entries from `left` with entries from `right` where the identity
 * heuristic matches, keeping only pairs unique in both directions.
 */
export function matchLikelySameBoat<A, B>(
  left: MatchEntry<A>[],
  right: MatchEntry<B>[],
): MatchPair<A, B>[] {
  type Edge = { li: number; ri: number; matchedOn: 'boat name' | 'name' };
  const edges: Edge[] = [];
  for (let li = 0; li < left.length; li++) {
    for (let ri = 0; ri < right.length; ri++) {
      const matchedOn = identityEdges(left[li], right[ri]);
      if (matchedOn) edges.push({ li, ri, matchedOn });
    }
  }
  const leftDegree = new Map<number, number>();
  const rightDegree = new Map<number, number>();
  for (const e of edges) {
    leftDegree.set(e.li, (leftDegree.get(e.li) ?? 0) + 1);
    rightDegree.set(e.ri, (rightDegree.get(e.ri) ?? 0) + 1);
  }
  return edges
    .filter((e) => leftDegree.get(e.li) === 1 && rightDegree.get(e.ri) === 1)
    .map((e) => ({ a: left[e.li].item, b: right[e.ri].item, matchedOn: e.matchedOn }));
}
