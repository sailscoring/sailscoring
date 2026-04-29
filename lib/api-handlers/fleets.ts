import 'server-only';

import { NotFoundError } from '@/app/api/v1/_lib/handler';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { createRepos } from '@/lib/postgres-repository';
import { fleetInputSchema } from '@/lib/validation/fleet';
import type { Fleet } from '@/lib/types';

async function assertSeriesInWorkspace(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<void> {
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const series = await repos.series.get(seriesId);
  if (!series) throw new NotFoundError('series');
}

export async function listFleets(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<Fleet[]> {
  await assertSeriesInWorkspace(workspace, seriesId);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  return repos.fleets.listBySeries(seriesId);
}

export async function getFleet(
  workspace: WorkspaceContext,
  seriesId: string,
  fleetId: string,
): Promise<Fleet> {
  await assertSeriesInWorkspace(workspace, seriesId);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const fleet = await repos.fleets.get(fleetId);
  if (!fleet || fleet.seriesId !== seriesId) {
    throw new NotFoundError('fleet');
  }
  return fleet;
}

export async function putFleet(
  workspace: WorkspaceContext,
  seriesId: string,
  pathFleetId: string,
  body: unknown,
): Promise<Fleet> {
  await assertSeriesInWorkspace(workspace, seriesId);
  const input = fleetInputSchema.parse(body);
  const id = input.id ?? pathFleetId;
  if (id !== pathFleetId) throw new NotFoundError('fleet id mismatch with path');
  if (input.seriesId !== seriesId) throw new NotFoundError('fleet series mismatch');
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  return repos.fleets.save({ ...input, id });
}

export async function deleteFleet(
  workspace: WorkspaceContext,
  seriesId: string,
  fleetId: string,
): Promise<void> {
  await assertSeriesInWorkspace(workspace, seriesId);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const existing = await repos.fleets.get(fleetId);
  if (!existing || existing.seriesId !== seriesId) return;
  await repos.fleets.delete(fleetId);
}
