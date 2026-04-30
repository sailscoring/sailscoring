import 'server-only';

import { NotFoundError } from '@/app/api/v1/_lib/handler';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { createRepos } from '@/lib/postgres-repository';
import { raceStartInputSchema } from '@/lib/validation/race-start';
import type { RaceStart } from '@/lib/types';

async function assertRaceInWorkspace(
  workspace: WorkspaceContext,
  raceId: string,
): Promise<void> {
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const race = await repos.races.get(raceId);
  if (!race) throw new NotFoundError('race');
}

export async function listRaceStarts(
  workspace: WorkspaceContext,
  raceId: string,
): Promise<RaceStart[]> {
  await assertRaceInWorkspace(workspace, raceId);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  return repos.raceStarts.listByRace(raceId);
}

export async function putRaceStart(
  workspace: WorkspaceContext,
  raceId: string,
  pathStartId: string,
  body: unknown,
): Promise<RaceStart> {
  await assertRaceInWorkspace(workspace, raceId);
  const input = raceStartInputSchema.parse(body);
  const id = input.id ?? pathStartId;
  if (id !== pathStartId) throw new NotFoundError('race start id mismatch');
  if (input.raceId !== raceId) throw new NotFoundError('race start race mismatch');
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  return repos.raceStarts.save({ ...input, id });
}

export async function deleteRaceStart(
  workspace: WorkspaceContext,
  raceId: string,
  startId: string,
): Promise<void> {
  await assertRaceInWorkspace(workspace, raceId);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  await repos.raceStarts.delete(startId);
}

/**
 * Flat delete: DELETE /api/v1/race-starts/:id. Tenancy via the
 * PostgresRaceStartRepository, which joins to races and checks the
 * parent race's workspace_id; cross-workspace ids are no-ops.
 */
export async function deleteRaceStartFlat(
  workspace: WorkspaceContext,
  id: string,
): Promise<void> {
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  await repos.raceStarts.delete(id);
}
