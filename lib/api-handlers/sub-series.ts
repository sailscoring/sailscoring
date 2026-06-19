import 'server-only';

import { NotFoundError } from '@/app/api/v1/_lib/handler';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { createRepos } from '@/lib/postgres-repository';
import { trackChange } from '@/lib/revision-log';
import { assertSeriesWritable } from '@/lib/api-handlers/series-access';
import {
  subSeriesCreateInputSchema,
  subSeriesInputSchema,
} from '@/lib/validation/sub-series';
import type { SubSeries } from '@/lib/types';

/**
 * Sub-series (#203): named selections of races inside one series, each scored
 * independently over its own races (HalSail "tandem series"). Membership is
 * many-to-many — a race may belong to several sub-series — and lives on the
 * sub-series' `raceIds`, not on the race. displayOrder is kept contiguous.
 */

async function assertSeriesInWorkspace(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<void> {
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const series = await repos.series.get(seriesId);
  if (!series) throw new NotFoundError('series');
}

export async function listSubSeries(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<SubSeries[]> {
  await assertSeriesInWorkspace(workspace, seriesId);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  return repos.subSeries.listBySeries(seriesId);
}

/** Compact displayOrder to 0..n-1 (sub-series are listed in displayOrder). */
async function renumberSubSeries(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<void> {
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const blocks = await repos.subSeries.listBySeries(seriesId);
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].displayOrder !== i) {
      await repos.subSeries.save(
        { ...blocks[i], displayOrder: i },
        { updatedBy: workspace.userId },
      );
    }
  }
}

/**
 * Create a sub-series — a named selection of races. `raceIds` is the initial
 * selection (filtered to this series' races; may be empty and edited later via
 * PUT). The new sub-series sorts after any existing ones.
 */
export async function createSubSeries(
  workspace: WorkspaceContext,
  seriesId: string,
  body: unknown,
): Promise<SubSeries> {
  await assertSeriesWritable(workspace, seriesId);
  const input = subSeriesCreateInputSchema.parse(body);
  const repos = createRepos({ workspaceId: workspace.workspaceId });

  const [blocks, races] = await Promise.all([
    repos.subSeries.listBySeries(seriesId),
    repos.races.listBySeries(seriesId),
  ]);
  const seriesRaceIds = new Set(races.map((r) => r.id));

  const saved = await repos.subSeries.save(
    {
      id: crypto.randomUUID(),
      seriesId,
      name: input.name,
      displayOrder: blocks.length,
      raceIds: (input.raceIds ?? []).filter((id) => seriesRaceIds.has(id)),
      startingHandicapSource: input.startingHandicapSource,
      continueFromSubSeriesId: input.continueFromSubSeriesId ?? null,
    },
    { updatedBy: workspace.userId },
  );

  await trackChange(workspace, {
    action: 'sub-series.created',
    seriesId,
    summary: `Added sub-series ${saved.name}`,
    sessionKey: 'sub-series',
  });
  return saved;
}

/**
 * Plain upsert (PUT). The interactive rename/edit gestures and the file-import
 * replay land here; `raceIds` is filtered to this series' races.
 */
export async function putSubSeries(
  workspace: WorkspaceContext,
  seriesId: string,
  pathSubSeriesId: string,
  body: unknown,
  opts?: { expectedVersion?: number },
): Promise<SubSeries> {
  await assertSeriesWritable(workspace, seriesId);
  const input = subSeriesInputSchema.parse(body);
  const id = input.id ?? pathSubSeriesId;
  if (id !== pathSubSeriesId) throw new NotFoundError('sub-series id mismatch');
  if (input.seriesId !== seriesId) throw new NotFoundError('sub-series series mismatch');
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const [existing, races] = await Promise.all([
    repos.subSeries.get(id),
    repos.races.listBySeries(seriesId),
  ]);
  const seriesRaceIds = new Set(races.map((r) => r.id));
  const saved = await repos.subSeries.save(
    { ...input, id, raceIds: input.raceIds.filter((rid) => seriesRaceIds.has(rid)) },
    { expectedVersion: opts?.expectedVersion, updatedBy: workspace.userId },
  );
  await trackChange(workspace, {
    action: existing ? 'sub-series.renamed' : 'sub-series.created',
    seriesId,
    summary: existing
      ? `Renamed sub-series ${existing.name} to ${saved.name}`
      : `Added sub-series ${saved.name}`,
    sessionKey: 'sub-series',
    dedupeKey: existing ? `sub-series:${id}` : undefined,
  });
  return saved;
}

/**
 * Raw collection delete: drop every sub-series (membership rows cascade). The
 * file-import replace path.
 */
export async function bulkDeleteSubSeries(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<void> {
  await assertSeriesWritable(workspace, seriesId);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  await repos.subSeries.deleteBySeries(seriesId);
  await trackChange(workspace, {
    action: 'sub-series.cleared',
    seriesId,
    summary: 'Cleared all sub-series',
    sessionKey: 'sub-series',
  });
}

/**
 * Remove a sub-series. Its membership rows cascade away; the races themselves
 * are untouched (they may belong to other sub-series, or to none).
 */
export async function deleteSubSeries(
  workspace: WorkspaceContext,
  seriesId: string,
  subSeriesId: string,
): Promise<void> {
  await assertSeriesWritable(workspace, seriesId);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const existing = await repos.subSeries.get(subSeriesId);
  if (!existing || existing.seriesId !== seriesId) return;

  await repos.subSeries.delete(subSeriesId);
  await renumberSubSeries(workspace, seriesId);

  await trackChange(workspace, {
    action: 'sub-series.deleted',
    seriesId,
    summary: `Removed sub-series ${existing.name}`,
    sessionKey: 'sub-series',
  });
}
