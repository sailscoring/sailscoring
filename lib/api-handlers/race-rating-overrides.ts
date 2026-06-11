import 'server-only';
import { eq } from 'drizzle-orm';

import { NotFoundError } from '@/app/api/v1/_lib/handler';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { createRepos } from '@/lib/postgres-repository';
import { trackChange } from '@/lib/revision-log';
import { assertRaceWritable } from '@/lib/api-handlers/series-access';
import { raceRatingOverridesBulkInputSchema } from '@/lib/validation/race-rating-override';
import type { RaceRatingOverride } from '@/lib/types';

/** Record a rating-override change (#166) against the race's series. */
async function trackRatingChange(
  workspace: WorkspaceContext,
  repos: ReturnType<typeof createRepos>,
  raceId: string,
  cleared = false,
): Promise<void> {
  const race = await repos.races.get(raceId);
  if (!race) return;
  await trackChange(workspace, {
    action: cleared ? 'ratings.cleared' : 'ratings.updated',
    seriesId: race.seriesId,
    summary: `${cleared ? 'Cleared' : 'Updated'} rating overrides for Race ${race.raceNumber}`,
    sessionKey: `ratings:${raceId}`,
    dedupeKey: `ratings:${raceId}`,
  });
}

export async function listRaceRatingOverrides(
  workspace: WorkspaceContext,
  raceId: string,
): Promise<RaceRatingOverride[]> {
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const race = await repos.races.get(raceId);
  if (!race) throw new NotFoundError('race');
  return repos.raceRatingOverrides.listByRaces([raceId]);
}

/** Series-scoped collection: every rating override across the series' races
 *  in one response, so whole-series readers don't fan out per race. */
export async function listSeriesRaceRatingOverrides(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<RaceRatingOverride[]> {
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const series = await repos.series.get(seriesId);
  if (!series) throw new NotFoundError('series');
  return repos.raceRatingOverrides.listBySeries(seriesId);
}

/** Bulk upsert. Body `{ overrides: RaceRatingOverride[] }`, all sharing raceId. */
export async function bulkPutRaceRatingOverrides(
  workspace: WorkspaceContext,
  raceId: string,
  body: unknown,
): Promise<{ count: number }> {
  await assertRaceWritable(workspace, raceId);
  const input = raceRatingOverridesBulkInputSchema.parse(body);
  for (const o of input.overrides) {
    if (o.raceId !== raceId) throw new NotFoundError('bulk override race mismatch');
  }
  const overrides: RaceRatingOverride[] = input.overrides.map((o) => ({
    ...o,
    id: o.id ?? crypto.randomUUID(),
  }));
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  await repos.raceRatingOverrides.saveMany(overrides, { updatedBy: workspace.userId });
  await trackRatingChange(workspace, repos, raceId);
  return { count: overrides.length };
}

/** Collection delete: drop every rating override in the race. */
export async function bulkDeleteRaceRatingOverrides(
  workspace: WorkspaceContext,
  raceId: string,
): Promise<void> {
  await assertRaceWritable(workspace, raceId);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  await repos.raceRatingOverrides.deleteByRaces([raceId]);
  await trackRatingChange(workspace, repos, raceId, true);
}

/** Flat delete: DELETE /api/v1/race-rating-overrides/:id. Tenancy is enforced
 *  by the repository, which joins to the parent race's workspace_id; a
 *  cross-workspace id is a no-op. */
export async function deleteRaceRatingOverrideFlat(
  workspace: WorkspaceContext,
  id: string,
): Promise<void> {
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const [row] = await getDb()
    .select({ raceId: schema.raceRatingOverrides.raceId })
    .from(schema.raceRatingOverrides)
    .where(eq(schema.raceRatingOverrides.id, id))
    .limit(1);
  await repos.raceRatingOverrides.delete(id);
  if (row) await trackRatingChange(workspace, repos, row.raceId);
}
