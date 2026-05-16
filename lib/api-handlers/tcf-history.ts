import 'server-only';

import { NotFoundError } from '@/app/api/v1/_lib/handler';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { createRepos } from '@/lib/postgres-repository';
import { calculateFleetStandings } from '@/lib/scoring';
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
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const series = await repos.series.get(seriesId);
  if (!series) throw new NotFoundError('series');

  const [fleets, competitors, races] = await Promise.all([
    repos.fleets.listBySeries(seriesId),
    repos.competitors.listBySeries(seriesId),
    repos.races.listBySeries(seriesId),
  ]);
  if (races.length === 0 || competitors.length === 0) return [];

  const raceIds = races.map((r) => r.id);
  const [allFinishes, allRaceStarts] = await Promise.all([
    repos.finishes.listBySeries(seriesId, competitors.map((c) => c.id)),
    repos.raceStarts.listByRaces(raceIds),
  ]);

  const { fleetStandings } = calculateFleetStandings(
    fleets,
    competitors,
    races,
    allFinishes,
    series.discardThresholds ?? [],
    series.dnfScoring ?? 'seriesEntries',
    allRaceStarts,
  );
  return fleetStandings.flatMap((fr) => fr.tcfHistory ?? []);
}
