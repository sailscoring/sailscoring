import 'server-only';

import { BadRequestError, NotFoundError } from '@/app/api/v1/_lib/handler';
import { recordActivity } from '@/lib/activity-log';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { relinkIdentitiesBestEffort } from '@/lib/competitor-identity-reconcile';
import { assertSeriesWritable } from '@/lib/api-handlers/series-access';
import { createRepos, seriesFileReposFor } from '@/lib/postgres-repository';
import {
  captureRevision,
  exportRevisions,
  getRevision,
  importRevisions,
  listRevisions,
  sealOpenRevisions,
  type RevisionEntry,
} from '@/lib/revision-log';
import { updateSeriesFromFile, type SeriesFileRevision } from '@/lib/series-file';
import {
  checkpointInputSchema,
  seriesRevisionsImportSchema,
} from '@/lib/validation/revision';

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
  if (!revision.snapshot) {
    // The snapshot was thinned (#166) — the row survives for the timeline, but
    // there's nothing to restore to.
    throw new BadRequestError('this version is no longer restorable');
  }

  // Replay the snapshot over the existing series row (preserves its id,
  // createdAt, category, archived flag — see updateSeriesFromFile).
  await updateSeriesFromFile(
    seriesId,
    revision.snapshot,
    seriesFileReposFor({ workspaceId: workspace.workspaceId }),
  );

  // Seal the pre-revert session so subsequent edits don't fold back into it,
  // then pin the restore as its own revision.
  await sealOpenRevisions(workspace.workspaceId, seriesId);
  const summary = `Restored the version from ${new Date(revision.createdAt).toLocaleString('en-IE')}`;
  await recordActivity(workspace, { action: 'series.reverted', seriesId, summary });
  await captureRevision(actor, seriesId, { kind: 'revert', summary });

  // Lazy identity population (#222): the replay rewrote the competitor rows,
  // so their workspace-local identity links are re-derived here.
  await relinkIdentitiesBestEffort(workspace.workspaceId);

  return { ok: true };
}

/**
 * Create a user-named checkpoint (#166): a pinned `named` revision snapshotting
 * the series' current state. Unlike auto revisions, it never coalesces, so it
 * stays a deliberate marker the scorer can always return to.
 */
export async function createNamedCheckpoint(
  workspace: WorkspaceContext,
  seriesId: string,
  body: unknown,
): Promise<{ ok: true }> {
  await assertSeriesWritable(workspace, seriesId);
  const { label } = checkpointInputSchema.parse(body);
  await captureRevision(
    { workspaceId: workspace.workspaceId, userId: workspace.userId },
    seriesId,
    { kind: 'named', label, summary: label },
  );
  return { ok: true };
}

/**
 * Record a "Saved to file" milestone (#166): seal the open session and pin a
 * `saved` revision capturing the state that was exported — so a saved
 * `.sailscoring` corresponds to a marked point in the history.
 */
export async function recordSaveMilestone(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<{ ok: true }> {
  await assertSeriesWritable(workspace, seriesId);
  await sealOpenRevisions(workspace.workspaceId, seriesId);
  await captureRevision(
    { workspaceId: workspace.workspaceId, userId: workspace.userId },
    seriesId,
    { kind: 'saved', label: 'Saved to file' },
  );
  return { ok: true };
}

/** The series' revision history for embedding in an exported file (#166):
 *  readable metadata + one opaque whole-array zstd snapshot blob. */
export async function exportSeriesRevisions(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<{ revisions: SeriesFileRevision[]; revisionSnapshots: string }> {
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const series = await repos.series.get(seriesId);
  if (!series) throw new NotFoundError('series');

  return exportRevisions(
    { workspaceId: workspace.workspaceId, userId: workspace.userId },
    seriesId,
  );
}

/** Restore an embedded revision history into a freshly imported series (#166).
 *  Called by the open-as-new flow after the series and its entities are written. */
export async function importSeriesRevisions(
  workspace: WorkspaceContext,
  seriesId: string,
  body: unknown,
): Promise<{ count: number }> {
  await assertSeriesWritable(workspace, seriesId);
  const payload = seriesRevisionsImportSchema.parse(body);
  await importRevisions(
    { workspaceId: workspace.workspaceId, userId: workspace.userId },
    seriesId,
    payload as unknown as { revisions: SeriesFileRevision[]; revisionSnapshots: string },
  );
  return { count: payload.revisions.length };
}
