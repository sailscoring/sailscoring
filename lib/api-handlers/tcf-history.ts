import 'server-only';

import { NotFoundError } from '@/app/api/v1/_lib/handler';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { createRepos } from '@/lib/postgres-repository';
import { calculateFleetStandings } from '@/lib/scoring';
import type { TcfRecord } from '@/lib/types';

/**
 * Read the persisted progressive-handicap TCF history for a series, or
 * compute it on the fly if none has been persisted.
 *
 * Background: the `tcf_records` Postgres table was designed as a persistent
 * cache of the engine's per-(race, competitor, fleet) snapshots, written
 * on every recompute. The Dexie persistence wired that up; the
 * Postgres-side recompute hook was never added (and the Dexie one was
 * dropped in the ADR-008 cutover). Today the table is only written by the
 * series-copy path. So for the Update Handicaps dialog (#144) to read a
 * useful history, this handler runs the scoring engine on demand.
 *
 * Cheap at realistic scales (≤30 boats × ≤20 races × N fleets); a
 * once-per-dialog-open recompute is fine. Persisting on the write path
 * is a separate, larger piece of work — see the schema comment on
 * `lib/db/schema/series.ts`.
 */
export async function listTcfHistory(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<TcfRecord[]> {
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const series = await repos.series.get(seriesId);
  if (!series) throw new NotFoundError('series');

  const persisted = await repos.tcfHistory.listBySeries(seriesId);
  if (persisted.length > 0) return persisted;

  // Fall back to live computation. Only progressive-handicap fleets emit
  // history; the engine's `tcfHistory` field is empty for static-TCF and
  // scratch fleets, so this is safe to call on any series.
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
