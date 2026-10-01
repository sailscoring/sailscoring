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
import {
  relinkIdentitiesBestEffort,
  sweepOrphanIdentitiesBestEffort,
} from '@/lib/competitor-identity-reconcile';
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
import { describeSeriesChange } from '@/lib/series-change';
import { suggestFollowOnName } from '@/lib/series-name';
import { importPublicExport, parsePublicExport } from '@/lib/public-export';
import {
  buildSeriesFile,
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
  seriesNotesSchema,
  seriesInputSchema,
  seriesPublishPrefsSchema,
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
  // One endpoint writes the whole series row, so "what did this save change?"
  // has to be answered by comparing, not by which button was pressed. A null
  // answer means nothing changed at all.
  const change = existing ? describeSeriesChange(existing, merged) : null;
  if (existing && !change) {
    // A save that changes nothing is not an edit: writing it would bump
    // `version` — the token the "N edits since you published" indicators
    // subtract — and file an activity entry for something that didn't happen.
    // The compare-and-swap is skipped with it, which costs nothing: a payload
    // identical to the stored row has nothing to conflict over, and the caller
    // gets back the current row either way.
    return existing;
  }
  const saved = await repos.series.save(merged, {
    expectedVersion: opts?.expectedVersion,
    updatedBy: workspace.userId,
  });
  // Activity (#153): distinguish first write (create) from later edits, and
  // say which facet of the series an edit moved — the row carries everything
  // from the discard profile to a publish note, so a reader needs to know
  // which. Coalescing is per facet as well as per series+actor, so a run of
  // saves to the same facet reads as one entry while a scoring change is never
  // folded into an unrelated one and hidden.
  // touch: false — the PUT carries its own lastModifiedAt and the saved row's
  // version is already in the client's hands.
  await trackChange(workspace, {
    action: change ? change.action : 'series.created',
    seriesId: id,
    summary: change ? change.summary : 'Created the series',
    sessionKey: 'settings',
    dedupeKey: change ? `series:${id}:${change.facet}` : undefined,
    touch: false,
  });
  return saved;
}

/**
 * Write publish bookkeeping — the destination the publish dialog opens in, the
 * FTP server it was pointed at — and nothing else.
 *
 * Its own endpoint rather than a field on the general PUT for two reasons.
 * The PUT replaces the whole row under a compare-and-swap and records an
 * "Updated series settings" edit, so a preference write both collided with
 * real edits and told the scorer they had changed a setting when they had
 * only opened a dialog. And it bumped `version`, which is what the "N edits
 * since you last published" indicators count — so choosing a destination
 * reported an unpublished edit that didn't exist.
 *
 * Deliberately not behind the read-only guard: publishing a finalised series
 * is allowed — that is much of the point of finalising it — so recording
 * where the results went has to be allowed too. The repository's
 * workspace-scoped update is the tenancy check.
 */
export async function setSeriesPublishPrefs(
  workspace: WorkspaceContext,
  id: string,
  body: unknown,
): Promise<Series> {
  const prefs = seriesPublishPrefsSchema.parse(body);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const saved = await repos.series.setPublishPrefs(id, prefs);
  if (!saved) throw new NotFoundError('series');
  return saved;
}

/**
 * Write the explanatory note carried by published pages, and nothing else.
 *
 * Its own endpoint rather than a field on the general PUT. The note is typed
 * in the publish dialog, which has no business carrying the whole series row
 * back — a sentence about results going out should not be able to lose a race
 * against, or clobber, a real edit made meanwhile.
 *
 * And the PUT refuses a finalised series, while publishing finalised results
 * is allowed — much of the point of finalising them. A scorer publishing a
 * final result could reach the note field and not save it.
 *
 * Unlike publish bookkeeping this is a real edit: the note appears on the
 * page, so the write bumps `version` and files an entry saying what it was.
 */
