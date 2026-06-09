import 'server-only';

import { NotFoundError } from '@/app/api/v1/_lib/handler';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { createRepos } from '@/lib/postgres-repository';
import { listRevisions, type RevisionEntry } from '@/lib/revision-log';

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
