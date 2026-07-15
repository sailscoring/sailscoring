/**
 * Structured places from as-published stored results (ADR-010, #283).
 *
 * The one computation the regime permits is ordering by the ranks it already
 * carries: the career-arc timeline and rankings (#209) read a competitor's
 * stored series rank here exactly where they re-score a full-fidelity
 * series. Not `server-only` so the CLI-side tooling can share it.
 */

import { eq, inArray } from 'drizzle-orm';

import type { SailScoringDb } from '@/lib/db/client';
import {
  asPublishedResults,
  competitors,
  fleets,
  series,
} from '@/lib/db/schema/series';
import {
  compressPlaces,
  matchesFleetFilter,
  matchesNationalityFilter,
} from '@/lib/ranking';

export interface AsPublishedPlacement {
  /** The stored series rank, 1-based. */
  rank: number;
  /** How many ranked rows that fleet's table carries — the "of N". */
  fleetSize: number;
  /** Fleet name, only when the series stores more than one fleet's table
   *  (mirrors `placementInStandings`'s multi-fleet rule). */
  fleetName: string | null;
}

/**
 * Placements for every as-published series among `seriesIds`:
 * seriesId → (competitorId → placement). A series absent from the result is
 * not as-published (or stores nothing yet) — the caller's cue to score it
 * through the engine instead. A competitor ranked in more than one fleet's
 * table keeps its best (lowest) rank — one combined pool, a place is a place.
 *
 * `fleetFilter` restricts that pool to fleets of one name (a ranking with a
 * fleet filter reads only that fleet's stored tables). `compressNationality`
 * counts places among sailors of that nationality only — non-matching rows
 * stop occupying places and get no placement; `unflaggedCount` reports the
 * ranked competitors skipped for having no nationality at all, a data-quality
 * signal the caller should surface.
 */
export async function loadAsPublishedPlacements(
  db: SailScoringDb,
  seriesIds: readonly string[],
  opts: { fleetFilter?: string; compressNationality?: string } = {},
): Promise<{
  placements: Map<string, Map<string, AsPublishedPlacement>>;
  unflaggedCount: number;
}> {
  const placements = new Map<string, Map<string, AsPublishedPlacement>>();
  if (seriesIds.length === 0) return { placements, unflaggedCount: 0 };

  const rows = (
    await db
      .select({
        seriesId: asPublishedResults.seriesId,
        fleetName: fleets.name,
        results: asPublishedResults.results,
      })
      .from(asPublishedResults)
      .innerJoin(fleets, eq(asPublishedResults.fleetId, fleets.id))
      .innerJoin(series, eq(asPublishedResults.seriesId, series.id))
      .where(inArray(asPublishedResults.seriesId, [...seriesIds]))
  ).filter((row) => matchesFleetFilter(row.fleetName, opts.fleetFilter));

  const nationalityById = new Map<string, string | null>();
  if (opts.compressNationality) {
    const rankedIds = [
      ...new Set(
        rows.flatMap((row) =>
          row.results.rows
            .filter((r) => r.rank != null)
            .map((r) => r.competitorId),
        ),
      ),
    ];
    if (rankedIds.length > 0) {
      const natRows = await db
        .select({
          id: competitors.id,
          nationality: competitors.nationality,
        })
        .from(competitors)
        .where(inArray(competitors.id, rankedIds));
      for (const r of natRows) nationalityById.set(r.id, r.nationality);
    }
  }

  const fleetCounts = new Map<string, number>();
  for (const row of rows) {
    fleetCounts.set(row.seriesId, (fleetCounts.get(row.seriesId) ?? 0) + 1);
  }

  const unflagged = new Set<string>();
  for (const row of rows) {
    const multiFleet = (fleetCounts.get(row.seriesId) ?? 0) > 1;
    const ranked = row.results.rows.filter((r) => r.rank != null);
    let bySeries = placements.get(row.seriesId);
    if (!bySeries) {
      bySeries = new Map();
      placements.set(row.seriesId, bySeries);
    }
    let placeOf: (r: {
      competitorId: string;
      rank: number | null;
    }) => number | undefined = (r) => r.rank as number;
    let fleetSize = ranked.length;
    if (opts.compressNationality) {
      for (const r of ranked) {
        const nat = nationalityById.get(r.competitorId);
        if (!nat?.trim()) unflagged.add(r.competitorId);
      }
      const compressed = compressPlaces(
        ranked.map((r) => ({
          key: r.competitorId,
          rank: r.rank as number,
          matches: matchesNationalityFilter(
            nationalityById.get(r.competitorId),
            opts.compressNationality,
          ),
        })),
      );
      placeOf = (r) => compressed.get(r.competitorId);
      fleetSize = compressed.size;
    }
    for (const r of ranked) {
      const place = placeOf(r);
      if (place === undefined) continue;
      const placement: AsPublishedPlacement = {
        rank: place,
        fleetSize,
        fleetName: multiFleet ? row.fleetName : null,
      };
      const prev = bySeries.get(r.competitorId);
      if (!prev || placement.rank < prev.rank) {
        bySeries.set(r.competitorId, placement);
      }
    }
  }
  return { placements, unflaggedCount: unflagged.size };
}
