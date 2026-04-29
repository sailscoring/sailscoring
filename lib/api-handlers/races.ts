import 'server-only';

import { NotFoundError } from '@/app/api/v1/_lib/handler';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { createRepos } from '@/lib/postgres-repository';
import { raceInputSchema } from '@/lib/validation/race';
import type { Race } from '@/lib/types';

async function assertSeriesInWorkspace(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<void> {
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const series = await repos.series.get(seriesId);
  if (!series) throw new NotFoundError('series');
}

export async function listRaces(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<Race[]> {
  await assertSeriesInWorkspace(workspace, seriesId);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  return repos.races.listBySeries(seriesId);
}

export async function getRace(
  workspace: WorkspaceContext,
  seriesId: string,
  raceId: string,
): Promise<Race> {
  await assertSeriesInWorkspace(workspace, seriesId);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const race = await repos.races.get(raceId);
  if (!race || race.seriesId !== seriesId) throw new NotFoundError('race');
  return race;
}

export async function putRace(
  workspace: WorkspaceContext,
  seriesId: string,
  pathRaceId: string,
  body: unknown,
): Promise<Race> {
  await assertSeriesInWorkspace(workspace, seriesId);
  const input = raceInputSchema.parse(body);
  const id = input.id ?? pathRaceId;
  if (id !== pathRaceId) throw new NotFoundError('race id mismatch');
  if (input.seriesId !== seriesId) throw new NotFoundError('race series mismatch');
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  return repos.races.save({ ...input, id });
}

export async function deleteRace(
  workspace: WorkspaceContext,
  seriesId: string,
  raceId: string,
): Promise<void> {
  await assertSeriesInWorkspace(workspace, seriesId);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const existing = await repos.races.get(raceId);
  if (!existing || existing.seriesId !== seriesId) return;
  await repos.races.delete(raceId);
}
