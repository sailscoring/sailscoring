import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';

import { loadAsPublishedPlacements } from './archive-kit/places';

import { getDb } from './db/client';
import {
  competitorIdentities,
  competitors,
  rankings,
  series,
} from './db/schema/series';
import { seriesFileReposFor } from './postgres-repository';
import { listPublishedSeriesIds } from './published-repository';
import {
  computeRanking,
  type RankingConfig,
  type RankingEntrant,
  type RankingResult,
} from './ranking';
import {
  buildRaceFleetExclusionMap,
  calculateFleetStandings,
} from './scoring';
import { loadSeriesSnapshot } from './series-snapshot';

/**
 * Ranking standings assembly (#209): load and score each series in a
 * ranking's config through the same engine the standings and published pages
 * use (the career-arc pattern — no re-implementation, so a place here is
 * exactly the published place), collapse places onto competitor identities,
 * and hand the pure engine its entrants.
 */

export interface RankingStandingsData {
  result: RankingResult;
  /** Placed competitor rows in the ranking's series that have no identity
   *  link yet — each is a sailor the ladder can't see. Surfaced in-app so
   *  the scorer knows to reconcile, never silently absorbed. */
  unmatchedCount: number;
  /** Config series that exist in the workspace, in bucket order — what the
   *  ladder was actually computed over. `published` lets the in-app view say
   *  which contributors the public page won't show yet. */
  includedSeries: Array<{ id: string; name: string; published: boolean }>;
}

/** A ranking with a live public page, by its vanity slug. Null when the slug
 *  is unknown or the ranking is private — the public route 404s either way. */
export async function getPublishedRankingBySlug(
  workspaceId: string,
  slug: string,
): Promise<{
  id: string;
  name: string;
  slug: string;
  config: RankingConfig;
  publishedAt: Date;
} | null> {
  const [row] = await getDb()
    .select()
    .from(rankings)
    .where(
      and(eq(rankings.workspaceId, workspaceId), eq(rankings.slug, slug)),
    )
    .limit(1);
  if (!row || !row.publishedAt || !row.slug) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    config: row.config,
    publishedAt: row.publishedAt,
  };
}

/** The workspace's public rankings, for the `/p/{ws}` listing's links. */
export async function listPublishedRankings(
  workspaceId: string,
): Promise<Array<{ name: string; slug: string }>> {
  const rows = await getDb()
    .select({
      name: rankings.name,
      slug: rankings.slug,
      publishedAt: rankings.publishedAt,
    })
    .from(rankings)
    .where(eq(rankings.workspaceId, workspaceId))
    .orderBy(rankings.displayOrder, rankings.createdAt);
  return rows
    .filter((r) => r.publishedAt !== null && r.slug !== null)
    .map((r) => ({ name: r.name, slug: r.slug as string }));
}

/** Restrict a config to an allow-list of series ids (the public path computes
 *  over published series only). Bucket floors then apply to what remains. */
export function filterRankingConfigSeries(
  config: RankingConfig,
  allowed: ReadonlySet<string>,
): RankingConfig {
  return {
    ...config,
    buckets: config.buckets.map((b) => ({
      ...b,
      seriesIds: b.seriesIds.filter((id) => allowed.has(id)),
    })),
  };
}

/**
 * Compute a ranking's ladder for a workspace. Series in the config that no
 * longer exist in the workspace are skipped (a deleted series just stops
 * contributing). A competitor ranked in more than one fleet of a series
 * counts their best place — one combined pool, a place is a place.
 */
