/**
 * Workspace cross-series ranking — the pure bucketed best-N engine (#209).
 *
 * A ranking is a set of buckets, each a set of series with a best-N rule
 * (`countBest`) and an eligibility floor (`requiredMin`), summed to a single
 * ascending score. This is the "championship + N best opens" family — IODAI's
 * national ladder (Nationals place + two best regionals) is a saved config,
 * not code. Groups strictly by competitor identity (#212): the engine takes
 * per-identity places and builds no matcher of its own.
 *
 * Places are compared in one combined pool — a place is a place, whichever
 * fleet's standings it came from. Where an association ranks its fleets
 * separately (IODAI rank Junior and Senior apart), the config's fleet filter
 * restricts a ladder to one fleet by name and each fleet gets its own saved
 * ranking. Ties on the summed total share a rank (competition ranking) and
 * order alphabetically for display.
 *
 * Pure: no DB, no `server-only` — the assembly that scores each series and
 * resolves identities lives in `ranking-standings.ts`.
 */

/** One bucket: a set of series scored under a shared best-N rule. */
export interface RankingBucket {
  id: string;
  name: string;
  seriesIds: string[];
  /** How many of the sailor's best (lowest) places in this bucket count. */
  countBest: number;
  /** How many placed series the sailor needs in this bucket to rank at all.
   *  A sailor short of any bucket's floor is excluded from the ladder. */
  requiredMin: number;
}

/** A ranking's configuration — what the editor edits and the DB stores. */
export interface RankingConfig {
  buckets: RankingBucket[];
  /** Optional competitor filter: only sailors of this nationality
   *  (three-letter code, case-insensitive) are ranked. */
  nationality?: string;
  /** With the nationality filter set: count places among matching sailors
   *  only — a sailor's place becomes 1 + the number of matching sailors
   *  ranked better, so visiting boats don't occupy a place (IODAI's
   *  "excluding non-Irish sailors"). Off: places are as published. */
  recomputePlaces?: boolean;
  /** Optional fleet filter: only standings from fleets of this name
   *  (case-insensitive) feed the ladder. Fleet ids are per-series, so the
   *  filter matches by name across every series in the config. */
  fleet?: string;
}

/** Does a nationality pass a config's filter? No filter passes all; a blank
 *  nationality never passes a set filter. */
export function matchesNationalityFilter(
  nationality: string | null | undefined,
  filter: string | undefined,
): boolean {
  const wanted = filter?.trim().toUpperCase();
  if (!wanted) return true;
  return (nationality ?? '').trim().toUpperCase() === wanted;
}

/**
 * Compress standings places to the matching sailors: each matching row's
 * place becomes 1 + the number of matching rows ranked strictly better, so
 * ties survive and non-matching rows stop occupying places. Non-matching
 * rows get no entry.
 */
export function compressPlaces<K>(
  rows: Array<{ key: K; rank: number; matches: boolean }>,
): Map<K, number> {
  const matching = rows.filter((r) => r.matches);
  const out = new Map<K, number>();
  for (const row of matching) {
    out.set(row.key, 1 + matching.filter((o) => o.rank < row.rank).length);
  }
  return out;
}

/** Places can be fractional (a committee-adjusted 1.5): show one decimal
 *  when needed, none when whole. */
export function formatPlace(place: number): string {
  return Number.isInteger(place) ? String(place) : place.toFixed(1);
}

/** Does a fleet name pass a config's fleet filter? No filter passes all. */
export function matchesFleetFilter(
  fleetName: string | null | undefined,
  filter: string | undefined,
): boolean {
  const wanted = filter?.trim().toLowerCase();
  if (!wanted) return true;
  return (fleetName ?? '').trim().toLowerCase() === wanted;
}

/** One recurring competitor's raw material: their place per series. */
export interface RankingEntrant {
  identityId: string;
  label: string;
  /** Public handle for the competitor timeline link, when one exists. */
  slug: string | null;
  club: string | null;
  /** Most recent nationality across the ranking's series, for the filter. */
  nationality: string | null;
  /** Finishing place per series id — only series where the sailor actually
   *  ranked (a series with no races, or an entry with no standing, is simply
   *  absent). */
  places: ReadonlyMap<string, number>;
}

