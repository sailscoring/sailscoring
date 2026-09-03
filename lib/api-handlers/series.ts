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
import { hasPermission } from '@/lib/auth/permissions';
import { recordActivity } from '@/lib/activity-log';
import { relinkIdentitiesBestEffort } from '@/lib/competitor-identity-reconcile';
import { captureTombstone } from '@/lib/deleted-series';
import { trackChange } from '@/lib/revision-log';
import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { createRepos, seriesFileReposFor } from '@/lib/postgres-repository';
import {
  assertSeriesDeletable,
  assertSeriesWritable,
} from '@/lib/api-handlers/series-access';
import { listTcfHistory } from '@/lib/api-handlers/tcf-history';
import { suggestFollowOnName } from '@/lib/series-name';
import { importPublicExport, parsePublicExport } from '@/lib/public-export';
import {
  openSeriesFromFile,
  parseSeriesFile,
  updateSeriesFromFile,
  type SeriesFileRepos,
} from '@/lib/series-file';
import { endOfSeriesTcfKey, endOfSeriesTcfs } from '@/lib/source-handicaps';
import { seriesCopyInputSchema } from '@/lib/validation/series-copy';
import { seriesImportInputSchema } from '@/lib/validation/series-import';
import { seriesFollowOnInputSchema } from '@/lib/validation/series-follow-on';
import {
  seriesArchiveInputSchema,
  seriesCategoryInputSchema,
  seriesInputSchema,
  seriesReorderSchema,
  seriesResultsStatusInputSchema,
} from '@/lib/validation/series';
import type { Competitor, Fleet, Series } from '@/lib/types';

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

/** The workspace a series lives in, resolved across the caller's memberships. */
export interface SeriesLocation {
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
}

/**
 * Locate a series across every workspace the caller is a member of.
 *
 * The scoped GET can only see the active workspace, so a series URL opened
 * while the session's active workspace points elsewhere (another tab switched
 * it) dead-ends on 404. This lookup answers "which of the caller's workspaces
 * holds this series id" so the client can offer an explicit switch back.
 * Fails closed: a series in a workspace the caller is not a member of is
 * indistinguishable from a missing one.
 */
