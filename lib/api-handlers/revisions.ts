import 'server-only';

import { NotFoundError } from '@/app/api/v1/_lib/handler';
import { recordActivity } from '@/lib/activity-log';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { assertSeriesWritable } from '@/lib/api-handlers/series-access';
import { createRepos, seriesFileReposFor } from '@/lib/postgres-repository';
import {
  captureRevision,
  getRevision,
  importRevisions,
  listRevisions,
  listRevisionsForExport,
  type RevisionEntry,
} from '@/lib/revision-log';
import { updateSeriesFromFile, type SeriesFileRevision } from '@/lib/series-file';
import { seriesRevisionsImportSchema } from '@/lib/validation/revision';

/**
 * Revision history read endpoint (#166). The write side lives in the mutation
 * handlers via `captureRevision`; this only reads. Available on archived
 * series too — revisions are read-only history.
 */
export async function getSeriesRevisions(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<{ items: RevisionEntry[] }> {
  // Tenancy + existence: a missing or out-of-workspace series is a 404.
  // `listRevisions` is itself workspace-scoped, so this is defence-in-depth.
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const series = await repos.series.get(seriesId);
  if (!series) throw new NotFoundError('series');

  const items = await listRevisions(
    { workspaceId: workspace.workspaceId, userId: workspace.userId },
    seriesId,
  );
  return { items };
}

/**
 * Restore a series to an earlier revision. Replays the revision's snapshot over
 * the series (the same authoritative file-replay path a `.sailscoring` import
 * uses), then records the restore as a new `revert` revision plus an activity
 * entry — so reverting is itself part of the history, never a silent rewind.
 */
export async function revertToRevision(
  workspace: WorkspaceContext,
  seriesId: string,
  revisionId: string,
): Promise<{ ok: true }> {
  // Tenancy + writability (rejects archived series and missing/foreign ids).
  await assertSeriesWritable(workspace, seriesId);

  const actor = { workspaceId: workspace.workspaceId, userId: workspace.userId };
  const revision = await getRevision(actor, revisionId);
  if (!revision || revision.seriesId !== seriesId) {
    throw new NotFoundError('revision');
  }

  // Replay the snapshot over the existing series row (preserves its id,
  // createdAt, category, archived flag — see updateSeriesFromFile).
  await updateSeriesFromFile(
    seriesId,
    revision.snapshot,
    seriesFileReposFor({ workspaceId: workspace.workspaceId }),
  );

  const summary = `Restored the version from ${new Date(revision.createdAt).toLocaleString('en-IE')}`;
  await recordActivity(workspace, { action: 'series.reverted', seriesId, summary });
  await captureRevision(actor, seriesId, { kind: 'revert', summary });

  return { ok: true };
}

/** The series' full revision history in `.sailscoring` shape, for embedding in
 *  an exported file (#166). */
export async function exportSeriesRevisions(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<{ revisions: SeriesFileRevision[] }> {
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const series = await repos.series.get(seriesId);
  if (!series) throw new NotFoundError('series');

  const revisions = await listRevisionsForExport(
    { workspaceId: workspace.workspaceId, userId: workspace.userId },
    seriesId,
  );
  return { revisions };
}

/** Restore an embedded revision history into a freshly imported series (#166).
 *  Called by the open-as-new flow after the series and its entities are written. */
export async function importSeriesRevisions(
  workspace: WorkspaceContext,
  seriesId: string,
  body: unknown,
): Promise<{ count: number }> {
  await assertSeriesWritable(workspace, seriesId);
  const { revisions } = seriesRevisionsImportSchema.parse(body);
  await importRevisions(
    { workspaceId: workspace.workspaceId, userId: workspace.userId },
    seriesId,
    revisions as unknown as SeriesFileRevision[],
  );
  return { count: revisions.length };
}
