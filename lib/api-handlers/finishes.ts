import 'server-only';

import { NotFoundError } from '@/app/api/v1/_lib/handler';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { createRepos } from '@/lib/postgres-repository';
import { finishInputSchema, finishesBulkInputSchema } from '@/lib/validation/finish';
import type { Finish } from '@/lib/types';

async function assertRaceInWorkspace(
  workspace: WorkspaceContext,
  raceId: string,
): Promise<void> {
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const race = await repos.races.get(raceId);
  if (!race) throw new NotFoundError('race');
}

export async function listFinishes(
  workspace: WorkspaceContext,
  raceId: string,
): Promise<Finish[]> {
  await assertRaceInWorkspace(workspace, raceId);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  return repos.finishes.listByRace(raceId);
}

export async function putFinish(
  workspace: WorkspaceContext,
  raceId: string,
  pathFinishId: string,
  body: unknown,
  opts?: { expectedVersion?: number },
): Promise<Finish> {
  await assertRaceInWorkspace(workspace, raceId);
  const input = finishInputSchema.parse(body);
  const id = input.id ?? pathFinishId;
  if (id !== pathFinishId) throw new NotFoundError('finish id mismatch');
  if (input.raceId !== raceId) throw new NotFoundError('finish race mismatch');
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  return repos.finishes.save(
    { ...input, id },
    { expectedVersion: opts?.expectedVersion, updatedBy: workspace.userId },
  );
}

export async function deleteFinish(
  workspace: WorkspaceContext,
  raceId: string,
  finishId: string,
): Promise<void> {
  await assertRaceInWorkspace(workspace, raceId);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  await repos.finishes.delete(finishId);
}

/**
 * Flat delete: DELETE /api/v1/finishes/:id. Tenancy via the
 * PostgresFinishRepository, which joins to races and checks the parent
 * race's workspace_id; cross-workspace ids are no-ops.
 */
export async function deleteFinishFlat(
  workspace: WorkspaceContext,
  id: string,
): Promise<void> {
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  await repos.finishes.delete(id);
}

/**
 * Bulk upsert. The body is `{ finishes: Finish[] }`. All finishes must
 * share the path's raceId; mixed-race batches are rejected.
 */
export async function bulkPutFinishes(
  workspace: WorkspaceContext,
  raceId: string,
  body: unknown,
): Promise<{ count: number }> {
  await assertRaceInWorkspace(workspace, raceId);
  const input = finishesBulkInputSchema.parse(body);
  for (const f of input.finishes) {
    if (f.raceId !== raceId) {
      throw new NotFoundError('bulk finish race mismatch');
    }
  }
  const finishes: Finish[] = input.finishes.map((f) => ({
    ...f,
    id: f.id ?? crypto.randomUUID(),
  }));
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  await repos.finishes.saveMany(finishes, { updatedBy: workspace.userId });
  return { count: finishes.length };
}
