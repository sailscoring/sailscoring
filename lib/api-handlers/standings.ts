import 'server-only';

import { NotFoundError } from '@/app/api/v1/_lib/handler';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { seriesFileReposFor } from '@/lib/postgres-repository';
import { buildPublicExport, type PublicSeriesExport } from '@/lib/public-export';

/**
 * ADR-009 M4 — computed standings for a series as the public-export JSON. This
 * is the same artifact embedded in published results and the public read path;
 * exposing it read-only gives the CLI (and any client) the scored output
 * without re-implementing the engine. `seriesFileReposFor` structurally
 * satisfies the narrower `ExportRepos` the builder needs.
 *
 * Returns the full series export (series info, fleets, competitors, races, and
 * per-fleet standings). A missing series is a 404.
 */
export async function getSeriesStandings(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<PublicSeriesExport> {
  const repos = seriesFileReposFor({ workspaceId: workspace.workspaceId });
  const exported = await buildPublicExport(seriesId, repos);
  if (!exported) throw new NotFoundError('series');
  return exported;
}
