import 'server-only';

import { NotFoundError } from '@/app/api/v1/_lib/handler';
import { trackChange } from '@/lib/revision-log';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { createRepos } from '@/lib/postgres-repository';
import {
  assertRaceDeletable,
  assertSeriesWritable,
} from '@/lib/api-handlers/series-access';
import {
  raceInputSchema,
  racesGenerateSchema,
  racesReorderSchema,
} from '@/lib/validation/race';
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

  // Sub-series membership lives on the sub-series (its `raceIds`), not the
  // race — a race may belong to several sub-series — so race save no longer
  // touches it.
  const saved = await repos.races.save(
    { ...input, id },
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

/**
 * Bulk-create appended races (the "Add multiple races" generator, #237). The
 * body is `{ races, starts }`; every race must carry the path's seriesId.
 * Numbers are assigned server-side, so the client's `raceNumber` values are
 * hints only. Returns the created races with their assigned numbers, in order.
 */
export async function generateRaces(
  workspace: WorkspaceContext,
  seriesId: string,
  body: unknown,
): Promise<Race[]> {
  await assertSeriesWritable(workspace, seriesId);
  const input = racesGenerateSchema.parse(body);
  for (const r of input.races) {
    if (r.seriesId !== seriesId) {
      throw new NotFoundError('generated race series mismatch');
    }
  }
  const races: Race[] = input.races.map((r) => ({
    ...r,
    id: r.id ?? crypto.randomUUID(),
  }));
  const raceIds = new Set(races.map((r) => r.id));
  for (const s of input.starts) {
    if (!raceIds.has(s.raceId)) {
      throw new NotFoundError('generated start references unknown race');
    }
  }
  const starts = input.starts.map((s) => ({
    ...s,
    id: s.id ?? crypto.randomUUID(),
  }));
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const created = await repos.races.generateMany(seriesId, races, starts, {
    updatedBy: workspace.userId,
  });
  const n = created.length;
  await trackChange(workspace, {
    action: 'races.generated',
    seriesId,
    summary: `Generated ${n} race${n === 1 ? '' : 's'}`,
    sessionKey: 'races',
  });
  return created;
}

/**
 * Renumber a series' races to match the given order (the full set of race ids
 * in their new sequence). Like the series-list reorder, this is a
 * list-organisation gesture: it doesn't bump per-race versions. Returns the
 * freshly-ordered list.
 */
export async function reorderRaces(
  workspace: WorkspaceContext,
  seriesId: string,
  body: unknown,
): Promise<Race[]> {
  await assertSeriesWritable(workspace, seriesId);
  const { orderedIds } = racesReorderSchema.parse(body);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  await repos.races.reorder(seriesId, orderedIds);
  await trackChange(workspace, {
    action: 'races.reordered',
    seriesId,
    summary: 'Reordered races',
    sessionKey: 'races',
  });
  return repos.races.listBySeries(seriesId);
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
