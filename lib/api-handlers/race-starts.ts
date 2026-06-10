import 'server-only';
import { eq } from 'drizzle-orm';

import { NotFoundError } from '@/app/api/v1/_lib/handler';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { createRepos } from '@/lib/postgres-repository';
import { trackChange } from '@/lib/revision-log';
import {
  assertRaceStartWritable,
  assertRaceWritable,
} from '@/lib/api-handlers/series-access';
import {
  raceStartInputSchema,
  raceStartsBulkInputSchema,
} from '@/lib/validation/race-start';
import type { RaceStart } from '@/lib/types';

async function assertRaceInWorkspace(
  workspace: WorkspaceContext,
  raceId: string,
): Promise<void> {
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const race = await repos.races.get(raceId);
  if (!race) throw new NotFoundError('race');
}

/** Record a start-config change (#166) against the race's series. */
async function trackStartChange(
  workspace: WorkspaceContext,
  repos: ReturnType<typeof createRepos>,
  raceId: string,
  cleared = false,
): Promise<void> {
  const race = await repos.races.get(raceId);
  if (!race) return;
  await trackChange(workspace, {
    action: cleared ? 'starts.cleared' : 'starts.updated',
    seriesId: race.seriesId,
    summary: `${cleared ? 'Cleared' : 'Updated'} start times for Race ${race.raceNumber}`,
    sessionKey: `starts:${raceId}`,
    dedupeKey: `starts:${raceId}`,
  });
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
  opts?: { expectedVersion?: number },
): Promise<RaceStart> {
  await assertRaceWritable(workspace, raceId);
  const input = raceStartInputSchema.parse(body);
  const id = input.id ?? pathStartId;
  if (id !== pathStartId) throw new NotFoundError('race start id mismatch');
  if (input.raceId !== raceId) throw new NotFoundError('race start race mismatch');
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const saved = await repos.raceStarts.save(
    { ...input, id },
    { expectedVersion: opts?.expectedVersion, updatedBy: workspace.userId },
  );
  await trackStartChange(workspace, repos, raceId);
  return saved;
}

export async function deleteRaceStart(
  workspace: WorkspaceContext,
  raceId: string,
  startId: string,
): Promise<void> {
  await assertRaceWritable(workspace, raceId);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  await repos.raceStarts.delete(startId);
  await trackStartChange(workspace, repos, raceId);
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
  await assertRaceStartWritable(workspace, id);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const [row] = await getDb()
    .select({ raceId: schema.raceStarts.raceId })
    .from(schema.raceStarts)
    .where(eq(schema.raceStarts.id, id))
    .limit(1);
  await repos.raceStarts.delete(id);
  if (row) await trackStartChange(workspace, repos, row.raceId);
}

/**
 * Collection delete: DELETE /api/v1/races/:raceId/starts — drop every
 * start in the race in one round-trip. The repo method gates on the
 * parent race's workspace, so `assertRaceInWorkspace` is the tenancy
 * check and cross-workspace race ids are a no-op.
 */
export async function bulkDeleteRaceStarts(
  workspace: WorkspaceContext,
  raceId: string,
): Promise<void> {
  await assertRaceWritable(workspace, raceId);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  await repos.raceStarts.deleteByRace(raceId);
  await trackStartChange(workspace, repos, raceId, true);
}

/**
 * Bulk upsert. The body is `{ starts: RaceStart[] }`. All starts must
 * share the path's raceId; mixed-race batches are rejected.
 */
export async function bulkPutRaceStarts(
  workspace: WorkspaceContext,
  raceId: string,
  body: unknown,
): Promise<{ count: number }> {
  await assertRaceWritable(workspace, raceId);
  const input = raceStartsBulkInputSchema.parse(body);
  for (const s of input.starts) {
    if (s.raceId !== raceId) {
      throw new NotFoundError('bulk race start race mismatch');
    }
  }
  const starts: RaceStart[] = input.starts.map((s) => ({
    ...s,
    id: s.id ?? crypto.randomUUID(),
  }));
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  await repos.raceStarts.saveMany(starts, { updatedBy: workspace.userId });
  await trackStartChange(workspace, repos, raceId);
  return { count: starts.length };
}
