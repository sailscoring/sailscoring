import 'server-only';

import {
  placementInStandings,
  type ArcPlacement,
} from './career-arc-placement';
import {
  getIdentityArc,
  type ArcEntry,
  type IdentityWithArc,
} from './competitor-identity-repository';
import { seriesFileReposFor } from './postgres-repository';
import { getPublishedSlugsBySeries } from './published-repository';
import { calculateFleetStandings, type FleetStandingsResult } from './scoring';
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

  const entries: CareerArcEntry[] = [];
  for (const entry of published) {
    const scored = await scoreSeries(entry.seriesId);
    const placement = scored
      ? placementInStandings(scored.result, entry.competitorId, {
          hasRaces: scored.hasRaces,
          multiFleet: scored.multiFleet,
        })
      : { rank: null, fleetSize: null, fleetName: null };
    entries.push({
      ...entry,
      ...placement,
      publishedSlug: publishedSlugs.get(entry.seriesId) ?? null,
    });
  }

  const years = entries.map((e) => e.year).filter((y): y is number => y != null);
  const firstYear = years.length ? Math.min(...years) : null;
  const lastYear = years.length ? Math.max(...years) : null;

  return { ...identity, entries, firstYear, lastYear };
}
