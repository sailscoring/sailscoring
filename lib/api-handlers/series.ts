import 'server-only';
import { and, eq } from 'drizzle-orm';

import { BadRequestError, NotFoundError } from '@/app/api/v1/_lib/handler';
import {
  ForbiddenError,
  type WorkspaceContext,
} from '@/lib/auth/require-workspace';
import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { createRepos } from '@/lib/postgres-repository';
import { seriesCopyInputSchema } from '@/lib/validation/series-copy';
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
    venueUrl: input.venueUrl,
    eventUrl: input.eventUrl,
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
    ftpPaths: input.ftpPaths,
    includeJsonExport: input.includeJsonExport,
    publishRatingCalculations: input.publishRatingCalculations,
    enabledCompetitorFields: input.enabledCompetitorFields,
    primaryPersonLabel: input.primaryPersonLabel,
    subdivisionLabel: input.subdivisionLabel,
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

/**
 * ADR-008 Phase 7 — copy a series into another workspace the caller is a
 * member of. Copy rather than move so a botched copy is recoverable: the
 * source series stays intact in the source workspace.
 *
 * Strips workspace-scoped references that don't carry across:
 *   - FTP credentials (`ftpHost`, `ftpPath`, `ftpPaths`) — distinct per workspace
 *   - File-tracking metadata (`lastSnapshotId`, `lastSavedAt`,
 *     `snapshotHistory`) — the copy has no file lineage of its own
 *
 * Resets `version` to 1 and clears `updated_by` on every new row (the
 * `version` reset is automatic — fresh inserts default to 1; we just
 * don't pass an `updatedBy`). The copy is its own object, not an
 * attribution of the source's history.
 *
 * Single-transaction: either every child row lands or none does, so a
 * partial copy can't leak.
 */
