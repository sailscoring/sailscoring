import 'server-only';

import { NotFoundError } from '@/app/api/v1/_lib/handler';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { createRepos } from '@/lib/postgres-repository';
import { seriesInputSchema } from '@/lib/validation/series';
import type { Series } from '@/lib/types';

export async function listSeries(workspace: WorkspaceContext): Promise<{ items: Series[] }> {
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const items = await repos.series.list();
  return { items };
}

export async function getSeries(workspace: WorkspaceContext, id: string): Promise<Series> {
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const series = await repos.series.get(id);
  if (!series) throw new NotFoundError('series');
  return series;
}

export async function putSeries(
  workspace: WorkspaceContext,
  pathId: string,
  body: unknown,
  opts?: { expectedVersion?: number },
): Promise<Series> {
  const input = seriesInputSchema.parse(body);
  const id = input.id ?? pathId;
  if (id !== pathId) {
    throw new NotFoundError('series id mismatch with path');
  }
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const now = Date.now();
  // Defaults for the file-tracking fields when missing on input. Clients
  // are expected to round-trip these, but new-series creation can be
  // sparse and the server fills the rest.
  const merged: Series = {
    id,
    name: input.name,
    venue: input.venue,
    startDate: input.startDate,
    endDate: input.endDate,
    venueLogoUrl: input.venueLogoUrl,
    eventLogoUrl: input.eventLogoUrl,
    createdAt: input.createdAt ?? now,
    lastSnapshotId: input.lastSnapshotId ?? null,
    lastSavedAt: input.lastSavedAt ?? null,
    lastModifiedAt: input.lastModifiedAt ?? now,
    snapshotHistory: input.snapshotHistory ?? [],
    scoringMode: input.scoringMode,
    defaultStartSequence: input.defaultStartSequence,
    discardThresholds: input.discardThresholds,
    dnfScoring: input.dnfScoring,
    ftpHost: input.ftpHost,
    ftpPath: input.ftpPath,
    bilgeBundle: input.bilgeBundle ?? null,
    includeJsonExport: input.includeJsonExport,
    publishRatingCalculations: input.publishRatingCalculations,
    enabledCompetitorFields: input.enabledCompetitorFields,
    primaryPersonLabel: input.primaryPersonLabel,
  };
  return repos.series.save(merged, {
    expectedVersion: opts?.expectedVersion,
    updatedBy: workspace.userId,
  });
}

export async function deleteSeries(workspace: WorkspaceContext, id: string): Promise<void> {
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  await repos.series.delete(id);
}

export async function touchSeries(workspace: WorkspaceContext, id: string): Promise<void> {
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  await repos.series.touch(id);
}