export async function setSeriesNotes(
  workspace: WorkspaceContext,
  id: string,
  body: unknown,
): Promise<Series> {
  const notes = seriesNotesSchema.parse(body);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const existing = await repos.series.get(id);
  if (!existing) throw new NotFoundError('series');
  // Archived and as-published series stay read-only; final ones do not, which
  // is the whole reason this endpoint exists.
  if (existing.asPublished) throw new ArchivedError('series-as-published');
  if (existing.archived) throw new ArchivedError();
  const change = describeSeriesChange(existing, { ...existing, ...notes });
  if (!change) return existing;

  const saved = await repos.series.setNotes(id, notes, { updatedBy: workspace.userId });
  if (!saved) throw new NotFoundError('series');
  // touch: false — the write above already bumped the version and stamped the
  // actor, and a second bump would invalidate the row just returned.
  await trackChange(workspace, {
    action: change.action,
    seriesId: id,
    summary: change.summary,
    sessionKey: 'settings',
    dedupeKey: `series:${id}:${change.facet}`,
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
  // Its competitors went with it; so do the sailors they alone accounted for.
  await sweepOrphanIdentitiesBestEffort(workspace.workspaceId);
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
 * The copy carries everything a .sailscoring file does, and leaves behind
 * what doesn't belong to a fork:
 *   - Publishing destinations (FTP server and paths, publish mode, rrs.org
 *     push) — workspace-local, and two series must not publish to the same
 *     remote path
 *   - Page and series notes, and the results status — they describe the
 *     source's publications, not the event
 *   - File-tracking metadata (`lastSavedAt`) and import provenance (`source`)
 *   - Series-list organisation (`categoryId`, `archived`) — workspace-local,
 *     so the copy lands active and uncategorised (#154) — except that a
 *     same-workspace duplicate keeps its category, which does exist there
 *
 * Every row is freshly inserted, so `version` starts at 1 and `updated_by`
 * is empty: the copy is its own object, not an attribution of the source's
 * history.
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

  // The copy is the source's .sailscoring file opened into the target, so it
  // carries exactly what a file does — every stored field has to travel in
  // the file anyway, and a copy that listed columns by hand drifted every time
  // one was added. What a copy deliberately leaves behind is reset below.
  const file = await buildSeriesFile(
    sourceSeriesId,
    seriesFileReposFor({ db, workspaceId: workspace.workspaceId }),
  );
  file.series = {
    ...file.series,
    // Publishing destinations: FTP servers are workspace-local, and two
    // series must not publish to the same remote path or rrs.org event.
    ftpServerId: undefined,
    ftpHost: '',
    ftpPath: '',
    ftpPaths: undefined,
    ftpPagesExcluded: undefined,
    publishMode: undefined,
    ftpLastUploadedAt: undefined,
    ftpUploadedVersion: undefined,
    rrsOrgPush: undefined,
    // Notes describe one publication's pages ("corrected 16:40"), not the
    // event, so they must not follow a fork.
    seriesNote: undefined,
    pageNotes: undefined,
    // The results *status* stays behind — a copy is a fork whose scorer makes
    // their own finality assertion, so it lands provisional.
    resultsStatus: undefined,
    finalisedAt: undefined,
  };

  const trimmedName = (input.name ?? '').trim();
  const newName =
    trimmedName.length > 0 ? trimmedName : `Copy of ${source.name}`;

  const newSeriesId = await db.transaction((tx) =>
    openSeriesFromFile(
      file,
      seriesFileReposFor({ db: tx, workspaceId: targetWorkspaceId }),
      {
        name: newName,
        // Series-list organisation (#154) is workspace-local: a
        // cross-workspace copy lands uncategorised — the source category id
        // wouldn't exist in the target. A same-workspace duplicate keeps its
        // category, which does.
        categoryId: sameWorkspace ? source.categoryId ?? null : null,
      },
    ),
  );

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
      clubs: c.clubs,
      nationality: c.nationality ?? null,
      gender: c.gender,
      age: c.age,
      subdivisions: c.subdivisions ?? null,
      createdAt: new Date(c.createdAt),
      ircTcc: c.ircTcc ?? null,
      vprsTcc: c.vprsTcc ?? null,
      fixedTcf: c.fixedTcf ?? null,
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
          ratingLabel: f.ratingLabel ?? null,
          echoAlpha: f.echoAlpha ?? null,
          nhcProfile: f.nhcProfile ?? null,
          orcProfile: f.orcProfile ?? null,
          ratingVariant: f.ratingVariant ?? null,
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
