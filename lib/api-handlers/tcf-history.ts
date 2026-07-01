import 'server-only';

import { NotFoundError } from '@/app/api/v1/_lib/handler';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { seriesFileReposFor } from '@/lib/postgres-repository';
import { calculateFleetStandings, calculateSubSeriesFleetStandings, buildRaceFleetExclusionMap } from '@/lib/scoring';
import { loadSeriesSnapshot } from '@/lib/series-snapshot';
import type { TcfRecord } from '@/lib/types';

/**
 * Compute the progressive-handicap TCF history for a series on demand.
 *
 * The history is purely derived state — fully reproducible from finishes,
 * race-starts, competitor starting TCFs, and fleet config. We compute it
 * live rather than persisting because no production hot path reads it
 * (the Update Handicaps dialog opens it once per use; the follow-on rollover
 * consumes it once per use). Static-TCF and scratch fleets emit an empty
 * `tcfHistory` from the engine, so a series with no progressive fleets
 * returns `[]` cheaply.
 *
 * When the series has sub-series, each fleet's chain is computed per
 * sub-series rather than once over the whole series — so a per-stream fleet
 * (Tuesday vs Saturday) earns its own ratings, and the end-of-series TCF a
 * follow-on seeds from is the end of that stream's last block, not a merged
 * chain. With per-stream fleets each progressive race belongs to exactly one
 * stream's sub-series, so the flattened records carry no duplicate
 * (race, competitor, fleet) keys.
 */
export async function listTcfHistory(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<TcfRecord[]> {
  const repos = seriesFileReposFor({ workspaceId: workspace.workspaceId });
  const snapshot = await loadSeriesSnapshot(repos, seriesId);
  if (!snapshot) throw new NotFoundError('series');
  const { series, competitors, fleets, races, subSeries, finishes, raceStarts, ratingOverrides } =
    snapshot;
  if (races.length === 0 || competitors.length === 0) return [];

  const discardThresholds = series.discardThresholds ?? [];
  const dnfScoring = series.dnfScoring ?? 'seriesEntries';

  if (subSeries.length > 0) {
    const blocks = calculateSubSeriesFleetStandings(
      subSeries,
      fleets,
      competitors,
      races,
      finishes,
      discardThresholds,
      dnfScoring,
      raceStarts,
      ratingOverrides,
    );
    return blocks.flatMap((b) => b.fleetStandings.flatMap((fr) => fr.tcfHistory ?? []));
  }

  const { fleetStandings } = calculateFleetStandings(
    fleets,
    competitors,
    races,
    finishes,
    discardThresholds,
    dnfScoring,
    raceStarts,
    ratingOverrides,
    undefined,
    buildRaceFleetExclusionMap(series.raceFleetExclusions),
  );
  return fleetStandings.flatMap((fr) => fr.tcfHistory ?? []);
}
