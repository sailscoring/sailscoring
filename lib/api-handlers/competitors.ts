import 'server-only';

import { and, eq } from 'drizzle-orm';

import { NotFoundError } from '@/app/api/v1/_lib/handler';
import { recordActivity } from '@/lib/activity-log';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { createRepos } from '@/lib/postgres-repository';
import {
  assertCompetitorWritable,
  assertSeriesWritable,
} from '@/lib/api-handlers/series-access';
import {
  competitorInputSchema,
  competitorsBulkInputSchema,
  handicapBulkUpdateSchema,
} from '@/lib/validation/competitor';
import type { AuditStamp, Competitor } from '@/lib/types';

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
  opts?: { expectedVersion?: number },
): Promise<Competitor> {
  await assertSeriesWritable(workspace, seriesId);
  const input = competitorInputSchema.parse(body);
  const id = input.id ?? pathCompetitorId;
  if (id !== pathCompetitorId) throw new NotFoundError('competitor id mismatch');
  if (input.seriesId !== seriesId) throw new NotFoundError('competitor series mismatch');
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  return repos.competitors.save(
    { ...input, id },
    { expectedVersion: opts?.expectedVersion, updatedBy: workspace.userId },
  );
}

export async function deleteCompetitor(
  workspace: WorkspaceContext,
  seriesId: string,
  competitorId: string,
): Promise<void> {
  await assertSeriesWritable(workspace, seriesId);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const existing = await repos.competitors.get(competitorId);
  if (!existing || existing.seriesId !== seriesId) return;
  await repos.competitors.delete(competitorId);
}

/**
 * Bulk upsert. The body is `{ competitors: Competitor[] }`. All
 * competitors must share the path's seriesId; mixed-series batches are
 * rejected.
 */
export async function bulkPutCompetitors(
  workspace: WorkspaceContext,
  seriesId: string,
  body: unknown,
): Promise<{ count: number }> {
  await assertSeriesWritable(workspace, seriesId);
  const input = competitorsBulkInputSchema.parse(body);
  for (const c of input.competitors) {
    if (c.seriesId !== seriesId) {
      throw new NotFoundError('bulk competitor series mismatch');
    }
  }
  const competitors: Competitor[] = input.competitors.map((c) => ({
    ...c,
    id: c.id ?? crypto.randomUUID(),
  }));
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  await repos.competitors.saveMany(competitors, { updatedBy: workspace.userId });
  const n = competitors.length;
  await recordActivity(workspace, {
    action: 'competitors.imported',
    seriesId,
    summary: `Imported ${n} competitor${n === 1 ? '' : 's'}`,
  });
  return { count: competitors.length };
}

/**
 * Bulk handicap update for the Update Handicaps dialog (#144). Writes
 * only the listed handicap fields on each competitor; non-handicap
 * fields are untouched. The whole batch runs in one Drizzle transaction,
 * so a `ConflictError` on any row rolls the lot back — the dialog asks
 * the scorer to refresh and try again rather than partially applying.
 *
 * Each row carries an `expectedVersion`; the repo's per-row CAS surfaces
 * the standard 409 detail (`currentVersion`, `actor`) for whichever row
 * lost the race.
 */
export async function bulkUpdateHandicaps(
  workspace: WorkspaceContext,
  seriesId: string,
  body: unknown,
): Promise<{ updated: Competitor[] }> {
  await assertSeriesWritable(workspace, seriesId);
  const { updates } = handicapBulkUpdateSchema.parse(body);

  const db = getDb();
  const updated: Competitor[] = [];
  await db.transaction(async (tx) => {
    const repos = createRepos({ db: tx, workspaceId: workspace.workspaceId });
    for (const u of updates) {
      const existing = await repos.competitors.get(u.competitorId);
      if (!existing || existing.seriesId !== seriesId) {
        throw new NotFoundError('competitor');
      }
      // Build the next row by merging only the supplied handicap fields.
      // `undefined` means "not in this update" and leaves the field alone.
      const next: Competitor = {
        ...existing,
        ...(u.ircTcc !== undefined ? { ircTcc: u.ircTcc } : {}),
        ...(u.pyNumber !== undefined ? { pyNumber: u.pyNumber } : {}),
        ...(u.nhcStartingTcf !== undefined ? { nhcStartingTcf: u.nhcStartingTcf } : {}),
        ...(u.echoStartingTcf !== undefined ? { echoStartingTcf: u.echoStartingTcf } : {}),
      };
      const saved = await repos.competitors.save(next, {
        expectedVersion: u.expectedVersion,
        updatedBy: workspace.userId,
      });
      updated.push(saved);
    }
  });
  const n = updated.length;
  await recordActivity(workspace, {
    action: 'competitors.handicaps_updated',
    seriesId,
    summary: `Updated handicaps for ${n} competitor${n === 1 ? '' : 's'}`,
  });
  return { updated };
}

/**
 * Collection delete: DELETE /api/v1/series/:id/competitors — drop every
 * competitor in the series in one round-trip. The repo method is
 * workspace-scoped, so `assertSeriesInWorkspace` is the tenancy check.
 */
export async function bulkDeleteCompetitors(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<void> {
  await assertSeriesWritable(workspace, seriesId);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  await repos.competitors.deleteBySeries(seriesId);
  await recordActivity(workspace, {
    action: 'competitors.cleared',
    seriesId,
    summary: 'Cleared all competitors',
  });
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

/** Flat delete: DELETE /api/v1/competitors/:id. Cross-workspace ids are no-ops. */
export async function deleteCompetitorFlat(
  workspace: WorkspaceContext,
  id: string,
): Promise<void> {
  await assertCompetitorWritable(workspace, id);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  await repos.competitors.delete(id);
}

/**
 * "Who last edited this" stamp for the competitor edit dialog (#153). Reads the
 * row's server-managed `updated_at` / `updated_by` and resolves the actor's
 * display name — the passive companion to the conflict dialog's actor line,
 * which only appears on a 409. Its own endpoint so it doesn't bloat the
 * Competitor DTO (and its file/CSV/JSON round-trips).
 */
export async function getCompetitorAudit(
  workspace: WorkspaceContext,
  id: string,
): Promise<AuditStamp> {
  const db = getDb();
  const [row] = await db
    .select({
      updatedAt: schema.competitors.updatedAt,
      updatedBy: schema.competitors.updatedBy,
    })
    .from(schema.competitors)
    .where(
      and(
        eq(schema.competitors.id, id),
        eq(schema.competitors.workspaceId, workspace.workspaceId),
      ),
    )
    .limit(1);
  if (!row) throw new NotFoundError('competitor');

  let actor: AuditStamp['actor'] = null;
  if (row.updatedBy) {
    const [u] = await db
      .select({ id: schema.user.id, email: schema.user.email, name: schema.user.name })
      .from(schema.user)
      .where(eq(schema.user.id, row.updatedBy))
      .limit(1);
    actor = u
      ? {
          id: u.id,
          email: u.email,
          displayName: u.name && u.name.trim().length > 0 ? u.name : undefined,
        }
      : { id: row.updatedBy };
  }

  return { updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null, actor };
}
