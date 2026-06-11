import 'server-only';
import { and, eq, sql } from 'drizzle-orm';

import {
  ArchivedError,
  BadRequestError,
  NotFoundError,
} from '@/app/api/v1/_lib/handler';
import {
  ForbiddenError,
  type WorkspaceContext,
} from '@/lib/auth/require-workspace';
import { recordActivity } from '@/lib/activity-log';
import { trackChange } from '@/lib/revision-log';
import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { createRepos } from '@/lib/postgres-repository';
import {
  assertSeriesDeletable,
  assertSeriesWritable,
} from '@/lib/api-handlers/series-access';
import { seriesCopyInputSchema } from '@/lib/validation/series-copy';
import {
  seriesArchiveInputSchema,
  seriesCategoryInputSchema,
  seriesInputSchema,
  seriesReorderSchema,
} from '@/lib/validation/series';
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
  // Read-only guard (#154): an archived series rejects edits. Creating a new
  // series (no existing row) is allowed; the archive *toggle* has its own
  // endpoint (`setSeriesArchived`) and bypasses this path.
  const existing = await repos.series.get(id);
  if (existing?.archived) throw new ArchivedError();
  // Spread the validated input rather than hand-copying field by field — a
  // field accepted by the schema but dropped here would silently disappear
  // on every settings save (the Feature Checklist's data-loss hazard). The
  // schema↔type drift guard lives next to seriesInputSchema, so this spread
  // stays total by construction. displayOrder and version ride along
  // harmlessly: the repository ignores both on save (displayOrder is
  // server-managed; version flows via expectedVersion).
  const merged: Series = {
    ...input,
    id,
    // Round-trip the series-list organisation fields (#154) so a full save
    // doesn't wipe them. The archive *toggle* has its own endpoint; category
    // moves have their own too — but both must survive an ordinary PUT.
    categoryId: input.categoryId ?? null,
    archived: input.archived ?? false,
    // Round-trip import provenance so an ordinary settings PUT doesn't wipe it.
    source: input.source ?? existing?.source,
  };
  // Copy-at-creation (flag locker Phase 3): a brand-new series with empty
  // burgee slots inherits the workspace's default venue/event logo URLs. Only
  // on create and only for empty slots, so a scorer can still clear a slot on a
  // later edit without it being re-filled. The default is already a URL (a
  // workspace, canonical, or pasted logo), so it copies across verbatim.
  if (!existing && workspace.features.includes('logo-library')) {
    const defaults = await repos.logos.getDefaults();
    // Venue falls back to the explicit default, then to the workspace's own
    // logo (the default-default). Event has no workspace-logo fallback.
    const venueDefault =
      defaults.venueLogoUrl || (await repos.logos.getWorkspaceLogo());
    if (!merged.venueLogoUrl && venueDefault) {
      merged.venueLogoUrl = venueDefault;
    }
    if (!merged.eventLogoUrl && defaults.eventLogoUrl) {
      merged.eventLogoUrl = defaults.eventLogoUrl;
    }
  }
  const saved = await repos.series.save(merged, {
    expectedVersion: opts?.expectedVersion,
    updatedBy: workspace.userId,
  });
  // Activity (#153): distinguish first write (create) from later edits. Edits
  // coalesce per series+actor so a run of saves reads as one "updated" entry.
  // touch: false — the PUT carries its own lastModifiedAt and the saved row's
  // version is already in the client's hands.
  await trackChange(workspace, {
    action: existing ? 'series.updated' : 'series.created',
    seriesId: id,
    summary: existing ? 'Updated series settings' : 'Created the series',
    sessionKey: 'settings',
    dedupeKey: existing ? `series:${id}` : undefined,
    touch: false,
  });
  return saved;
}

export async function deleteSeries(workspace: WorkspaceContext, id: string): Promise<void> {
  // Delete requires the series to be archived first (#154) — a deliberate
  // archive-then-delete step that blocks destructive snap decisions.
  await assertSeriesDeletable(workspace, id);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const existing = await repos.series.get(id);
  await repos.series.delete(id);
  // Workspace-level entry: the series page is gone, so it carries the name and
  // no seriesId.
  await recordActivity(workspace, {
    action: 'series.deleted',
    seriesId: null,
    summary: existing ? `Deleted series “${existing.name}”` : 'Deleted a series',
  });
}

/**
 * Archive / unarchive toggle (#154). Its own endpoint rather than a field on
 * the general PUT, so the PUT stays uniformly guarded by the read-only check
 * while this — the one write that must work *on* an archived series — bypasses
 * it. Archiving makes the series read-only; unarchiving restores edits.
 *
 * Load + save (no CAS): a deliberate, rare, single-actor action on a finished
 * series, so last-write-wins is acceptable; the worst case is reverting a
 * concurrent settings edit made in the sub-second window, which the archive
 * toggle's own version bump makes detectable downstream.
 */
