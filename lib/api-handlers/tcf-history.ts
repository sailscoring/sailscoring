import 'server-only';

import { NotFoundError } from '@/app/api/v1/_lib/handler';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { seriesFileReposFor } from '@/lib/postgres-repository';
import { calculateFleetStandings } from '@/lib/scoring';
import { loadSeriesSnapshot } from '@/lib/series-snapshot';
import type { TcfRecord } from '@/lib/types';

/**
 * Compute the progressive-handicap TCF history for a series on demand.
 *
 * The history is purely derived state — fully reproducible from finishes,
 * race-starts, competitor starting TCFs, and fleet config. We compute it
 * live rather than persisting because no production hot path reads it
 * (the Update Handicaps dialog opens it once per use; the .sailscoring
 * export consumes it once per save). Static-TCF and scratch fleets emit
 * an empty `tcfHistory` from the engine, so a series with no progressive
 * fleets returns `[]` cheaply.
 */
export async function listTcfHistory(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<TcfRecord[]> {
  const repos = seriesFileReposFor({ workspaceId: workspace.workspaceId });
  const snapshot = await loadSeriesSnapshot(repos, seriesId);
  if (!snapshot) throw new NotFoundError('series');
  const { series, competitors, fleets, races, finishes, raceStarts, ratingOverrides } = snapshot;
  if (races.length === 0 || competitors.length === 0) return [];

  const { fleetStandings } = calculateFleetStandings(
    fleets,
    competitors,
    races,
    finishes,
    series.discardThresholds ?? [],
    series.dnfScoring ?? 'seriesEntries',
    raceStarts,
    ratingOverrides,
  );
  return fleetStandings.flatMap((fr) => fr.tcfHistory ?? []);
}
