/**
 * Pure clustering core for the competitor-identity reconcile pass (#212).
 *
 * Collapses a workspace's per-series competitor rows into candidate recurring
 * identities by union-find over the matching signals in
 * `competitor-identity-match.ts`. Designed for the IODAI corpus (≈180 series,
 * 2009→2026, single-handed dinghy class): name is the cross-season spine,
 * corroborated by sail-number continuity, shared club, or — where age is
 * recorded — a compatible implied birth year. The bias is to **under-merge**:
 * a name match with no corroboration becomes a *review suggestion*, not an
 * automatic link, and a birth-year conflict is a hard split (namesakes).
 *
 * Pure and DB-free so it can be unit-tested and re-run deterministically. The
 * script `scripts/reconcile-identities.ts` does the I/O around it.
 */

import {
  birthYearsConflict,
  clubsOverlap,
  impliedBirthYear,
  normalizeClubs,
  normalizePersonName,
  personNamesMatch,
} from './competitor-identity-match';
import { sailNumberParts, sailNumbersMatch } from './rating-match';

/** One competitor row, flattened to just what clustering needs. */
export interface ClusterInput {
  competitorId: string;
  name: string;
  sailNumber: string;
  club?: string;
  nationality?: string;
  age: number | null;
  /** Year of the series' first race, from `series.start_date`; null if unknown. */
  raceYear: number | null;
  /** Pre-existing identity link, if the row was reconciled on an earlier pass. */
  existingIdentityId: string | null;
}

/** A proposed recurring identity: a set of competitor rows that link together. */
export interface IdentityCluster {
  competitorIds: string[];
  /** Distinct existing identity ids among the members (excludes null). 0 → all
   *  new (create one); 1 → reuse it; ≥2 → a conflict, never auto-merged. */
  existingIdentityIds: string[];
  /** Representative display fields, taken from the most-recent member. */
  label: string;
  sailNumber: string;
  club: string | null;
  nationality: string | null;
  firstYear: number | null;
  lastYear: number | null;
}

/** A weak (name-only) link between two clusters, surfaced for human review. */
export interface SuggestionEdge {
  /** Indices into `clusters[]`. */
  a: number;
  b: number;
  reason: string;
}

export interface ClusterStats {
  competitors: number;
  withoutSurname: number;
  clusters: number;
  singletons: number;
  multiRowClusters: number;
  largestCluster: number;
  /** Cluster count keyed by member count ("1", "2", … "10+"). */
  sizeHistogram: Record<string, number>;
  suggestions: number;
  /** Clusters spanning ≥2 already-confirmed identities (manual review only). */
  conflicts: number;
  /** Clusters whose year span exceeds a plausible single junior career — a
   *  likely over-merge of namesakes the matcher couldn't split (no recorded
   *  age in the older data). Surfaced for manual splitting. */
  longArcs: number;
}

/**
 * Year span beyond which a single Optimist identity is implausible: a sailor
 * ages out of the class in well under a decade, so a longer arc is almost
 * always two namesakes the matcher fused on a stable name + club + reused
 * sail number. A review heuristic, not a hard rule.
 */
export const LONG_ARC_YEARS = 8;

/** Whether a cluster's year span flags it as a probable over-merge. */
export function isLongArc(cluster: IdentityCluster): boolean {
  if (cluster.firstYear == null || cluster.lastYear == null) return false;
  return cluster.lastYear - cluster.firstYear > LONG_ARC_YEARS;
}

export interface ClusterResult {
  clusters: IdentityCluster[];
  suggestions: SuggestionEdge[];
  stats: ClusterStats;
}

class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    let r = x;
    while (this.parent[r] !== r) r = this.parent[r];
    // Path compression.
    while (this.parent[x] !== r) {
      const next = this.parent[x];
      this.parent[x] = r;
      x = next;
    }
    return r;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