export async function computeRankingStandings(
  workspaceId: string,
  config: RankingConfig,
): Promise<RankingStandingsData> {
  const wantedIds = [
    ...new Set(config.buckets.flatMap((b) => b.seriesIds)),
  ];
  const db = getDb();
  // Workspace scoping: only this workspace's series count, whatever ids the
  // stored config carries.
  const scoped =
    wantedIds.length === 0
      ? []
      : (
          await db
            .select({
              id: series.id,
              name: series.name,
              workspaceId: series.workspaceId,
            })
            .from(series)
            .where(inArray(series.id, wantedIds))
        ).filter((r) => r.workspaceId === workspaceId);
  const presentIds = new Set(scoped.map((r) => r.id));
  const publishedIds = await listPublishedSeriesIds(workspaceId);
  const orderedIncluded = wantedIds
    .filter((id) => presentIds.has(id))
    .map((id) => ({
      id,
      name: scoped.find((r) => r.id === id)!.name,
      published: publishedIds.has(id),
    }));

  // Score each series once and collect (competitorId → best place). An
  // as-published series (ADR-010) contributes its *stored* ranks instead of
  // being scored — a place there is exactly the originally-published place.
  const storedPlacements = await loadAsPublishedPlacements(
    db,
    orderedIncluded.map((s) => s.id),
  );
  const repos = seriesFileReposFor({ workspaceId });
  const placeByCompetitor = new Map<string, { seriesId: string; place: number }>();
  for (const { id: seriesId } of orderedIncluded) {
    const stored = storedPlacements.get(seriesId);
    if (stored) {
      for (const [competitorId, placement] of stored) {
        const prev = placeByCompetitor.get(competitorId);
        if (!prev || placement.rank < prev.place) {
          placeByCompetitor.set(competitorId, { seriesId, place: placement.rank });
        }
      }
      continue;
    }
    const snap = await loadSeriesSnapshot(repos, seriesId);
    if (!snap || snap.races.length === 0) continue;
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
    for (const fs of fleetStandings) {
      for (const standing of fs.standings) {
        const key = standing.competitor.id;
        const prev = placeByCompetitor.get(key);
        if (!prev || standing.rank < prev.place) {
          placeByCompetitor.set(key, { seriesId, place: standing.rank });
        }
      }
    }
  }

  if (placeByCompetitor.size === 0) {
    return {
      result: computeRanking(config, []),
      unmatchedCount: 0,
      includedSeries: orderedIncluded,
    };
  }

  // Resolve the placed rows to identities.
  const placedIds = [...placeByCompetitor.keys()];
  const rows = await db
    .select({
      id: competitors.id,
      identityId: competitors.identityId,
      nationality: competitors.nationality,
      seriesId: competitors.seriesId,
    })
    .from(competitors)
    .where(inArray(competitors.id, placedIds));

  const seriesOrder = new Map(orderedIncluded.map((s, i) => [s.id, i]));
  interface Accum {
    places: Map<string, number>;
    /** (series order, nationality) of the latest row that carried one. */
    nationality: { order: number; value: string } | null;
  }
  const byIdentity = new Map<string, Accum>();
  let unmatchedCount = 0;
  for (const row of rows) {
    const placed = placeByCompetitor.get(row.id);
    if (!placed) continue;
    if (!row.identityId) {
      unmatchedCount++;
      continue;
    }
    let acc = byIdentity.get(row.identityId);
    if (!acc) {
      acc = { places: new Map(), nationality: null };
      byIdentity.set(row.identityId, acc);
    }
    const prev = acc.places.get(placed.seriesId);
    if (prev === undefined || placed.place < prev) {
      acc.places.set(placed.seriesId, placed.place);
    }
    const order = seriesOrder.get(row.seriesId) ?? -1;
    if (
      row.nationality &&
      (!acc.nationality || order >= acc.nationality.order)
    ) {
      acc.nationality = { order, value: row.nationality };
    }
  }

  const identityRows =
    byIdentity.size === 0
      ? []
      : await db
          .select({
            id: competitorIdentities.id,
            label: competitorIdentities.label,
            slug: competitorIdentities.slug,
            club: competitorIdentities.club,
            nationality: competitorIdentities.nationality,
          })
          .from(competitorIdentities)
          .where(
            inArray(competitorIdentities.id, [...byIdentity.keys()]),
          );
  const entrants: RankingEntrant[] = identityRows.map((identity) => {
    const acc = byIdentity.get(identity.id)!;
    return {
      identityId: identity.id,
      label: identity.label,
      slug: identity.slug,
      club: identity.club,
      nationality: acc.nationality?.value ?? identity.nationality,
      places: acc.places,
    };
  });

  return {
    result: computeRanking(config, entrants),
    unmatchedCount,
    includedSeries: orderedIncluded,
  };
}
