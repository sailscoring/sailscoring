import 'server-only';
import { and, asc, eq } from 'drizzle-orm';

import { BadRequestError, NotFoundError } from '@/app/api/v1/_lib/handler';
import { listCompetitors } from '@/lib/api-handlers/competitors';
import { listFinishes } from '@/lib/api-handlers/finishes';
import { listFleets } from '@/lib/api-handlers/fleets';
import { publishSeries, unpublishBySeries } from '@/lib/api-handlers/publish';
import {
  applyStartCourse,
  deleteRaceStart,
  listRaceStarts,
  listSeriesRaceStarts,
  patchRaceStart,
} from '@/lib/api-handlers/race-starts';
import { deleteRace, generateRaces, getRace, getRaceFlat, listRaces, listRacesBetween } from '@/lib/api-handlers/races';
import { listSeasons } from '@/lib/api-handlers/seasons';
import { getSeries, listSeries } from '@/lib/api-handlers/series';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { getDb } from '@/lib/db/client';
import { member, organization } from '@/lib/db/schema/auth';
import { publishedSeries } from '@/lib/db/schema';
import { publicationApiBase } from '@/lib/public-api/store';
import {
  competitorResourceOf,
  finishesInOrder,
  finishResourceOf,
  fleetResourceOf,
  raceResourceOf,
  seriesResourceOf,
  startResourceOf,
  storedWallClock,
} from '@/lib/public-api/workspace-resources';
import type { Race, RaceStart } from '@/lib/types';
import type {
  createRacesInput,
  publishInput,
  PublicationResource,
  RaceResource,
  startPatchInput,
  StartResource,
} from '@/lib/validation/public-api-v1-authenticated';
import type { z } from 'zod';

/**
 * The public API's authenticated calls (ADR-016 §3): each maps its input to
 * the internal handler's, calls it, and maps the result to the public
 * resource. Tenancy, permissions, validation of the stored shapes and the
 * activity log are the internal handlers', unchanged.
 */

// ─── Reads ───────────────────────────────────────────────────────────────────

/** The workspaces the token reaches: an app's one, or all the CLI user's. */
export async function listWorkspacesPublic(workspace: WorkspaceContext) {
  const rows = await getDb()
    .select({ id: organization.id, slug: organization.slug, name: organization.name })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, workspace.userId))
    .orderBy(asc(organization.name));
  return { workspaces: workspace.via ? rows.filter((w) => w.id === workspace.workspaceId) : rows };
}

export async function listSeasonsPublic(workspace: WorkspaceContext) {
  const { items } = await listSeasons(workspace);
  return { seasons: items.map((s) => ({ label: s.label, current: s.current })) };
}

export async function listSeriesPublic(workspace: WorkspaceContext) {
  const { items } = await listSeries(workspace);
  return { series: items.map(seriesResourceOf) };
}

export async function getSeriesPublic(workspace: WorkspaceContext, seriesId: string) {
  return seriesResourceOf(await getSeries(workspace, seriesId));
}

export async function listFleetsPublic(workspace: WorkspaceContext, seriesId: string) {
  const fleets = await listFleets(workspace, seriesId);
  return { fleets: [...fleets].sort((a, b) => a.displayOrder - b.displayOrder).map(fleetResourceOf) };
}

export async function listCompetitorsPublic(workspace: WorkspaceContext, seriesId: string) {
  return { competitors: (await listCompetitors(workspace, seriesId)).map(competitorResourceOf) };
}

export async function listRacesPublic(workspace: WorkspaceContext, seriesId: string) {
  const [races, starts] = await Promise.all([
    listRaces(workspace, seriesId),
    listSeriesRaceStarts(workspace, seriesId),
  ]);
  return {
    races: [...races].sort((a, b) => a.raceNumber - b.raceNumber).map((r) => raceResourceOf(r, starts)),
  };
}

export async function getRacePublic(workspace: WorkspaceContext, seriesId: string, raceId: string) {
  const race = await getRace(workspace, seriesId, raceId);
  return raceResourceOf(race, await listRaceStarts(workspace, raceId));
}

/** The races on one date across the workspace's live series. */
export async function listRacesOnDatePublic(workspace: WorkspaceContext, date: string | null) {
  if (!date) throw new BadRequestError('Name the date: ?date=YYYY-MM-DD.');
  const dated = await listRacesBetween(workspace, date, date);
  return {
    races: dated.map((d) => ({
      ...raceResourceOf(d.race, d.starts),
      seriesId: d.race.seriesId,
      seriesName: d.seriesName,
    })),
  };
}

export async function listFinishesPublic(workspace: WorkspaceContext, raceId: string) {
  return { finishes: finishesInOrder(await listFinishes(workspace, raceId)).map(finishResourceOf) };
}

function appOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');
}

type PublicationRow = {
  id: string;
  seriesId: string | null;
  slug: string;
  publishedAt: Date | null;
  apiView: boolean;
};

function publicationResourceOf(workspace: WorkspaceContext, row: PublicationRow): PublicationResource {
  return {
    id: row.id,
    seriesId: row.seriesId,
    slug: row.slug,
    url: `${appOrigin()}/p/${workspace.workspaceSlug}/${row.slug}`,
    api: row.apiView ? publicationApiBase(row.id) : null,
    publishedAt: (row.publishedAt ?? new Date(0)).toISOString(),
  };
}

