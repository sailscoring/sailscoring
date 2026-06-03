import 'server-only';

import { NotFoundError } from '@/app/api/v1/_lib/handler';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { createRepos } from '@/lib/postgres-repository';
import { assertRaceWritable } from '@/lib/api-handlers/series-access';
import { raceRatingOverridesBulkInputSchema } from '@/lib/validation/race-rating-override';
import type { RaceRatingOverride } from '@/lib/types';

export async function listRaceRatingOverrides(
  workspace: WorkspaceContext,
  raceId: string,
): Promise<RaceRatingOverride[]> {
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const race = await repos.races.get(raceId);
  if (!race) throw new NotFoundError('race');
  return repos.raceRatingOverrides.listByRaces([raceId]);
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
}

/** Flat delete: DELETE /api/v1/race-rating-overrides/:id. Tenancy is enforced
 *  by the repository, which joins to the parent race's workspace_id; a
 *  cross-workspace id is a no-op. */
export async function deleteRaceRatingOverrideFlat(
  workspace: WorkspaceContext,
  id: string,
): Promise<void> {
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  await repos.raceRatingOverrides.delete(id);
}
