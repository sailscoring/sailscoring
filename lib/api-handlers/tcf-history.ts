import 'server-only';

import { NotFoundError } from '@/app/api/v1/_lib/handler';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { createRepos } from '@/lib/postgres-repository';
import type { TcfRecord } from '@/lib/types';

export async function listTcfHistory(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<TcfRecord[]> {
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const series = await repos.series.get(seriesId);
  if (!series) throw new NotFoundError('series');
  return repos.tcfHistory.listBySeries(seriesId);
}