export async function copySeries(
  workspace: WorkspaceContext,
  sourceSeriesId: string,
  body: unknown,
): Promise<{ id: string }> {
  const input = seriesCopyInputSchema.parse(body);
  const targetWorkspaceId = input.targetWorkspaceId;
  if (targetWorkspaceId === workspace.workspaceId) {
    throw new BadRequestError(
      'target workspace must differ from source workspace',
    );
  }

  const db = getDb();

  // Verify the caller belongs to the target workspace too. Source-side
  // membership is implied: workspaceRoute resolved workspace.workspaceId
  // and the series-load below is workspace-scoped.
  const [targetMember] = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, targetWorkspaceId),
        eq(schema.member.userId, workspace.userId),
      ),
    )
    .limit(1);
  if (!targetMember) {
    throw new ForbiddenError('not-a-member-of-target-workspace');
  }

  // Read source rows (workspace-scoped via the source workspaceId).
  const repos = createRepos({ db, workspaceId: workspace.workspaceId });
  const source = await repos.series.get(sourceSeriesId);
  if (!source) throw new NotFoundError('series');

  const sourceFleets = await repos.fleets.listBySeries(sourceSeriesId);
  const sourceCompetitors = await repos.competitors.listBySeries(sourceSeriesId);
  const sourceRaces = await repos.races.listBySeries(sourceSeriesId);

  const sourceRaceIds = sourceRaces.map((r) => r.id);
  const sourceRaceStarts =
    sourceRaceIds.length > 0
      ? await repos.raceStarts.listByRaces(sourceRaceIds)
      : [];
  const sourceFinishes =
    sourceCompetitors.length > 0
      ? await repos.finishes.listBySeries(
          sourceSeriesId,
          sourceCompetitors.map((c) => c.id),
        )
      : [];
  // Build id remap tables. UUIDs are generated up front so child rows
  // can rewrite parent FKs consistently inside the transaction.
  const newSeriesId = crypto.randomUUID();
  const fleetIdMap = new Map<string, string>();
  for (const f of sourceFleets) fleetIdMap.set(f.id, crypto.randomUUID());
  const competitorIdMap = new Map<string, string>();
  for (const c of sourceCompetitors)
    competitorIdMap.set(c.id, crypto.randomUUID());
  const raceIdMap = new Map<string, string>();
  for (const r of sourceRaces) raceIdMap.set(r.id, crypto.randomUUID());

  const trimmedName = (input.name ?? '').trim();
  const newName =
    trimmedName.length > 0 ? trimmedName : `Copy of ${source.name}`;
  const now = new Date();

  await db.transaction(async (tx) => {
    // Series — strip ftp/publishing/file-tracking state.
    await tx.insert(schema.series).values({
      id: newSeriesId,
      workspaceId: targetWorkspaceId,
      name: newName,
      venue: source.venue,
      startDate: source.startDate,
      endDate: source.endDate,
      venueLogoUrl: source.venueLogoUrl,
      eventLogoUrl: source.eventLogoUrl,
      venueUrl: source.venueUrl,
      eventUrl: source.eventUrl,
      createdAt: now,
      lastSnapshotId: null,
      lastSavedAt: null,
      lastModifiedAt: now,
      snapshotHistory: [],
      scoringMode: source.scoringMode,
      defaultStartSequence: source.defaultStartSequence ?? null,
      discardThresholds: source.discardThresholds,
      dnfScoring: source.dnfScoring,
      ftpHost: '',
      ftpPath: '',
      ftpPaths: {},
      includeJsonExport: source.includeJsonExport,
      publishRatingCalculations: source.publishRatingCalculations ?? true,
      enabledCompetitorFields: source.enabledCompetitorFields,
      primaryPersonLabel: source.primaryPersonLabel,
      subdivisionLabel: source.subdivisionLabel,
    });

    // Fleets.
    if (sourceFleets.length > 0) {
      await tx.insert(schema.fleets).values(
        sourceFleets.map((f) => ({
          id: fleetIdMap.get(f.id)!,
          seriesId: newSeriesId,
          workspaceId: targetWorkspaceId,
          name: f.name,
          displayOrder: f.displayOrder,
          scoringSystem: f.scoringSystem,
          echoAlpha: f.echoAlpha ?? null,
          nhcProfile: f.nhcProfile ?? null,
        })),
      );
    }

    // Competitors — fleetIds[] needs remapping element-by-element.
    if (sourceCompetitors.length > 0) {
      await tx.insert(schema.competitors).values(
        sourceCompetitors.map((c) => ({
          id: competitorIdMap.get(c.id)!,
          seriesId: newSeriesId,
          workspaceId: targetWorkspaceId,
          fleetIds: c.fleetIds.map((fid) => fleetIdMap.get(fid) ?? fid),
          sailNumber: c.sailNumber,
          boatName: c.boatName ?? null,
          boatClass: c.boatClass ?? null,
          name: c.name,
          owner: c.owner ?? null,
          helm: c.helm ?? null,
          crewName: c.crewName ?? null,
          club: c.club,
          nationality: c.nationality ?? null,
          gender: c.gender,
          age: c.age,
          subdivision: c.subdivision ?? null,
          createdAt: new Date(c.createdAt),
          ircTcc: c.ircTcc ?? null,
          pyNumber: c.pyNumber ?? null,
          nhcStartingTcf: c.nhcStartingTcf ?? null,
          echoStartingTcf: c.echoStartingTcf ?? null,
        })),
      );
    }

    // Races.
    if (sourceRaces.length > 0) {
      await tx.insert(schema.races).values(
        sourceRaces.map((r) => ({
          id: raceIdMap.get(r.id)!,
          seriesId: newSeriesId,
          workspaceId: targetWorkspaceId,
          raceNumber: r.raceNumber,
          date: r.date,
          createdAt: new Date(r.createdAt),
        })),
      );
    }

    // Race starts — fleet ids and parent race id need remapping.
    if (sourceRaceStarts.length > 0) {
      await tx.insert(schema.raceStarts).values(
        sourceRaceStarts.map((s) => ({
          id: crypto.randomUUID(),
          raceId: raceIdMap.get(s.raceId)!,
          fleetIds: s.fleetIds.map((fid) => fleetIdMap.get(fid) ?? fid),
          startTime: s.startTime,
        })),
      );
    }

    // Finishes — competitor and race ids need remapping. Unknown-sail
    // rows have no competitorId.
    if (sourceFinishes.length > 0) {
      await tx.insert(schema.finishes).values(
        sourceFinishes.map((f) => ({
          id: crypto.randomUUID(),
          raceId: raceIdMap.get(f.raceId)!,
          competitorId:
            f.competitorId != null ? competitorIdMap.get(f.competitorId) ?? null : null,
          unknownSailNumber: f.unknownSailNumber ?? null,
          sortOrder: f.sortOrder,
          tiedWithPrevious: f.tiedWithPrevious,
          finishTime: f.finishTime ?? null,
          resultCode: f.resultCode,
          startPresent: f.startPresent,
          penaltyCode: f.penaltyCode,
          penaltyOverride: f.penaltyOverride,
          redressMethod: f.redressMethod,
          redressExcludeRaces: f.redressExcludeRaces,
          redressIncludeRaces: f.redressIncludeRaces,
          redressIncludeAllLater: f.redressIncludeAllLater,
          redressPoints: f.redressPoints,
        })),
      );
    }

  });

  return { id: newSeriesId };
}
