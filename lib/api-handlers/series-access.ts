import 'server-only';
import { and, eq } from 'drizzle-orm';

import {
  ArchivedError,
  BadRequestError,
  NotFoundError,
} from '@/app/api/v1/_lib/handler';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';

/**
 * Read-only enforcement for archived series (#154).
 *
 * Archiving a series makes it — and all its children — read-only. Every
 * mutating `/api/v1` handler routes through one of these guards; reads are
 * untouched. Editing an archived series requires unarchiving it (its own
 * endpoint, which bypasses these guards) or copying it to another workspace.
 *
 * Server-side enforcement is the source of truth; the UI's disabling of edit
 * controls is cosmetic on top (defence-in-depth — the repository/handler
 * layer is the real boundary, per the CVE-2025-29927 posture this codebase
 * already takes for tenancy).
 *
 * The checks read a single `archived` flag via a join rather than going
 * through the shared `SeriesRepository` interface, deliberately: the guard is
 * server-only and shouldn't leak onto the interface the client repository
 * mirror has to implement.
 *
 * `Hard` guards (assertSeriesWritable / assertRaceWritable) double as the
 * tenancy + existence check used by nested routes: they throw NotFound for a
 * missing or out-of-workspace id. The flat-delete guards are `soft` — a
 * delete of a missing / out-of-workspace child stays an idempotent no-op, but
 * a delete of a child whose series is archived is rejected.
 */

/** `true`/`false` if the series exists in the workspace; `null` if it doesn't. */
async function seriesArchived(
  workspaceId: string,
  seriesId: string,
): Promise<boolean | null> {
  const [row] = await getDb()
    .select({ archived: schema.series.archived })
    .from(schema.series)
    .where(
      and(
        eq(schema.series.id, seriesId),
        eq(schema.series.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return row ? row.archived : null;
}

/** Same, resolving the series via one of its races. */
async function raceSeriesArchived(
  workspaceId: string,
  raceId: string,
): Promise<boolean | null> {
  const [row] = await getDb()
    .select({ archived: schema.series.archived })
    .from(schema.races)
    .innerJoin(schema.series, eq(schema.races.seriesId, schema.series.id))
    .where(
      and(
        eq(schema.races.id, raceId),
        eq(schema.races.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return row ? row.archived : null;
}

// ─── Hard guards (used by nested write routes; also the tenancy check) ───────

export async function assertSeriesWritable(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<void> {
  const archived = await seriesArchived(workspace.workspaceId, seriesId);
  if (archived === null) throw new NotFoundError('series');
  if (archived) throw new ArchivedError();
}

export async function assertRaceWritable(
  workspace: WorkspaceContext,
  raceId: string,
): Promise<void> {
  const archived = await raceSeriesArchived(workspace.workspaceId, raceId);
  if (archived === null) throw new NotFoundError('race');
  if (archived) throw new ArchivedError();
}

/**
 * Delete is the inverse: it requires the series to be archived first
 * (deliberate archive-then-delete friction, #154). 400 rather than 423 —
 * the request is well-formed, the state is wrong, and 400 won't collide with
 * any conflict/locked client handling. The UI never offers delete on an
 * active series; this is the server backstop.
 */
export async function assertSeriesDeletable(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<void> {
  const archived = await seriesArchived(workspace.workspaceId, seriesId);
  if (archived === null) throw new NotFoundError('series');
  if (!archived) {
    throw new BadRequestError('series must be archived before it can be deleted');
  }
}

// ─── Soft guards (flat deletes — no-op if the child isn't ours) ──────────────

export async function assertCompetitorWritable(
  workspace: WorkspaceContext,
  competitorId: string,
): Promise<void> {
  const [row] = await getDb()
    .select({ archived: schema.series.archived })
    .from(schema.competitors)
    .innerJoin(schema.series, eq(schema.competitors.seriesId, schema.series.id))
    .where(
      and(
        eq(schema.competitors.id, competitorId),
        eq(schema.competitors.workspaceId, workspace.workspaceId),
      ),
    )
    .limit(1);
  if (row?.archived) throw new ArchivedError();
}

export async function assertFleetWritable(
  workspace: WorkspaceContext,
  fleetId: string,
): Promise<void> {
  const [row] = await getDb()
    .select({ archived: schema.series.archived })
    .from(schema.fleets)
    .innerJoin(schema.series, eq(schema.fleets.seriesId, schema.series.id))
    .where(
      and(
        eq(schema.fleets.id, fleetId),
        eq(schema.fleets.workspaceId, workspace.workspaceId),
      ),
    )
    .limit(1);
  if (row?.archived) throw new ArchivedError();
}

/** Flat race delete — soft (no NotFound), unlike the hard `assertRaceWritable`. */
export async function assertRaceDeletable(
  workspace: WorkspaceContext,
  raceId: string,
): Promise<void> {
  if (await raceSeriesArchived(workspace.workspaceId, raceId)) {
    throw new ArchivedError();
  }
}

export async function assertFinishWritable(
  workspace: WorkspaceContext,
  finishId: string,
): Promise<void> {
  const [row] = await getDb()
    .select({ archived: schema.series.archived })
    .from(schema.finishes)
    .innerJoin(schema.races, eq(schema.finishes.raceId, schema.races.id))
    .innerJoin(schema.series, eq(schema.races.seriesId, schema.series.id))
    .where(
      and(
        eq(schema.finishes.id, finishId),
        eq(schema.races.workspaceId, workspace.workspaceId),
      ),
    )
    .limit(1);
  if (row?.archived) throw new ArchivedError();
}

export async function assertRaceStartWritable(
  workspace: WorkspaceContext,
  startId: string,
): Promise<void> {
  const [row] = await getDb()
    .select({ archived: schema.series.archived })
    .from(schema.raceStarts)
    .innerJoin(schema.races, eq(schema.raceStarts.raceId, schema.races.id))
    .innerJoin(schema.series, eq(schema.races.seriesId, schema.series.id))
    .where(
      and(
        eq(schema.raceStarts.id, startId),
        eq(schema.races.workspaceId, workspace.workspaceId),
      ),
    )
    .limit(1);
  if (row?.archived) throw new ArchivedError();
}