export async function locateSeries(
  workspace: WorkspaceContext,
  id: string,
): Promise<SeriesLocation> {
  const [row] = await getDb()
    .select({
      workspaceId: schema.organization.id,
      workspaceSlug: schema.organization.slug,
      workspaceName: schema.organization.name,
    })
    .from(schema.series)
    .innerJoin(
      schema.member,
      and(
        eq(schema.member.organizationId, schema.series.workspaceId),
        eq(schema.member.userId, workspace.userId),
      ),
    )
    .innerJoin(
      schema.organization,
      eq(schema.organization.id, schema.series.workspaceId),
    )
    .where(eq(schema.series.id, id))
    .limit(1);
  if (!row) throw new NotFoundError('series');
  return row;
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
  if (existing?.asPublished) throw new ArchivedError('series-as-published');
  if (existing?.archived) throw new ArchivedError();
  if (existing?.resultsStatus === 'final') throw new ArchivedError('series-final');
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
  // Soft delete: capture a recoverable tombstone before the live rows go. The
  // snapshot reads them, so it must run before the hard delete. The Trash view
  // recovers it within the retention window.
  const actor = { workspaceId: workspace.workspaceId, userId: workspace.userId };
  await captureTombstone(actor, id);
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
 * Mark the series' results final, or reopen them as provisional. Like the
 * archive toggle, its own endpoint bypassing the read-only guard: reopening
 * is the one write that must work on a final series. The checklist that
 * makes "final" mean something (protest time limit passed, no open
 * inquiries, nothing outstanding — RRS 90.3(e)) lives in the UI; the server
 * records the assertion and stamps when it was made.
 *
 * Allowed on an archived series (a results assertion, not a content edit —
 * finalising after archiving the season is a natural order of operations)
 * but not on an as-published archive, whose results were settled the moment
 * they were ingested.
 */
export async function setSeriesResultsStatus(
  workspace: WorkspaceContext,
  id: string,
  body: unknown,
): Promise<Series> {
  const { status } = seriesResultsStatusInputSchema.parse(body);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const current = await repos.series.get(id);
  if (!current) throw new NotFoundError('series');
  if (current.asPublished) {
    throw new BadRequestError('an as-published archive series has no results lifecycle');
  }
  const final = status === 'final';
  const saved = await repos.series.save(
    {
      ...current,
      resultsStatus: status,
      finalisedAt: final ? Date.now() : undefined,
    },
    { updatedBy: workspace.userId },
  );
  // `resultsStatus` / `finalisedAt` are `.sailscoring` fields, so the
  // assertion needs a revision pinning the state that was declared final —
  // not just an activity entry. `touch: false`: the save already bumped.
  await trackChange(workspace, {
    action: final ? 'series.finalised' : 'series.reopened',
    seriesId: id,
    summary: final
      ? 'Marked the results final'
      : 'Reopened the results as provisional',
    sessionKey: 'results-status',
    touch: false,
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
  // Deliberately not guarded by `archived`: filing a series in a category is
  // workspace organisation, not a content edit, and since ADR-010 archived is
  // the normal resting state of whole corpora that still need organising.
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
 * ADR-008 Phase 7 — copy a series into a workspace the caller is a member
 * of: another workspace, or (when `targetWorkspaceId` is omitted or equals
 * the source) the source workspace itself — the "Duplicate" action. Copy
 * rather than move so a botched copy is recoverable: the source series
 * stays intact.
 *
 * Strips workspace-scoped references that don't carry across:
 *   - FTP credentials (`ftpHost`, `ftpPath`, `ftpPaths`) — distinct per
 *     workspace, and two series must not publish to the same remote path
 *   - File-tracking metadata (`lastSavedAt`) — the copy has no file history
 *     of its own
 *   - Series-list organisation (`categoryId`, `archived`) — workspace-local,
 *     so the copy lands active and uncategorised (#154) — except that a
 *     same-workspace duplicate keeps its category, which does exist there
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
  const targetWorkspaceId = input.targetWorkspaceId ?? workspace.workspaceId;
  const sameWorkspace = targetWorkspaceId === workspace.workspaceId;

  const db = getDb();

  // Verify the caller belongs to the target workspace too. Source-side
  // membership is implied: workspaceRoute resolved workspace.workspaceId
  // and the series-load below is workspace-scoped. The route itself only
  // demands `read` (copying out is read-level on the source), so the
  // create-side permission is checked here against the caller's role in
  // the *target* workspace — which for a same-workspace duplicate is the
  // source workspace itself.
  const [targetMember] = await db
    .select({ id: schema.member.id, role: schema.member.role })
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
  if (!hasPermission(targetMember.role, 'manage-series')) {
    throw new ForbiddenError('permission-denied:manage-series');
  }

  // Read source rows (workspace-scoped via the source workspaceId).
  const repos = createRepos({ db, workspaceId: workspace.workspaceId });
  const source = await repos.series.get(sourceSeriesId);
  if (!source) throw new NotFoundError('series');
  // An as-published series can't be copied: its results live in
  // as_published_results (not races/finishes), so a copy would silently be
  // an empty shell. The archive repo is where such a series is replicated.
  if (source.asPublished) {
    throw new BadRequestError('an as-published archive series cannot be copied');
  }

  const sourceFleets = await repos.fleets.listBySeries(sourceSeriesId);
  const sourceCompetitors = await repos.competitors.listBySeries(sourceSeriesId);
  const sourceRaces = await repos.races.listBySeries(sourceSeriesId);

  const sourceSubSeries = await repos.subSeries.listBySeries(sourceSeriesId);
  const sourceRaceIds = sourceRaces.map((r) => r.id);
  const sourceRaceStarts =
    sourceRaceIds.length > 0
      ? await repos.raceStarts.listByRaces(sourceRaceIds)
      : [];
  const sourceFinishes = await repos.finishes.listBySeries(sourceSeriesId);
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
  const subSeriesIdMap = new Map<string, string>();
  for (const ss of sourceSubSeries) subSeriesIdMap.set(ss.id, crypto.randomUUID());

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
      // Start groups reference fleets by id, so they remap like every
      // other fleet-bearing child row.
      defaultStartSequence: source.defaultStartSequence
        ? source.defaultStartSequence.map((g) => ({
            ...g,
            fleetIds: g.fleetIds.map((fid) => fleetIdMap.get(fid) ?? fid),
          }))
        : null,
      discardThresholds: source.discardThresholds,
      dnfScoring: source.dnfScoring,
      ftpHost: '',
      ftpPath: '',
      ftpPaths: {},
      includeJsonExport: source.includeJsonExport,
      publishRatingCalculations: source.publishRatingCalculations ?? true,
      showPerRaceRatingsInSummary: source.showPerRaceRatingsInSummary ?? true,
      // Combined pages follow their member fleets through the remap.
      publishingGroups: (source.publishingGroups ?? []).map((g) => ({
        ...g,
        fleetIds: g.fleetIds.map((fid) => fleetIdMap.get(fid) ?? fid),
      })),
      publishIndividualFleetPages: source.publishIndividualFleetPages ?? true,
      publishDetail: source.publishDetail ?? 'full',
      // The protest-time-limit config travels (it mirrors the SIs); the
      // results *status* does not — a copy is a fork whose scorer makes
      // their own finality assertion, so it lands provisional.
      protestTimeLimit: source.protestTimeLimit ?? null,
      // The standing team and its publish decision travel with the rest of the
      // event config; the copy's scorer edits whoever has changed.
      officials: source.officials ?? [],
      publishOfficials: source.publishOfficials ?? false,
      enabledCompetitorFields: source.enabledCompetitorFields,
      multiPersonFields: source.multiPersonFields?.length ? source.multiPersonFields : null,
      primaryPersonLabel: source.primaryPersonLabel,
      // Axis ids are series-local — carried verbatim so competitor
      // `subdivisions` keys still resolve in the copy.
      subdivisionAxes: source.subdivisionAxes,
      // Series-list organisation (#154) is workspace-local: a cross-workspace
      // copy lands uncategorised — the source category id wouldn't exist in
      // the target. A same-workspace duplicate keeps its category, which does.
      // Both land active.
      categoryId: sameWorkspace ? source.categoryId ?? null : null,
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
          orcProfile: f.orcProfile ?? null,
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
          names: c.names,
          owners: c.owners?.length ? c.owners : null,
          helms: c.helms?.length ? c.helms : null,
          crewNames: c.crewNames?.length ? c.crewNames : null,
          club: c.club,
          nationality: c.nationality ?? null,
          gender: c.gender,
          age: c.age,
          subdivisions: c.subdivisions ?? null,
          createdAt: new Date(c.createdAt),
          ircTcc: c.ircTcc ?? null,
          vprsTcc: c.vprsTcc ?? null,
          pyNumber: c.pyNumber ?? null,
          nhcStartingTcf: c.nhcStartingTcf ?? null,
          echoStartingTcf: c.echoStartingTcf ?? null,
          orcCert: c.orcCert ?? null,
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
          name: r.name ?? null,
          date: r.date,
          finishRecording: r.finishRecording ?? null,
          lastFinisherTime: r.lastFinisherTime ?? null,
          discardPolicy: r.discardPolicy ?? null,
          pointsMultiplier: r.pointsMultiplier ?? null,
          // A copy duplicates the racing, finishes and all, so what each race
          // was sailed in and who ran it are part of what is being copied.
          conditions: r.conditions ?? null,
          officials: r.officials ?? null,
          createdAt: new Date(r.createdAt),
        })),
      );
    }

    // Sub-series — after races so the membership FK resolves.
    if (sourceSubSeries.length > 0) {
      await tx.insert(schema.subSeries).values(
        sourceSubSeries.map((ss) => ({
          id: subSeriesIdMap.get(ss.id)!,
          seriesId: newSeriesId,
          workspaceId: targetWorkspaceId,
          name: ss.name,
          displayOrder: ss.displayOrder,
          startingHandicapSource: ss.startingHandicapSource ?? 'base',
          continueFromSubSeriesId:
            ss.continueFromSubSeriesId != null
              ? subSeriesIdMap.get(ss.continueFromSubSeriesId) ?? null
              : null,
        })),
      );
      const membership = sourceSubSeries.flatMap((ss) =>
        ss.raceIds
          .map((rid) => raceIdMap.get(rid))
          .filter((rid): rid is string => rid !== undefined)
          .map((raceId) => ({
            subSeriesId: subSeriesIdMap.get(ss.id)!,
            raceId,
            workspaceId: targetWorkspaceId,
          })),
      );
      if (membership.length > 0) {
        await tx.insert(schema.subSeriesRaces).values(membership);
      }
    }

    // Race starts — fleet ids and parent race id need remapping.
    if (sourceRaceStarts.length > 0) {
      await tx.insert(schema.raceStarts).values(
        sourceRaceStarts.map((s) => ({
          id: crypto.randomUUID(),
          raceId: raceIdMap.get(s.raceId)!,
          fleetIds: s.fleetIds.map((fid) => fleetIdMap.get(fid) ?? fid),
          startTime: s.startTime,
          // Course facts are scoring inputs (ORC ToD/PCS) and copy with the
          // race data.
          distanceNm: s.distanceNm ?? null,
          orcScoringWind: s.orcScoringWind ?? null,
          courseLegs: s.courseLegs?.length ? s.courseLegs : null,
          orcOption: s.orcOption ?? null,
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
          // Elapsed time is a scoring input, so a copy that dropped it would
          // score differently from its source. Track data rides along for the
          // same reason it is stored at all — the copy is the same race.
          elapsedSecs: f.elapsedSecs ?? null,
          trackData: f.trackData ?? null,
          resultCode: f.resultCode,
          startPresent: f.startPresent,
          penaltyCode: f.penaltyCode,
          penaltyOverride: f.penaltyOverride,
          redressMethod: f.redressMethod,
          redressExcludeRaceIds: f.redressExcludeRaceIds,
          redressIncludeRaceIds: f.redressIncludeRaceIds,
          redressIncludeAllLater: f.redressIncludeAllLater,
          redressPoints: f.redressPoints,
        })),
      );
    }

  });

  // Logged in the *target* workspace — that's where the new series lives —
  // and with a baseline revision, so the copy is restorable from the state it
  // was created in.
  await trackChange(
    { workspaceId: targetWorkspaceId, userId: workspace.userId },
    {
      action: 'series.copied',
      seriesId: newSeriesId,
      summary: sameWorkspace
        ? `Duplicated series “${source.name}” as “${newName}”`
        : `Copied in series “${newName}”`,
      sessionKey: 'copy',
      touch: false,
    },
  );
  // Lazy identity population (#222) in the *target* workspace — the copy's
  // competitors are new rows there.
  await relinkIdentitiesBestEffort(targetWorkspaceId);
  return { id: newSeriesId };
}

