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
import { asPublishedResults, fleets, series } from '@/lib/db/schema/series';
import { matchesFleetFilter } from '@/lib/ranking';

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
 * `fleetFilter` restricts that pool to fleets of one name (a ranking with a
 * fleet filter reads only that fleet's stored tables).
 */
export async function loadAsPublishedPlacements(
  db: SailScoringDb,
  seriesIds: readonly string[],
  fleetFilter?: string,
): Promise<Map<string, Map<string, AsPublishedPlacement>>> {
  const out = new Map<string, Map<string, AsPublishedPlacement>>();
  if (seriesIds.length === 0) return out;

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
  ).filter((row) => matchesFleetFilter(row.fleetName, fleetFilter));

  const fleetCounts = new Map<string, number>();
  for (const row of rows) {
    fleetCounts.set(row.seriesId, (fleetCounts.get(row.seriesId) ?? 0) + 1);
  }

  for (const row of rows) {
    const multiFleet = (fleetCounts.get(row.seriesId) ?? 0) > 1;
    const ranked = row.results.rows.filter((r) => r.rank != null);
    let bySeries = out.get(row.seriesId);
    if (!bySeries) {
      bySeries = new Map();
      out.set(row.seriesId, bySeries);
    }
    for (const r of ranked) {
      const placement: AsPublishedPlacement = {
        rank: r.rank as number,
        fleetSize: ranked.length,
        fleetName: multiFleet ? row.fleetName : null,
      };
      const prev = bySeries.get(r.competitorId);
      if (!prev || placement.rank < prev.rank) {
        bySeries.set(r.competitorId, placement);
      }
    }
  }
  return out;
}