export function clusterCompetitors(inputs: ClusterInput[]): ClusterResult {
  const n = inputs.length;
  const norm = inputs.map((c) => normalizePersonName(c.name));
  const parts = inputs.map((c) => sailNumberParts(c.sailNumber));
  const birth = inputs.map((c) => impliedBirthYear(c.age, c.raceYear));
  const clubs = inputs.map((c) => normalizeClubs(c.club));

  const uf = new UnionFind(n);

  // Seed from any prior reconciliation so a re-run is idempotent: rows already
  // sharing an identity stay together regardless of the signals.
  const firstByExisting = new Map<string, number>();
  inputs.forEach((c, i) => {
    if (!c.existingIdentityId) return;
    const seen = firstByExisting.get(c.existingIdentityId);
    if (seen != null) uf.union(seen, i);
    else firstByExisting.set(c.existingIdentityId, i);
  });

  // Block by surname; only same-surname rows can be the same person.
  const blocks = new Map<string, number[]>();
  let withoutSurname = 0;
  inputs.forEach((_, i) => {
    const s = norm[i].surname;
    if (!s) {
      withoutSurname++;
      return;
    }
    const bucket = blocks.get(s);
    if (bucket) bucket.push(i);
    else blocks.set(s, [i]);
  });

  const weakPairs: Array<{ i: number; j: number }> = [];
  for (const idxs of blocks.values()) {
    for (let a = 0; a < idxs.length; a++) {
      for (let b = a + 1; b < idxs.length; b++) {
        const i = idxs[a];
        const j = idxs[b];
        if (!personNamesMatch(norm[i], norm[j])) continue;
        // A known age gap is a hard split — two real namesakes.
        if (birthYearsConflict(birth[i], birth[j])) continue;
        const sailOk = sailNumbersMatch(parts[i], parts[j]);
        const birthOk = birth[i] != null && birth[j] != null; // both known, not conflicting
        const clubOk =
          clubs[i].length > 0 &&
          clubs[j].length > 0 &&
          clubsOverlap(inputs[i].club, inputs[j].club);
        if (sailOk || birthOk || clubOk) {
          uf.union(i, j);
        } else {
          // Names agree but nothing corroborates — could be one sailor who
          // changed boat and club, or two namesakes. Leave it for review.
          weakPairs.push({ i, j });
        }
      }
    }
  }

  // Materialise components in a stable order (first appearance of each root).
  const rootToCluster = new Map<number, number>();
  const members: number[][] = [];
  for (let i = 0; i < n; i++) {
    const r = uf.find(i);
    let ci = rootToCluster.get(r);
    if (ci == null) {
      ci = members.length;
      rootToCluster.set(r, ci);
      members.push([]);
    }
    members[ci].push(i);
  }

  const clusters: IdentityCluster[] = members.map((idxs) => {
    // Representative = most-recent member by race year (then last seen).
    let rep = idxs[0];
    for (const i of idxs) {
      const ry = inputs[i].raceYear ?? -Infinity;
      const repRy = inputs[rep].raceYear ?? -Infinity;
      if (ry >= repRy) rep = i;
    }
    const years = idxs
      .map((i) => inputs[i].raceYear)
      .filter((y): y is number => y != null);
    const existing = [
      ...new Set(
        idxs
          .map((i) => inputs[i].existingIdentityId)
          .filter((x): x is string => x != null),
      ),
    ];
    return {
      competitorIds: idxs.map((i) => inputs[i].competitorId),
      existingIdentityIds: existing,
      label: inputs[rep].name.trim(),
      sailNumber: inputs[rep].sailNumber,
      club: inputs[rep].club ?? null,
      nationality: inputs[rep].nationality ?? null,
      firstYear: years.length ? Math.min(...years) : null,
      lastYear: years.length ? Math.max(...years) : null,
    };
  });

  // Lift weak competitor-level pairs to cluster-level suggestions, deduped.
  const clusterOf = (i: number): number => rootToCluster.get(uf.find(i))!;
  const seenSuggestion = new Set<string>();
  const suggestions: SuggestionEdge[] = [];
  for (const { i, j } of weakPairs) {
    const ca = clusterOf(i);
    const cb = clusterOf(j);
    if (ca === cb) continue; // already merged by another signal
    const key = ca < cb ? `${ca}:${cb}` : `${cb}:${ca}`;
    if (seenSuggestion.has(key)) continue;
    seenSuggestion.add(key);
    suggestions.push({
      a: Math.min(ca, cb),
      b: Math.max(ca, cb),
      reason: 'name matches; no sail-number, club, or age corroboration',
    });
  }

  const sizeHistogram: Record<string, number> = {};
  let singletons = 0;
  let largestCluster = 0;
  for (const c of clusters) {
    const size = c.competitorIds.length;
    if (size === 1) singletons++;
    largestCluster = Math.max(largestCluster, size);
    const bucket = size >= 10 ? '10+' : String(size);
    sizeHistogram[bucket] = (sizeHistogram[bucket] ?? 0) + 1;
  }
  const conflicts = clusters.filter((c) => c.existingIdentityIds.length >= 2).length;
  const longArcs = clusters.filter(isLongArc).length;

  return {
    clusters,
    suggestions,
    stats: {
      competitors: n,
      withoutSurname,
      clusters: clusters.length,
      singletons,
      multiRowClusters: clusters.length - singletons,
      largestCluster,
      sizeHistogram,
      suggestions: suggestions.length,
      conflicts,
      longArcs,
    },
  };
}