/** A sailor's score within one bucket. */
export interface RankingBucketScore {
  bucketId: string;
  /** Every place the sailor sailed in the bucket's series, best first. The
   *  best `countBest` are flagged counted; the rest are the discards. */
  places: Array<{ seriesId: string; place: number; counted: boolean }>;
}

/** How many of the bucket's series the sailor placed in. */
export function bucketSailed(score: RankingBucketScore): number {
  return score.places.length;
}

/** The places that count towards the total, best first. */
export function bucketCounted(
  score: RankingBucketScore,
): Array<{ seriesId: string; place: number }> {
  return score.places.filter((p) => p.counted);
}

/** One row of the computed ladder. */
export interface RankingRow {
  identityId: string;
  label: string;
  slug: string | null;
  club: string | null;
  rank: number;
  /** Sum of counted places across buckets — lower is better. */
  total: number;
  /** Sum of every sailed place, discards included — the standings-style
   *  gross alongside the net `total`. */
  gross: number;
  buckets: RankingBucketScore[];
}

export interface RankingResult {
  rows: RankingRow[];
  /** Entrants who sailed something in the ranking's series but missed a
   *  bucket's floor — shown as "not yet ranked", not silently dropped. */
  ineligible: Array<{
    identityId: string;
    label: string;
    slug: string | null;
    buckets: RankingBucketScore[];
  }>;
}

function bucketScore(
  bucket: RankingBucket,
  places: ReadonlyMap<string, number>,
): RankingBucketScore {
  const inBucket = bucket.seriesIds
    .map((seriesId) => {
      const place = places.get(seriesId);
      return place === undefined ? null : { seriesId, place };
    })
    .filter((p): p is { seriesId: string; place: number } => p !== null)
    .sort((a, b) => a.place - b.place);
  return {
    bucketId: bucket.id,
    places: inBucket.map((p, i) => ({
      ...p,
      counted: i < Math.max(0, bucket.countBest),
    })),
  };
}

/**
 * Compute the ladder. Entrants with no place in any of the config's series
 * don't appear at all; entrants who sailed but miss a bucket floor land in
 * `ineligible`. Rows sort by ascending total, ties sharing a rank
 * (competition ranking) and ordering alphabetically within the tie.
 */
export function computeRanking(
  config: RankingConfig,
  entrants: RankingEntrant[],
): RankingResult {
  const rows: Array<Omit<RankingRow, 'rank'>> = [];
  const ineligible: RankingResult['ineligible'] = [];

  for (const entrant of entrants) {
    if (!matchesNationalityFilter(entrant.nationality, config.nationality)) {
      continue;
    }
    const buckets = config.buckets.map((b) => bucketScore(b, entrant.places));
    const sailedAny = buckets.some((b) => b.places.length > 0);
    if (!sailedAny) continue;

    const eligible = config.buckets.every(
      (b, i) => buckets[i].places.length >= b.requiredMin,
    );
    if (!eligible) {
      ineligible.push({
        identityId: entrant.identityId,
        label: entrant.label,
        slug: entrant.slug,
        buckets,
      });
      continue;
    }
    const total = buckets.reduce(
      (sum, b) =>
        sum + b.places.reduce((s, p) => s + (p.counted ? p.place : 0), 0),
      0,
    );
    const gross = buckets.reduce(
      (sum, b) => sum + b.places.reduce((s, p) => s + p.place, 0),
      0,
    );
    rows.push({
      identityId: entrant.identityId,
      label: entrant.label,
      slug: entrant.slug,
      club: entrant.club,
      total,
      gross,
      buckets,
    });
  }

  rows.sort(
    (a, b) => a.total - b.total || a.label.localeCompare(b.label),
  );
  ineligible.sort((a, b) => a.label.localeCompare(b.label));

  // Competition ranking: equal totals share a rank, the next rank skips.
  const ranked: RankingRow[] = rows.map((row, i) => ({
    ...row,
    rank:
      i > 0 && rows[i - 1].total === row.total
        ? 0 // placeholder, fixed in the pass below
        : i + 1,
  }));
  for (let i = 1; i < ranked.length; i++) {
    if (ranked[i].rank === 0) ranked[i].rank = ranked[i - 1].rank;
  }

  return { rows: ranked, ineligible };
}

/** A fresh, empty bucket for the editor. */
export function newRankingBucket(id: string): RankingBucket {
  return { id, name: '', seriesIds: [], countBest: 1, requiredMin: 1 };
}
