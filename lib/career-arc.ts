import 'server-only';

import { loadAsPublishedPlacements } from './archive-kit/places';
import {
  placementInStandings,
  type ArcPlacement,
} from './career-arc-placement';
import { getDb } from './db/client';
import { asPublishedRankings } from './db/schema/series';
import { eq } from 'drizzle-orm';
import {
  getIdentityArc,
  type ArcEntry,
  type IdentityWithArc,
} from './competitor-identity-repository';
import { seriesFileReposFor } from './postgres-repository';
import { getPublishedSlugsBySeries } from './published-repository';
import { calculateFleetStandings, buildRaceFleetExclusionMap, type FleetStandingsResult } from './scoring';
import { loadSeriesSnapshot } from './series-snapshot';

/**
 * Career-arc data assembly (#212): an identity's arc, with each entry enriched
 * by the competitor's finishing position in that series. Loads and scores each
 * distinct series once through the same engine the standings and published
 * pages use (`loadSeriesSnapshot` + `calculateFleetStandings`) — no
 * re-implementation, so the arc shows exactly what the results page would.
 */

/** An arc entry plus where the competitor finished in that series, and the
 *  public slug its results are published at. The public arc only includes
 *  published series, so this is non-null in practice; the type keeps `null` for
 *  the field's general shape. */
export interface CareerArcEntry extends ArcEntry, ArcPlacement {
  publishedSlug: string | null;
}

/** An identity's arc with per-event placements. */
export interface CareerArc extends Omit<IdentityWithArc, 'entries'> {
  entries: CareerArcEntry[];
  /** Season-ranking achievements (#309): the identity's rows in the
   *  workspace's as-published rankings — "Ranked 3rd of 44". Only the
   *  published record feeds the arc; live computed ladders don't. */
  rankingEntries: CareerArcRankingEntry[];
}

export interface CareerArcRankingEntry {
  rankingId: string;
  name: string;
  slug: string;
  season: number;
  fleetLabel: string | null;
  rank: number | null;
  rankLabel: string;
  rankedCount: number;
}

interface ScoredSeries {
  result: FleetStandingsResult;
  hasRaces: boolean;
  multiFleet: boolean;
}

/**
 * One identity's career arc with finishing positions, or null if the identity
 * isn't in the workspace. Each series in the arc is scored once and cached, so
 * the cost is one snapshot-load + score per distinct series, not per entry.
 */
export async function getCareerArc(
  workspaceId: string,
  identityId: string,
): Promise<CareerArc | null> {
  const identity = await getIdentityArc(workspaceId, identityId);
  if (!identity) return null;

  const repos = seriesFileReposFor({ workspaceId });
  const scoredBySeries = new Map<string, ScoredSeries | null>();

  async function scoreSeries(seriesId: string): Promise<ScoredSeries | null> {
    const cached = scoredBySeries.get(seriesId);
    if (cached !== undefined) return cached;
    const snap = await loadSeriesSnapshot(repos, seriesId);
    if (!snap) {
      scoredBySeries.set(seriesId, null);
      return null;
    }
    const { fleetStandings } = calculateFleetStandings(
      snap.fleets,
      snap.competitors,
      snap.races,
      snap.finishes,
      snap.series.discardThresholds ?? [],
      snap.series.dnfScoring ?? 'seriesEntries',
      snap.raceStarts,
      snap.ratingOverrides,
      undefined,
      buildRaceFleetExclusionMap(snap.series.raceFleetExclusions),
    );
    const scored: ScoredSeries = {
      result: { fleetStandings, circularRedressRaces: [] },
      hasRaces: snap.races.length > 0,
      multiFleet: snap.fleets.length > 1,
    };
    scoredBySeries.set(seriesId, scored);
    return scored;
  }

  const publishedSlugs = await getPublishedSlugsBySeries(
    workspaceId,
    identity.entries.map((e) => e.seriesId),
  );

  // Public = published: an unpublished series is the club's explicit "not
  // public", so it must not surface here at all — not even as a placing-only
  // row. Drop the unpublished entries before scoring (so we only load and score
  // the series that will actually appear), and recompute the year span from
  // what survives, since the identity's first/last year span every entry.
  const published = identity.entries.filter((e) => publishedSlugs.has(e.seriesId));

  // As-published series (ADR-010) carry their places in the stored results —
  // read them there instead of re-scoring; a series in this map never loads a
  // snapshot at all.
  const { placements: storedPlacements } = await loadAsPublishedPlacements(
    getDb(),
    [...new Set(published.map((e) => e.seriesId))],
  );

  const entries: CareerArcEntry[] = [];
  for (const entry of published) {
    let placement: ArcPlacement;
    const stored = storedPlacements.get(entry.seriesId);
    if (stored) {
      placement =
        stored.get(entry.competitorId) ??
        { rank: null, fleetSize: null, fleetName: null };
    } else {
      const scored = await scoreSeries(entry.seriesId);
      placement = scored
        ? placementInStandings(scored.result, entry.competitorId, {
            hasRaces: scored.hasRaces,
            multiFleet: scored.multiFleet,
          })
        : { rank: null, fleetSize: null, fleetName: null };
    }
    entries.push({
      ...entry,
      ...placement,
      publishedSlug: publishedSlugs.get(entry.seriesId) ?? null,
    });
  }

  const years = entries.map((e) => e.year).filter((y): y is number => y != null);
  const firstYear = years.length ? Math.min(...years) : null;
  const lastYear = years.length ? Math.max(...years) : null;

  // Season-ranking achievements: every as-published ranking row carrying
  // this identity's slug. Volumes are small (tens of rankings), so filter
  // in memory rather than teaching the DB about jsonb row shapes.
  const rankingEntries: CareerArcRankingEntry[] = [];
  if (identity.slug) {
    const rankingRows = await getDb()
      .select({
        id: asPublishedRankings.id,
        name: asPublishedRankings.name,
        slug: asPublishedRankings.slug,
        season: asPublishedRankings.season,
        fleetLabel: asPublishedRankings.fleetLabel,
        rankedCount: asPublishedRankings.rankedCount,
        table: asPublishedRankings.table,
      })
      .from(asPublishedRankings)
      .where(eq(asPublishedRankings.workspaceId, workspaceId));
    for (const r of rankingRows) {
      const row = r.table.rows.find((x) => x.identity === identity.slug);
      if (!row) continue;
      rankingEntries.push({
        rankingId: r.id,
        name: r.name,
        slug: r.slug,
        season: r.season,
        fleetLabel: r.fleetLabel,
        rank: row.rank,
        rankLabel: row.rankLabel,
        rankedCount: r.rankedCount,
      });
    }
    rankingEntries.sort((a, b) => b.season - a.season || a.name.localeCompare(b.name));
  }

  const rankingYears = rankingEntries.map((r) => r.season);
  const allFirst = [...years, ...rankingYears];
  const arcFirst = allFirst.length ? Math.min(...allFirst) : null;
  const arcLast = allFirst.length ? Math.max(...allFirst) : null;

  return {
    ...identity,
    entries,
    rankingEntries,
    firstYear: arcFirst ?? firstYear,
    lastYear: arcLast ?? lastYear,
  };
}