/**
 * ADR-009 M2 — import a document into the active workspace as a new series.
 * Two documents describe a series: a scorer's `.sailscoring` file, and the
 * sanitized `.sailscoring.json` a publication serves beside its pages
 * (ADR-012), which is what "Open in Sail Scoring" hands a reader. The body
 * carries the raw text of either; each has its own parser doing the
 * structural validation and version migration (a parse failure is a 400),
 * and each importer mints a fresh series id, remaps every child id, and
 * disambiguates the name against the workspace.
 *
 * Both run in one transaction, which is what makes an import an import: a
 * mid-import failure leaves no partial series, and the whole thing costs one
 * activity entry and one revision instead of one per row.
 *
 * Embedded revision history is not restored: `seriesFileReposFor` omits the
 * optional revision hooks, which suits bulk-importing historical files.
 */
export async function importSeries(
  workspace: WorkspaceContext,
  body: unknown,
): Promise<{ id: string }> {
  const { content, format } = seriesImportInputSchema.parse(body);

  let name: string;
  let run: (repos: SeriesFileRepos) => Promise<string>;
  if (format === 'public-export') {
    let data;
    try {
      data = parsePublicExport(content);
    } catch (err) {
      throw new BadRequestError(
        err instanceof Error ? err.message : 'invalid published results data',
      );
    }
    name = data.series.name;
    // `seriesFileReposFor` structurally satisfies the narrower `ImportRepos`,
    // as it does the export builder's `ExportRepos`.
    run = (repos) => importPublicExport(data, repos);
  } else {
    let file;
    try {
      file = parseSeriesFile(content);
    } catch (err) {
      throw new BadRequestError(
        err instanceof Error ? err.message : 'invalid .sailscoring file',
      );
    }
    name = file.series.name;
    run = (repos) => openSeriesFromFile(file, repos);
  }

  const db = getDb();
  const id = await db.transaction(async (tx) =>
    run(seriesFileReposFor({ db: tx, workspaceId: workspace.workspaceId })),
  );

  // Baseline revision: a freshly imported series starts restorable, rather
  // than having its first history entry be whatever edit happens to land next
  // — which would also swallow this activity entry into that edit's window.
  await trackChange(workspace, {
    action: 'series.imported',
    seriesId: id,
    summary: `Imported series “${name}”`,
    sessionKey: 'import',
    touch: false,
  });
  // Lazy identity population (#222): link the imported competitors. Identity
  // is workspace-local and never travels in either document, so it's
  // re-derived here.
  await relinkIdentitiesBestEffort(workspace.workspaceId);
  return { id };
}