export async function setSeriesArchived(
  workspace: WorkspaceContext,
  id: string,
  body: unknown,
): Promise<Series> {
  const { archived } = seriesArchiveInputSchema.parse(body);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const current = await repos.series.get(id);
  if (!current) throw new NotFoundError('series');
  const saved = await repos.series.save(
    { ...current, archived },
    { updatedBy: workspace.userId },
  );
  await recordActivity(workspace, {
    action: archived ? 'series.archived' : 'series.unarchived',
    seriesId: id,
    summary: archived ? 'Archived the series' : 'Unarchived the series',
  });
  return saved;
}

/**
 * Move a series between categories (#154) — its own lightweight endpoint so
 * the home-list `⋯` menu doesn't round-trip the whole series. Moving is an
 * edit, so it's blocked on an archived series; `null` clears the assignment
 * back to the synthetic "Uncategorized".
 */
export async function setSeriesCategory(
  workspace: WorkspaceContext,
  id: string,
  body: unknown,
): Promise<Series> {
  const { categoryId } = seriesCategoryInputSchema.parse(body);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const current = await repos.series.get(id);
  if (!current) throw new NotFoundError('series');
  if (current.archived) throw new ArchivedError();
  let categoryName: string | undefined;
  if (categoryId !== null) {
    const categories = await repos.categories.list();
    const category = categories.find((c) => c.id === categoryId);
    if (!category) {
      throw new BadRequestError('unknown category');
    }
    categoryName = category.name;
  }
  const saved = await repos.series.save(
    { ...current, categoryId },
    { updatedBy: workspace.userId },
  );
  await recordActivity(workspace, {
    action: 'series.recategorized',
    seriesId: id,
    summary: categoryName
      ? `Moved to “${categoryName}”`
      : 'Removed from its category',
  });
  return saved;
}

/**
 * Rewrite the manual sort order of the active series list. Mirrors the
 * category reorder: a list-organisation gesture, so it doesn't bump versions or
 * record per-series activity. Returns the freshly-ordered list.
 */
export async function reorderSeries(
  workspace: WorkspaceContext,
  body: unknown,
): Promise<{ items: Series[] }> {
  const { orderedIds } = seriesReorderSchema.parse(body);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  await repos.series.reorder(orderedIds);
  return { items: await repos.series.list() };
}

/**
 * ADR-008 Phase 7 — copy a series into another workspace the caller is a
 * member of. Copy rather than move so a botched copy is recoverable: the
 * source series stays intact in the source workspace.
 *
 * Strips workspace-scoped references that don't carry across:
 *   - FTP credentials (`ftpHost`, `ftpPath`, `ftpPaths`) — distinct per workspace
 *   - File-tracking metadata (`lastSavedAt`) — the copy has no file history
 *     of its own
 *   - Series-list organisation (`categoryId`, `archived`) — workspace-local;
 *     the copy lands active and uncategorised (#154)
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
      lastSavedAt: null,
      lastModifiedAt: now,
      scoringMode: source.scoringMode,
      defaultStartSequence: source.defaultStartSequence ?? null,
      discardThresholds: source.discardThresholds,
      dnfScoring: source.dnfScoring,
      ftpHost: '',
      ftpPath: '',
      ftpPaths: {},
      includeJsonExport: source.includeJsonExport,
      publishRatingCalculations: source.publishRatingCalculations ?? true,
      showPerRaceRatingsInSummary: source.showPerRaceRatingsInSummary ?? true,
      enabledCompetitorFields: source.enabledCompetitorFields,
      primaryPersonLabel: source.primaryPersonLabel,
      subdivisionLabel: source.subdivisionLabel,
      // Series-list organisation (#154) is workspace-local: a copy lands
      // active and uncategorised in the target workspace. The source category
      // id wouldn't exist there anyway.
      categoryId: null,
      archived: false,
      // Import provenance is deliberately not carried: a copy is a fork with
      // its own (reset) publishing destination, so it doesn't offer the
      // in-place "Update from Sailwave file" re-import.
      source: null,
      // Append to the end of the target workspace's active list.
      displayOrder: sql<number>`(select coalesce(max(${schema.series.displayOrder}) + 1, 0) from ${schema.series} where ${schema.series.workspaceId} = ${targetWorkspaceId})`,
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

  // Logged in the *target* workspace — that's where the new series lives.
  await recordActivity(
    { workspaceId: targetWorkspaceId, userId: workspace.userId },
    {
      action: 'series.copied',
      seriesId: newSeriesId,
      summary: `Copied in series “${newName}”`,
    },
  );
  return { id: newSeriesId };
}
