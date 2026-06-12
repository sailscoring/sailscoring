import 'server-only';

import { NotFoundError } from '@/app/api/v1/_lib/handler';
import { recordActivity } from '@/lib/activity-log';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import {
  listTombstones,
  purgeTombstone,
  restoreTombstone,
} from '@/lib/deleted-series';
import type { DeletedSeriesEntry } from '@/lib/types';

/**
 * Workspace Trash: the recover / permanent-delete surface over soft-deleted
 * series ("Recover a deleted series"). A trashed series can't be opened — it
 * must be recovered first — so there is no "get one tombstone" read here, only
 * the list plus the two terminal actions.
 */

/** The workspace Trash list (newest-first). */
export async function listTrash(
  workspace: WorkspaceContext,
): Promise<{ items: DeletedSeriesEntry[] }> {
  const items = await listTombstones(workspace.workspaceId);
  return { items };
}

/** Recover a trashed series: re-create it (archived) under its original id and
 *  drop the tombstone. 404 if the tombstone isn't in the workspace. */
export async function restoreFromTrash(
  workspace: WorkspaceContext,
  tombstoneId: string,
): Promise<{ seriesId: string }> {
  const restored = await restoreTombstone(
    { workspaceId: workspace.workspaceId, userId: workspace.userId },
    tombstoneId,
  );
  if (!restored) throw new NotFoundError('deleted-series');

  await recordActivity(workspace, {
    action: 'series.restored',
    seriesId: restored.seriesId,
    summary: `Recovered series “${restored.name}”`,
  });
  return { seriesId: restored.seriesId };
}

/** Permanently delete a trashed series (the "delete forever" path, gated behind
 *  a type-the-name confirmation in the UI). 404 if it isn't in the workspace. */
export async function purgeFromTrash(
  workspace: WorkspaceContext,
  tombstoneId: string,
): Promise<void> {
  const purged = await purgeTombstone(workspace.workspaceId, tombstoneId);
  if (!purged) throw new NotFoundError('deleted-series');

  // Workspace-level entry — the series and its tombstone are both gone now.
  await recordActivity(workspace, {
    action: 'series.purged',
    seriesId: null,
    summary: `Permanently deleted series “${purged.name}”`,
  });
}
