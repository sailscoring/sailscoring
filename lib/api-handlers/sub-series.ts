import 'server-only';

import { BadRequestError, NotFoundError } from '@/app/api/v1/_lib/handler';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { createRepos } from '@/lib/postgres-repository';
import { trackChange } from '@/lib/revision-log';
import { groupRacesBySubSeries } from '@/lib/scoring';
import { assertSeriesWritable } from '@/lib/api-handlers/series-access';
import {
  subSeriesCreateInputSchema,
  subSeriesRenameInputSchema,
} from '@/lib/validation/sub-series';
import type { SubSeries } from '@/lib/types';

/**
 * Sub-series (#203): named blocks of races inside one series, each scored
 * independently. The handlers here maintain the full-partition invariant —
 * a series has either no sub-series (every race's subSeriesId null) or
 * every race assigned to one — and keep displayOrder matching race order,
 * so clients can trust both without re-deriving them.
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

/**
 * Rewrite displayOrder to match race order (blocks with no races keep their
 * relative order at the end — groupRacesBySubSeries's contract).
 */
async function renumberSubSeries(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<void> {
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const [blocks, races] = await Promise.all([
    repos.subSeries.listBySeries(seriesId),
    repos.races.listBySeries(seriesId),
  ]);
  const ordered = groupRacesBySubSeries(blocks, races);
  for (let i = 0; i < ordered.length; i++) {
    const block = ordered[i].subSeries;
    if (block.displayOrder !== i) {
      await repos.subSeries.save(
        { ...block, displayOrder: i },
        { updatedBy: workspace.userId },
      );
    }
  }
}

/**
 * The "start a new sub-series here" gesture. The new block runs from
 * `firstRaceId` to the end of the block containing it (or of the whole race
 * list when the series has no sub-series yet). The first split of a
 * blockless series partitions every race, so `initialName` must name the
 * block for the races before `firstRaceId` exactly when there are any.
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
    repos.races.listBySeries(seriesId), // ordered by raceNumber
  ]);

  const newBlock: SubSeries = {
    id: crypto.randomUUID(),
    seriesId,
    name: input.name,
    displayOrder: blocks.length,
  };

  let claimedRaceIds: string[] = [];
  let initialBlock: SubSeries | undefined;

  if (input.firstRaceId !== undefined) {
    const firstRace = races.find((r) => r.id === input.firstRaceId);
    if (!firstRace) throw new NotFoundError('race');

    if (blocks.length === 0) {
      const before = races.filter((r) => r.raceNumber < firstRace.raceNumber);
      claimedRaceIds = races
        .filter((r) => r.raceNumber >= firstRace.raceNumber)
        .map((r) => r.id);
      if (before.length > 0) {
        if (!input.initialName) {
          throw new BadRequestError(
            'initialName is required: the races before the split need a sub-series too',
          );
        }
        initialBlock = {
          id: crypto.randomUUID(),
          seriesId,
          name: input.initialName,
          displayOrder: 0,
        };
      }
    } else {
      const containing = blocks.find((b) => b.id === firstRace.subSeriesId);
      if (!containing) {
        throw new BadRequestError('race is not in any sub-series');
      }
      const containingRaces = races.filter((r) => r.subSeriesId === containing.id);
      if (containingRaces[0]?.id === firstRace.id) {
        throw new BadRequestError('race already starts a sub-series');
      }
      claimedRaceIds = containingRaces
        .filter((r) => r.raceNumber >= firstRace.raceNumber)
        .map((r) => r.id);
    }
  } else if (blocks.length === 0) {
    // No split point: the new block takes every race (possibly none yet).
    claimedRaceIds = races.map((r) => r.id);
  }
  // Blocks exist and no firstRaceId: append an empty block — new races
  // default into the last block, so this is "create the next block before
  // its races exist".

  if (initialBlock) {
    await repos.subSeries.save(initialBlock, { updatedBy: workspace.userId });
    await repos.races.setSubSeries(
      seriesId,
      races.filter((r) => !claimedRaceIds.includes(r.id)).map((r) => r.id),
      initialBlock.id,
    );
  }
  const saved = await repos.subSeries.save(newBlock, { updatedBy: workspace.userId });
  await repos.races.setSubSeries(seriesId, claimedRaceIds, saved.id);
  await renumberSubSeries(workspace, seriesId);

  await trackChange(workspace, {
    action: 'sub-series.created',
    seriesId,
    summary: initialBlock
      ? `Split races into sub-series ${initialBlock.name} and ${saved.name}`
      : `Added sub-series ${saved.name}`,
    sessionKey: 'sub-series',
  });
  return saved;
}

export async function renameSubSeries(
  workspace: WorkspaceContext,
  seriesId: string,
  subSeriesId: string,
  body: unknown,
  opts?: { expectedVersion?: number },
): Promise<SubSeries> {
  await assertSeriesWritable(workspace, seriesId);
  const input = subSeriesRenameInputSchema.parse(body);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const existing = await repos.subSeries.get(subSeriesId);
  if (!existing || existing.seriesId !== seriesId) {
    throw new NotFoundError('sub-series');
  }
  const saved = await repos.subSeries.save(
    { ...existing, name: input.name },
    { expectedVersion: opts?.expectedVersion, updatedBy: workspace.userId },
  );
  await trackChange(workspace, {
    action: 'sub-series.renamed',
    seriesId,
    summary: `Renamed sub-series ${existing.name} to ${saved.name}`,
    sessionKey: 'sub-series',
    dedupeKey: `sub-series:${subSeriesId}`,
  });
  return saved;
}

/**
 * Remove a sub-series. Its races merge into the previous block (the next
 * block when it is first); deleting the only block returns the series to
 * blockless — every race's subSeriesId nulled.
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

  const [blocks, races] = await Promise.all([
    repos.subSeries.listBySeries(seriesId),
    repos.races.listBySeries(seriesId),
  ]);
  const ordered = groupRacesBySubSeries(blocks, races);
  const idx = ordered.findIndex((b) => b.subSeries.id === subSeriesId);
  const target = ordered[idx - 1]?.subSeries ?? ordered[idx + 1]?.subSeries;
  const orphanedRaceIds = races
    .filter((r) => r.subSeriesId === subSeriesId)
    .map((r) => r.id);

  if (target) {
    await repos.races.setSubSeries(seriesId, orphanedRaceIds, target.id);
  } else {
    await repos.races.clearSubSeries(seriesId);
  }
  await repos.subSeries.delete(subSeriesId);
  await renumberSubSeries(workspace, seriesId);

  await trackChange(workspace, {
    action: 'sub-series.deleted',
    seriesId,
    summary: target && orphanedRaceIds.length > 0
      ? `Removed sub-series ${existing.name} (races merged into ${target.name})`
      : `Removed sub-series ${existing.name}`,
    sessionKey: 'sub-series',
  });
}