/** The series row as `putSeriesFile` needs it, unscoped by workspace so an id
 *  squatting in another workspace is a hard error, never a silent insert.
 *  Mirrors the as-published ingest's own lookup. */
async function seriesRowById(id: string) {
  const [row] = await getDb()
    .select({
      id: schema.series.id,
      workspaceId: schema.series.workspaceId,
      asPublished: schema.series.asPublished,
    })
    .from(schema.series)
    .where(eq(schema.series.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * Upsert a full-fidelity series from a `.sailscoring` file at a caller-chosen
 * id — the re-runnable counterpart to {@link importSeries}.
 *
 * `importSeries` is what a scorer means by "import": every call mints a fresh
 * series, so opening the same file twice gives two series. That is wrong for a
 * generator that owns its identity — an archive repo deriving ids from stable
 * keys and re-emitting as a season goes on — where the second run means *this
 * series again, updated*. Same shape as the as-published ingest
 * (`putArchiveSeries`) and the same guards: an id already live in another
 * workspace is a 403 rather than a silent insert, and an as-published series is
 * never clobbered by a full-fidelity file.
 *
 * An existing series is replayed through `updateSeriesFromFile`, which keeps
 * its id, `createdAt`, category and archived flag while replacing the racing.
 * Embedded revision history is not restored on that path — the series keeps the
 * server-side history it has already accumulated.
 */
export async function putSeriesFile(
  workspace: WorkspaceContext,
  seriesId: string,
  body: unknown,
): Promise<{ id: string; created: boolean }> {
  const { content } = seriesImportInputSchema.parse(body);
  let file;
  try {
    file = parseSeriesFile(content);
  } catch (err) {
    throw new BadRequestError(
      err instanceof Error ? err.message : 'invalid .sailscoring file',
    );
  }
  if (file.seriesId !== seriesId) {
    throw new BadRequestError('file series id does not match the path');
  }

  const existing = await seriesRowById(seriesId);
  if (existing && existing.workspaceId !== workspace.workspaceId) {
    throw new ForbiddenError('series-id-in-use');
  }
  if (existing?.asPublished) {
    throw new BadRequestError(
      'an as-published series already has this id; ingest it through as-published push instead',
      { code: 'as-published-series-exists' },
    );
  }

  if (existing) {
    await assertSeriesWritable(workspace, seriesId);
    await updateSeriesFromFile(
      seriesId,
      file,
      seriesFileReposFor({ workspaceId: workspace.workspaceId }),
    );
  } else {
    const db = getDb();
    await db.transaction(async (tx) => {
      const repos = seriesFileReposFor({ db: tx, workspaceId: workspace.workspaceId });
      return openSeriesFromFile(file, repos, { seriesId });
    });
  }

  await trackChange(workspace, {
    action: existing ? 'series.updated' : 'series.imported',
    seriesId,
    summary: `${existing ? 'Replaced' : 'Imported'} series “${file.series.name}” from a file`,
    sessionKey: 'import',
    touch: false,
  });
  // Identity is workspace-local and never travels in the file, so the
  // competitor rows this just wrote need re-linking (#222).
  await relinkIdentitiesBestEffort(workspace.workspaceId);
  return { id: seriesId, created: !existing };
}

/**
 * Create a follow-on series in the same workspace — the next series of a
 * season, rolled over from a finished one. Copies the source's
 * configuration, fleets, and competitors; none of its races, starts,
 * finishes, or rating overrides. Each boat's progressive starting handicap
 * (NHC/ECHO) is seeded from its end-of-series TCF in the source, so the
 * new series picks up where the old one's ratings left off; static ratings
 * (IRC/PY/VPRS) carry on the competitor row as-is. The new series records
 * its lineage in `previousSeriesId`.
 *
 * Archived sources are allowed: this never writes the source, and
 * archiving the finished series before rolling it over is the natural
 * order of operations.
 */
export async function createFollowOnSeries(
  workspace: WorkspaceContext,
  sourceSeriesId: string,
  body: unknown,
): Promise<{ id: string; seededCount: number }> {
  const input = seriesFollowOnInputSchema.parse(body);
  const db = getDb();
  const repos = createRepos({ db, workspaceId: workspace.workspaceId });
  const source = await repos.series.get(sourceSeriesId);
  if (!source) throw new NotFoundError('series');
  // No follow-on from an as-published archive: there are no in-app results
  // or progressive handicaps to roll forward.
  if (source.asPublished) {
    throw new BadRequestError('an as-published archive series cannot seed a follow-on');
  }

  const sourceFleets = await repos.fleets.listBySeries(sourceSeriesId);
  const sourceCompetitors = await repos.competitors.listBySeries(sourceSeriesId);
  const sourceRaces = await repos.races.listBySeries(sourceSeriesId);

  // End-of-series progressive handicaps. A (competitor × fleet) pairing
  // with no scored races is absent from the map; those boats keep the
  // starting TCF they already carry on the source row.
  const history = await listTcfHistory(workspace, sourceSeriesId);
  const endTcfs = endOfSeriesTcfs(
    sourceCompetitors,
    sourceFleets,
    sourceRaces,
    history,
  );

  const fleetById = new Map(sourceFleets.map((f) => [f.id, f]));
  // A boat can sit in more than one fleet of the same progressive system,
  // but the starting-TCF field is per system — the boat's first such fleet
  // (by display order) wins.
  const seededTcf = (
    c: Competitor,
    system: 'nhc' | 'echo',
  ): number | undefined => {
    const fleetsOfSystem = c.fleetIds
      .map((fid) => fleetById.get(fid))
      .filter((f): f is Fleet => f !== undefined && f.scoringSystem === system)
      .sort((a, b) => a.displayOrder - b.displayOrder);
    for (const f of fleetsOfSystem) {
      const entry = endTcfs.get(endOfSeriesTcfKey(c.id, f.id));
      if (entry) return entry.endTcf;
    }
    return undefined;
  };

  const newSeriesId = crypto.randomUUID();
  const fleetIdMap = new Map<string, string>();
  for (const f of sourceFleets) fleetIdMap.set(f.id, crypto.randomUUID());

  let newName = (input.name ?? '').trim();
  if (newName.length === 0) {
    const existing = await db
      .select({ name: schema.series.name })
      .from(schema.series)
      .where(eq(schema.series.workspaceId, workspace.workspaceId));
    newName = suggestFollowOnName(source.name, existing.map((r) => r.name));
  }

  let seededCount = 0;
  const competitorRows = sourceCompetitors.map((c) => {
    const nhcSeed = seededTcf(c, 'nhc');
    const echoSeed = seededTcf(c, 'echo');
    if (nhcSeed !== undefined) seededCount++;
    if (echoSeed !== undefined) seededCount++;
    return {
      id: crypto.randomUUID(),
      seriesId: newSeriesId,
      workspaceId: workspace.workspaceId,
      fleetIds: c.fleetIds.map((fid) => fleetIdMap.get(fid) ?? fid),
      sailNumber: c.sailNumber,
      boatName: c.boatName ?? null,
      boatClass: c.boatClass ?? null,
      names: c.names,
      owners: c.owners?.length ? c.owners : null,
      helms: c.helms?.length ? c.helms : null,
      crewNames: c.crewNames?.length ? c.crewNames : null,
      club: c.club,
      nationality: c.nationality ?? null,
      gender: c.gender,
      age: c.age,
      subdivisions: c.subdivisions ?? null,
      createdAt: new Date(c.createdAt),
      ircTcc: c.ircTcc ?? null,
      vprsTcc: c.vprsTcc ?? null,
      pyNumber: c.pyNumber ?? null,
      nhcStartingTcf: nhcSeed ?? c.nhcStartingTcf ?? null,
      echoStartingTcf: echoSeed ?? c.echoStartingTcf ?? null,
      orcCert: c.orcCert ?? null,
    };
  });

  const now = new Date();

  await db.transaction(async (tx) => {
    // Series — publishing/file-tracking state resets like a copy, but the
    // category carries: the follow-on belongs to the same season's bucket.
    await tx.insert(schema.series).values({
      id: newSeriesId,
      workspaceId: workspace.workspaceId,
      name: newName,
      venue: source.venue,
      startDate: input.startDate ?? '',
      endDate: '',
      venueLogoUrl: source.venueLogoUrl,
      eventLogoUrl: source.eventLogoUrl,
      venueUrl: source.venueUrl,
      eventUrl: source.eventUrl,
      createdAt: now,
      lastSavedAt: null,
      lastModifiedAt: now,
      scoringMode: source.scoringMode,
      defaultStartSequence: source.defaultStartSequence
        ? source.defaultStartSequence.map((g) => ({
            ...g,
            fleetIds: g.fleetIds.map((fid) => fleetIdMap.get(fid) ?? fid),
          }))
        : null,
      discardThresholds: source.discardThresholds,
      dnfScoring: source.dnfScoring,
      ftpHost: '',
      ftpPath: '',
      ftpPaths: {},
      includeJsonExport: source.includeJsonExport,
      publishRatingCalculations: source.publishRatingCalculations ?? true,
      showPerRaceRatingsInSummary: source.showPerRaceRatingsInSummary ?? true,
      // Combined pages follow their member fleets through the remap.
      publishingGroups: (source.publishingGroups ?? []).map((g) => ({
        ...g,
        fleetIds: g.fleetIds.map((fid) => fleetIdMap.get(fid) ?? fid),
      })),
      publishIndividualFleetPages: source.publishIndividualFleetPages ?? true,
      publishDetail: source.publishDetail ?? 'full',
      // Same SIs, next series of the season: the limit config rolls over;
      // the fresh series is provisional by construction.
      protestTimeLimit: source.protestTimeLimit ?? null,
      // Same club, next series of the season: the standing team rolls over
      // like the rest of the config, and rotates by editing.
      officials: source.officials ?? [],
      publishOfficials: source.publishOfficials ?? false,
      enabledCompetitorFields: source.enabledCompetitorFields,
      multiPersonFields: source.multiPersonFields?.length ? source.multiPersonFields : null,
      primaryPersonLabel: source.primaryPersonLabel,
      subdivisionAxes: source.subdivisionAxes,
      categoryId: source.categoryId ?? null,
      archived: false,
      source: null,
      previousSeriesId: sourceSeriesId,
      displayOrder: sql<number>`(select coalesce(max(${schema.series.displayOrder}) + 1, 0) from ${schema.series} where ${schema.series.workspaceId} = ${workspace.workspaceId})`,
    });

    if (sourceFleets.length > 0) {
      await tx.insert(schema.fleets).values(
        sourceFleets.map((f) => ({
          id: fleetIdMap.get(f.id)!,
          seriesId: newSeriesId,
          workspaceId: workspace.workspaceId,
          name: f.name,
          displayOrder: f.displayOrder,
          scoringSystem: f.scoringSystem,
          echoAlpha: f.echoAlpha ?? null,
          nhcProfile: f.nhcProfile ?? null,
          orcProfile: f.orcProfile ?? null,
        })),
      );
    }

    if (competitorRows.length > 0) {
      await tx.insert(schema.competitors).values(competitorRows);
    }
  });

  await trackChange(
    { workspaceId: workspace.workspaceId, userId: workspace.userId },
    {
      action: 'series.created-follow-on',
      seriesId: newSeriesId,
      summary: `Created follow-on series “${newName}” from “${source.name}”`,
      sessionKey: 'follow-on',
      touch: false,
    },
  );
  // Lazy identity population (#222): the rolled-over entry list is new rows.
  await relinkIdentitiesBestEffort(workspace.workspaceId);
  return { id: newSeriesId, seededCount };
}
