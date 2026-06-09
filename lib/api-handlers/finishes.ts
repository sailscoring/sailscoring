import 'server-only';

import { NotFoundError } from '@/app/api/v1/_lib/handler';
import { recordActivity } from '@/lib/activity-log';
import { captureRevisionAfter } from '@/lib/revision-log';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { createRepos } from '@/lib/postgres-repository';
import {
  assertFinishWritable,
  assertRaceWritable,
} from '@/lib/api-handlers/series-access';
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
  await assertRaceWritable(workspace, raceId);
  const input = finishInputSchema.parse(body);
  const id = input.id ?? pathFinishId;
  if (id !== pathFinishId) throw new NotFoundError('finish id mismatch');
  if (input.raceId !== raceId) throw new NotFoundError('finish race mismatch');
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const saved = await repos.finishes.save(
    { ...input, id },
    { expectedVersion: opts?.expectedVersion, updatedBy: workspace.userId },
  );
  // Per-row autosave: coalesce all of a race's finish writes by this actor into
  // one "recorded finishes for Race N" entry rather than one row per boat.
  const race = await repos.races.get(raceId);
  if (race) {
    await recordActivity(workspace, {
      action: 'finishes.recorded',
      seriesId: race.seriesId,
      summary: `Recorded finishes for Race ${race.raceNumber}`,
      dedupeKey: `finishes:${raceId}`,
    });
    captureRevisionAfter(workspace, race.seriesId, {
      summary: `Recorded finishes for Race ${race.raceNumber}`,
      sessionKey: `finishes:${raceId}`,
    });
  }
  return saved;
}

export async function deleteFinish(
  workspace: WorkspaceContext,
  raceId: string,
  finishId: string,
): Promise<void> {
  await assertRaceWritable(workspace, raceId);
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
  await assertFinishWritable(workspace, id);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  await repos.finishes.delete(id);
}

/**
 * Collection delete: DELETE /api/v1/races/:raceId/finishes — drop every
 * finish in the race in one round-trip. The repo method gates on the
 * parent race's workspace, so `assertRaceInWorkspace` is the tenancy
 * check and cross-workspace race ids are a no-op.
 */
export async function bulkDeleteFinishes(
  workspace: WorkspaceContext,
  raceId: string,
): Promise<void> {
  await assertRaceWritable(workspace, raceId);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const race = await repos.races.get(raceId);
  await repos.finishes.deleteByRace(raceId);
  const clearedSummary = race
    ? `Cleared all finishes for Race ${race.raceNumber}`
    : 'Cleared all finishes';
  await recordActivity(workspace, {
    action: 'finishes.cleared',
    seriesId: race?.seriesId ?? null,
    summary: clearedSummary,
  });
  if (race) captureRevisionAfter(workspace, race.seriesId, { summary: clearedSummary, sessionKey: `finishes:${raceId}` });
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
  await assertRaceWritable(workspace, raceId);
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
  const race = await repos.races.get(raceId);
  const n = finishes.length;
  const enteredSummary = race
    ? `Entered ${n} finishes for Race ${race.raceNumber}`
    : `Entered ${n} finishes`;
  await recordActivity(workspace, {
    action: 'finishes.entered',
    seriesId: race?.seriesId ?? null,
    summary: enteredSummary,
  });
  if (race) captureRevisionAfter(workspace, race.seriesId, { summary: enteredSummary, sessionKey: `finishes:${raceId}` });
  return { count: finishes.length };
}
