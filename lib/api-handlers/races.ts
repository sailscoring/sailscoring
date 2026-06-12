import 'server-only';

import { NotFoundError } from '@/app/api/v1/_lib/handler';
import { trackChange } from '@/lib/revision-log';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { createRepos } from '@/lib/postgres-repository';
import {
  assertRaceDeletable,
  assertSeriesWritable,
} from '@/lib/api-handlers/series-access';
import { raceInputSchema } from '@/lib/validation/race';
import type { Race } from '@/lib/types';

async function assertSeriesInWorkspace(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<void> {
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const series = await repos.series.get(seriesId);
  if (!series) throw new NotFoundError('series');
}

export async function listRaces(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<Race[]> {
  await assertSeriesInWorkspace(workspace, seriesId);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  return repos.races.listBySeries(seriesId);
}

export async function getRace(
  workspace: WorkspaceContext,
  seriesId: string,
  raceId: string,
): Promise<Race> {
  await assertSeriesInWorkspace(workspace, seriesId);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const race = await repos.races.get(raceId);
  if (!race || race.seriesId !== seriesId) throw new NotFoundError('race');
  return race;
}

export async function putRace(
  workspace: WorkspaceContext,
  seriesId: string,
  pathRaceId: string,
  body: unknown,
  opts?: { expectedVersion?: number },
): Promise<Race> {
  await assertSeriesWritable(workspace, seriesId);
  const input = raceInputSchema.parse(body);
  const id = input.id ?? pathRaceId;
  if (id !== pathRaceId) throw new NotFoundError('race id mismatch');
  if (input.seriesId !== seriesId) throw new NotFoundError('race series mismatch');
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const existing = await repos.races.get(id);

  // Sub-series membership. A payload that names a block must name one of
  // this series'; a payload that omits it keeps the row's current block, and
  // a brand-new race defaults into the last block so the full-partition
  // invariant survives race creation without the client thinking about it.
  let subSeriesId = input.subSeriesId;
  if (subSeriesId != null) {
    const block = await repos.subSeries.get(subSeriesId);
    if (!block || block.seriesId !== seriesId) {
      throw new NotFoundError('sub-series');
    }
  } else if (subSeriesId === undefined) {
    if (existing) {
      subSeriesId = existing.subSeriesId ?? null;
    } else {
      const blocks = await repos.subSeries.listBySeries(seriesId);
      subSeriesId = blocks.length > 0 ? blocks[blocks.length - 1].id : null;
    }
  }

  const saved = await repos.races.save(
    { ...input, id, subSeriesId },
    { expectedVersion: opts?.expectedVersion, updatedBy: workspace.userId },
  );
  await trackChange(workspace, {
    action: existing ? 'race.updated' : 'race.added',
    seriesId,
    summary: `${existing ? 'Updated' : 'Added'} Race ${saved.raceNumber}`,
    sessionKey: 'races',
    // Edits to one race coalesce in the feed; an add is its own entry.
    dedupeKey: existing ? `race:${id}` : undefined,
  });
  return saved;
}

export async function deleteRace(
  workspace: WorkspaceContext,
  seriesId: string,
  raceId: string,
): Promise<void> {
  await assertSeriesWritable(workspace, seriesId);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const existing = await repos.races.get(raceId);
  if (!existing || existing.seriesId !== seriesId) return;
  await repos.races.delete(raceId);
  await trackChange(workspace, {
    action: 'race.deleted',
    seriesId,
    summary: `Deleted Race ${existing.raceNumber}`,
    sessionKey: 'races',
  });
}

/**
 * Collection delete: DELETE /api/v1/series/:id/races — drop every race
 * in the series in one round-trip. FK cascade on race_id clears the
 * race-starts, finishes, and nhc-tcf-records underneath. The repo method
 * is workspace-scoped, so `assertSeriesInWorkspace` is the tenancy check.
 */
export async function bulkDeleteRaces(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<void> {
  await assertSeriesWritable(workspace, seriesId);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  await repos.races.deleteBySeries(seriesId);
  await trackChange(workspace, {
    action: 'races.cleared',
    seriesId,
    summary: 'Cleared all races',
    sessionKey: 'races',
  });
}

/**
 * Flat lookup: GET /api/v1/races/:raceId. Workspace tenancy is enforced
 * by the repository layer (races.workspace_id is denormalised onto the
 * row), so an id from another workspace returns 404. Useful for callers
 * that hold only a child id — e.g. lib/api-repository.ts's
 * RaceRepository.get(id), and any future public-API consumer.
 */
export async function getRaceFlat(
  workspace: WorkspaceContext,
  raceId: string,
): Promise<Race | undefined> {
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  return repos.races.get(raceId);
}

/** Flat delete: DELETE /api/v1/races/:raceId. Cross-workspace ids are no-ops. */
export async function deleteRaceFlat(
  workspace: WorkspaceContext,
  raceId: string,
): Promise<void> {
  await assertRaceDeletable(workspace, raceId);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const existing = await repos.races.get(raceId);
  if (!existing) return;
  await repos.races.delete(raceId);
  await trackChange(workspace, {
    action: 'race.deleted',
    seriesId: existing.seriesId,
    summary: `Deleted Race ${existing.raceNumber}`,
    sessionKey: 'races',
  });
}
