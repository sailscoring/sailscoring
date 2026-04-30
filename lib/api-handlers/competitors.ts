import 'server-only';

import { NotFoundError } from '@/app/api/v1/_lib/handler';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { createRepos } from '@/lib/postgres-repository';
import { competitorInputSchema } from '@/lib/validation/competitor';
import type { Competitor } from '@/lib/types';

async function assertSeriesInWorkspace(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<void> {
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const series = await repos.series.get(seriesId);
  if (!series) throw new NotFoundError('series');
}

export async function listCompetitors(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<Competitor[]> {
  await assertSeriesInWorkspace(workspace, seriesId);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  return repos.competitors.listBySeries(seriesId);
}

export async function getCompetitor(
  workspace: WorkspaceContext,
  seriesId: string,
  competitorId: string,
): Promise<Competitor> {
  await assertSeriesInWorkspace(workspace, seriesId);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const competitor = await repos.competitors.get(competitorId);
  if (!competitor || competitor.seriesId !== seriesId) {
    throw new NotFoundError('competitor');
  }
  return competitor;
}

export async function putCompetitor(
  workspace: WorkspaceContext,
  seriesId: string,
  pathCompetitorId: string,
  body: unknown,
): Promise<Competitor> {
  await assertSeriesInWorkspace(workspace, seriesId);
  const input = competitorInputSchema.parse(body);
  const id = input.id ?? pathCompetitorId;
  if (id !== pathCompetitorId) throw new NotFoundError('competitor id mismatch');
  if (input.seriesId !== seriesId) throw new NotFoundError('competitor series mismatch');
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  return repos.competitors.save({ ...input, id });
}

export async function deleteCompetitor(
  workspace: WorkspaceContext,
  seriesId: string,
  competitorId: string,
): Promise<void> {
  await assertSeriesInWorkspace(workspace, seriesId);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const existing = await repos.competitors.get(competitorId);
  if (!existing || existing.seriesId !== seriesId) return;
  await repos.competitors.delete(competitorId);
}

/**
 * Flat lookup: GET /api/v1/competitors/:id. Tenancy is enforced by the
 * repository layer (competitors.workspace_id is denormalised onto the
 * row); cross-workspace ids return 404. Symmetrical with `getRaceFlat`.
 */
export async function getCompetitorFlat(
  workspace: WorkspaceContext,
  id: string,
): Promise<Competitor | undefined> {
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  return repos.competitors.get(id);
}