const publicationColumns = {
  id: publishedSeries.id,
  seriesId: publishedSeries.seriesId,
  slug: publishedSeries.slug,
  publishedAt: publishedSeries.publishedAt,
  apiView: publishedSeries.apiView,
};

export async function listPublicationsPublic(workspace: WorkspaceContext) {
  const rows = await getDb()
    .select(publicationColumns)
    .from(publishedSeries)
    .where(eq(publishedSeries.workspaceId, workspace.workspaceId))
    .orderBy(asc(publishedSeries.slug));
  return { publications: rows.map((r) => publicationResourceOf(workspace, r)) };
}

export async function getSeriesPublicationPublic(workspace: WorkspaceContext, seriesId: string) {
  await getSeries(workspace, seriesId);
  const [row] = await getDb()
    .select(publicationColumns)
    .from(publishedSeries)
    .where(and(eq(publishedSeries.workspaceId, workspace.workspaceId), eq(publishedSeries.seriesId, seriesId)))
    .limit(1);
  return { publication: row ? publicationResourceOf(workspace, row) : null };
}

// ─── Writes ──────────────────────────────────────────────────────────────────

/** Refuse fleet ids that aren't the series': the internal start writes take
 *  any id, trusting the app's own pickers. */
async function assertFleetsOfSeries(workspace: WorkspaceContext, seriesId: string, fleetIds: readonly string[]) {
  const known = new Set((await listFleets(workspace, seriesId)).map((f) => f.id));
  const unknown = fleetIds.find((f) => !known.has(f));
  if (unknown) throw new BadRequestError(`No fleet ${unknown} in this series.`);
}

/**
 * Add races after the series' last, each with its starts. The server owns
 * the numbering and the creation time, which the internal generator's body
 * carries; they're filled in here, so a client sends only what it knows.
 */
export async function createRacesPublic(
  workspace: WorkspaceContext,
  seriesId: string,
  input: z.infer<typeof createRacesInput>,
): Promise<{ races: RaceResource[] }> {
  const now = Date.now();
  const races: Race[] = [];
  const starts: RaceStart[] = [];
  input.races.forEach((r, i) => {
    const raceId = r.id ?? crypto.randomUUID();
    races.push({
      id: raceId,
      seriesId,
      // A hint only: the generator numbers them after the series' last race.
      raceNumber: i + 1,
      name: r.name ?? null,
      date: r.date,
      createdAt: now,
    });
    for (const s of r.starts) {
      starts.push({
        id: s.id ?? crypto.randomUUID(),
        raceId,
        fleetIds: s.fleetIds,
        ...(s.startTime ? { startTime: storedWallClock(s.startTime) } : {}),
      });
    }
  });
  await assertFleetsOfSeries(workspace, seriesId, starts.flatMap((s) => s.fleetIds));
  const created = await generateRaces(workspace, seriesId, { races, starts });
  return { races: created.map((r) => raceResourceOf(r, starts)) };
}

export async function deleteRacePublic(workspace: WorkspaceContext, seriesId: string, raceId: string) {
  await deleteRace(workspace, seriesId, raceId);
}

async function assertStartInRace(workspace: WorkspaceContext, raceId: string, startId: string) {
  const starts = await listRaceStarts(workspace, raceId);
  if (!starts.some((s) => s.id === startId)) throw new NotFoundError('start');
}

export async function patchStartPublic(
  workspace: WorkspaceContext,
  raceId: string,
  startId: string,
  input: z.infer<typeof startPatchInput>,
  expectedVersion?: number,
): Promise<StartResource> {
  const patch = {
    ...(input.startTime !== undefined
      ? { startTime: input.startTime === null ? null : storedWallClock(input.startTime) }
      : {}),
    ...(input.fleetIds !== undefined ? { fleetIds: input.fleetIds } : {}),
  };
  if (input.fleetIds) {
    const race = await getRaceFlat(workspace, raceId);
    if (!race) throw new NotFoundError('race');
    await assertFleetsOfSeries(workspace, race.seriesId, input.fleetIds);
  }
  return startResourceOf(await patchRaceStart(workspace, raceId, startId, patch, { expectedVersion }));
}

export async function deleteStartPublic(workspace: WorkspaceContext, raceId: string, startId: string) {
  await assertStartInRace(workspace, raceId, startId);
  await deleteRaceStart(workspace, raceId, startId);
}

export async function applyCoursePublic(
  workspace: WorkspaceContext,
  raceId: string,
  startId: string,
  document: string,
  opts: { replace: boolean; expectedVersion?: number },
): Promise<StartResource> {
  return startResourceOf(await applyStartCourse(workspace, raceId, startId, document, opts));
}

export async function publishPublic(
  workspace: WorkspaceContext,
  seriesId: string,
  input: z.infer<typeof publishInput>,
) {
  await publishSeries(workspace, seriesId, input);
  return getSeriesPublicationPublic(workspace, seriesId);
}

export async function unpublishPublic(workspace: WorkspaceContext, seriesId: string) {
  await getSeries(workspace, seriesId);
  await unpublishBySeries(workspace, seriesId);
}
