import 'server-only';

import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';

import { BadRequestError, NotFoundError } from '@/app/api/v1/_lib/handler';
import { ForbiddenError } from '@/lib/auth/require-workspace';
import { recordActivity } from '@/lib/activity-log';
import {
  archiveDocHash,
  parseArchiveSeriesDoc,
  toStoredResults,
  type ArchiveSeriesDoc,
} from '@/lib/archive-kit/format';
import {
  collectNationalityCodes,
  renderAsPublishedFleetHtml,
} from '@/lib/archive-kit/render';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { deletePublishedHtml, putPublishedHtml } from '@/lib/blob-storage';
import {
  parseManifest,
  planManifestApply,
} from '@/lib/competitor-identity-manifest';
import {
  applyClusters,
  applyManifest,
  collectClusterInputs,
  collectCompetitorIndex,
  ensureSlugs,
  gcOrphanIdentities,
} from '@/lib/competitor-identity-reconcile';
import { clusterCompetitors } from '@/lib/competitor-identity-cluster';
import { mapWithConcurrency } from '@/lib/concurrency';
import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import {
  getPublishedBySeries,
  getPublishedGroupByWorkspaceSlug,
  savePublished,
} from '@/lib/published-repository';
import { contentHash, publishedBlobKey } from '@/lib/publishing';
import type { PublishedSeries, PublishedSeriesPage } from '@/lib/types';

/**
 * The archive ingest surface (ADR-010, #283): the door through which
 * as-published series enter a workspace. Every endpoint requires the
 * `archive-ingest` permission (the `archivist` CI credential's capability) —
 * enforced by the routes — and touches nothing but the as-published regime:
 * a full-fidelity series is never written here except through the explicit
 * `convert` flag, the migration path.
 *
 * Idempotent by design: the document's content hash is stored on the series
 * row, an unchanged re-PUT is a no-op, and every id in the document is minted
 * deterministically by the generator, so updates land in place.
 */

const PUBLISH_BLOB_CONCURRENCY = 16;

export interface ArchiveIngestResult {
  seriesId: string;
  unchanged: boolean;
  published: {
    slug: string;
    pages: Array<{ fleetName: string; subPath: string }>;
  } | null;
}

/** The series row as the ingest needs it, unscoped by workspace so an id
 *  squatting in another workspace is a hard error, never a silent insert. */
async function getSeriesRowById(id: string) {
  const [row] = await getDb()
    .select({
      id: schema.series.id,
      workspaceId: schema.series.workspaceId,
      asPublished: schema.series.asPublished,
      asPublishedHash: schema.series.asPublishedHash,
    })
    .from(schema.series)
    .where(eq(schema.series.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * Upsert one as-published series from its ingest document. `convert: true`
 * allows taking over an existing full-fidelity series with the same id — the
 * migration path for corpora imported before ADR-010 — deleting its races
 * and finishes; without it, a full-fidelity collision is a 409.
 */
export async function putArchiveSeries(
  workspace: WorkspaceContext,
  seriesId: string,
  body: unknown,
  opts: { convert?: boolean; force?: boolean } = {},
): Promise<ArchiveIngestResult> {
  const doc = parseArchiveSeriesDoc(body);
  if (doc.series.id !== seriesId) {
    throw new BadRequestError('document series id does not match the path');
  }
  const hash = await archiveDocHash(doc);

  const existing = await getSeriesRowById(seriesId);
  if (existing && existing.workspaceId !== workspace.workspaceId) {
    throw new ForbiddenError('series-id-in-use');
  }
  if (existing && !existing.asPublished && !opts.convert) {
    throw new BadRequestError(
      'a full-fidelity series already has this id; pass convert to replace it with its as-published archive',
      { code: 'full-fidelity-series-exists' },
    );
  }
  if (
    existing?.asPublished &&
    existing.asPublishedHash === hash &&
    !opts.force
  ) {
    return { seriesId, unchanged: true, published: null };
  }

  const db = getDb();
  await db.transaction(async (tx) => {
    // Initial category filing: a *new* series lands in the category the
    // document names (created here if the workspace doesn't have it yet).
    // First ingest only — category is workspace-local organisation, so
    // re-ingests never move a series a scorer has refiled.
    let categoryId: string | null = null;
    if (!existing && doc.series.category) {
      const [category] = await tx
        .select({ id: schema.categories.id })
        .from(schema.categories)
        .where(
          and(
            eq(schema.categories.workspaceId, workspace.workspaceId),
            eq(schema.categories.name, doc.series.category),
          ),
        )
        .limit(1);
      if (category) {
        categoryId = category.id;
      } else {
        categoryId = crypto.randomUUID();
        await tx.insert(schema.categories).values({
          id: categoryId,
          workspaceId: workspace.workspaceId,
          name: doc.series.category,
          displayOrder: sql<number>`(select coalesce(max(${schema.categories.displayOrder}) + 1, 0) from ${schema.categories} where ${schema.categories.workspaceId} = ${workspace.workspaceId})`,
        });
      }
    }

    // Series row. A *new* as-published series lands archived — it's history,
    // so it belongs collapsed under the year groups, not in the scorer's
    // active list. Updates leave the workspace-local organisation (category,
    // archived, display order) alone, so un-archiving one to feature it
    // survives re-ingests.
    await tx
      .insert(schema.series)
      .values({
        id: seriesId,
        workspaceId: workspace.workspaceId,
        archived: true,
        categoryId,
        name: doc.series.name,
        venue: doc.series.venue ?? '',
        startDate: doc.series.startDate ?? '',
        endDate: doc.series.endDate ?? '',
        eventUrl: doc.series.eventUrl ?? '',
        venueUrl: doc.series.venueUrl ?? '',
        venueLogoUrl: doc.series.venueLogoUrl ?? '',
        eventLogoUrl: doc.series.eventLogoUrl ?? '',
        source: (doc.series.source ?? null) as never,
        asPublished: true,
        asPublishedHash: hash,
        updatedBy: workspace.userId,
        displayOrder: sql<number>`(select coalesce(max(${schema.series.displayOrder}) + 1, 0) from ${schema.series} where ${schema.series.workspaceId} = ${workspace.workspaceId})`,
      })
      .onConflictDoUpdate({
        target: schema.series.id,
        set: {
          name: doc.series.name,
          venue: doc.series.venue ?? '',
          startDate: doc.series.startDate ?? '',
          endDate: doc.series.endDate ?? '',
          eventUrl: doc.series.eventUrl ?? '',
          venueUrl: doc.series.venueUrl ?? '',
          venueLogoUrl: doc.series.venueLogoUrl ?? '',
          eventLogoUrl: doc.series.eventLogoUrl ?? '',
          source: (doc.series.source ?? null) as never,
          asPublished: true,
          asPublishedHash: hash,
          lastModifiedAt: new Date(),
          updatedAt: new Date(),
          updatedBy: workspace.userId,
          version: sql`${schema.series.version} + 1`,
        },
      });

    // Converting a full-fidelity series: its scored data gives way to the
    // stored tables. Races cascade finishes, starts, and rating overrides.
    await tx
      .delete(schema.races)
      .where(eq(schema.races.seriesId, seriesId));
    // Sub-series configuration likewise belongs to the re-scoreable regime.
    await tx
      .delete(schema.subSeries)
      .where(eq(schema.subSeries.seriesId, seriesId));

    // Fleets: upsert by deterministic id in document order; drop the rest.
    const fleetIds = doc.fleets.map((f) => f.id);
    for (const [i, fleet] of doc.fleets.entries()) {
      await tx
        .insert(schema.fleets)
        .values({
          id: fleet.id,
          seriesId,
          workspaceId: workspace.workspaceId,
          name: fleet.name,
          displayOrder: i,
          scoringSystem: 'scratch',
          updatedBy: workspace.userId,
        })
        .onConflictDoUpdate({
          target: schema.fleets.id,
          set: {
            name: fleet.name,
            displayOrder: i,
            updatedAt: new Date(),
            updatedBy: workspace.userId,
            version: sql`${schema.fleets.version} + 1`,
          },
        });
    }
    await tx
      .delete(schema.fleets)
      .where(
        and(
          eq(schema.fleets.seriesId, seriesId),
          notInArray(schema.fleets.id, fleetIds),
        ),
      );

    // Competitors: upsert by deterministic id, preserving identity_id on
    // update (the spine survives a re-ingest); drop rows the document no
    // longer carries.
    const competitorIds = doc.competitors.map((c) => c.id);
    for (const c of doc.competitors) {
      const fields = {
        fleetIds: c.fleetIds,
        sailNumber: c.sailNumber,
        name: c.name,
        club: c.club ?? '',
        nationality: c.nationality ?? null,
        gender: c.gender ?? '',
        age: c.age ?? null,
        boatName: c.boatName ?? null,
        boatClass: c.boatClass ?? null,
        helm: c.helm ?? null,
        owner: c.owner ?? null,
        crewName: c.crewName ?? null,
      };
      await tx
        .insert(schema.competitors)
        .values({
          id: c.id,
          seriesId,
          workspaceId: workspace.workspaceId,
          ...fields,
          updatedBy: workspace.userId,
        })
        .onConflictDoUpdate({
          target: schema.competitors.id,
          set: {
            ...fields,
            updatedAt: new Date(),
            updatedBy: workspace.userId,
            version: sql`${schema.competitors.version} + 1`,
          },
        });
    }
    if (competitorIds.length > 0) {
      await tx
        .delete(schema.competitors)
        .where(
          and(
            eq(schema.competitors.seriesId, seriesId),
            notInArray(schema.competitors.id, competitorIds),
          ),
        );
    } else {
      await tx
        .delete(schema.competitors)
        .where(eq(schema.competitors.seriesId, seriesId));
    }

    // Stored results, one row per fleet.
    for (const fleet of doc.fleets) {
      await tx
        .insert(schema.asPublishedResults)
        .values({
          id: crypto.randomUUID(),
          workspaceId: workspace.workspaceId,
          seriesId,
          fleetId: fleet.id,
          results: toStoredResults(fleet),
          updatedBy: workspace.userId,
        })
        .onConflictDoUpdate({
          target: [
            schema.asPublishedResults.seriesId,
            schema.asPublishedResults.fleetId,
          ],
          set: {
            results: toStoredResults(fleet),
            updatedAt: new Date(),
            updatedBy: workspace.userId,
            version: sql`${schema.asPublishedResults.version} + 1`,
          },
        });
    }
  });

  const published = await publishArchiveSeries(workspace, doc);

  await recordActivity(workspace, {
    action: 'series.archive-ingested',
    seriesId,
    summary: `${existing ? 'Updated' : 'Ingested'} as-published archive “${doc.series.name}”`,
  });

  return { seriesId, unchanged: false, published };
}

/**
 * Publish (or re-publish) an as-published series' pages from its document —
 * pinned slug, pinned per-fleet sub-paths, whole publication replaced each
 * time. Runs after every applying ingest so the public pages exist without a
 * separate publish step.
 */
async function publishArchiveSeries(
  workspace: WorkspaceContext,
  doc: ArchiveSeriesDoc,
): Promise<{ slug: string; pages: Array<{ fleetName: string; subPath: string }> }> {
  const seriesId = doc.series.id;
  const slug = doc.series.publishedSlug;
  const seriesIndexUrl = `/p/${workspace.workspaceSlug}/${slug}`;
  const multiFleet = doc.fleets.length > 1;

  // Flag SVGs load on demand, only when a fleet references national codes —
  // the ~2.5 MB dataset stays out of every other request (the same pattern
  // as the full-fidelity export path).
  const anyNationality = doc.fleets.some(
    (fleet) => collectNationalityCodes(toStoredResults(fleet)).length > 0,
  );
  const flagSvgByCode = anyNationality
    ? (await import('@/lib/nationality/flags')).NATIONAL_FLAGS
    : undefined;

  const files = doc.fleets.map((fleet) => ({
    fleetName: fleet.name,
    subPath: fleet.subPath,
    html: renderAsPublishedFleetHtml(
      {
        seriesName: doc.series.name,
        venue: doc.series.venue,
        fleetName:
          multiFleet || fleet.name !== 'Default' ? fleet.name : undefined,
        leftLogoUrl: doc.series.venueLogoUrl,
        rightLogoUrl: doc.series.eventLogoUrl,
        leftUrl: doc.series.venueUrl,
        rightUrl: doc.series.eventUrl,
        seriesIndexUrl,
        flagSvgByCode,
      },
      toStoredResults(fleet),
    ),
  }));

  const hash = await contentHash(files.map((f) => f.html));
  const existing = await getPublishedBySeries(seriesId);

  // The pinned slug is data: if it moved in git, the publication moves with
  // it (the old slug's pages come down below via the superseded sweep).
  if (existing && existing.slug === slug && existing.contentHash === hash) {
    return {
      slug,
      pages: files.map((f) => ({ fleetName: f.fleetName, subPath: f.subPath })),
    };
  }

  // Sub-path collisions with other series publishing into the same slug (the
  // slug is a shared namespace — the IODAI events publish three series each
  // into one event slug).
  const others = (
    await getPublishedGroupByWorkspaceSlug(workspace.workspaceId, slug)
  ).filter((p) => p.seriesId !== seriesId);
  const taken = new Set(others.flatMap((p) => p.pages.map((pg) => pg.subPath)));
  for (const f of files) {
    if (taken.has(f.subPath)) {
      throw new BadRequestError('fleet URL collides with another publication', {
        code: 'subpath-collision',
        fleetName: f.fleetName,
      });
    }
  }

  const pages: PublishedSeriesPage[] = await mapWithConcurrency(
    files,
    PUBLISH_BLOB_CONCURRENCY,
    async (f) => ({
      fleetName: f.fleetName,
      subPath: f.subPath,
      blobUrl: await putPublishedHtml(
        publishedBlobKey(workspace.workspaceSlug, slug, f.subPath, hash),
        f.html,
      ),
    }),
  );

  const [versionRow] = await getDb()
    .select({ version: schema.series.version })
    .from(schema.series)
    .where(eq(schema.series.id, seriesId))
    .limit(1);

  const published: PublishedSeries = {
    id: existing?.id ?? crypto.randomUUID(),
    workspaceId: workspace.workspaceId,
    seriesId,
    slug,
    pages,
    contentHash: hash,
    publishedAt: Date.now(),
    publishedVersion: versionRow?.version ?? 1,
  };
  await savePublished(published);

  // Best-effort sweep of the previous publication's blobs.
  if (existing) {
    await mapWithConcurrency(existing.pages, PUBLISH_BLOB_CONCURRENCY, (p) =>
      deletePublishedHtml(p.blobUrl),
    );
  }

  return {
    slug,
    pages: files.map((f) => ({ fleetName: f.fleetName, subPath: f.subPath })),
  };
}

/** One fleet's stored tables plus its name, for the in-app Standings tab. */
export interface AsPublishedFleetView {
  fleetId: string;
  fleetName: string;
  results: import('@/lib/archive-kit/types').AsPublishedFleetResults;
}

/**
 * The stored as-published tables for a series, in fleet display order — the
 * in-app Standings tab's data. Read-level; 404 unless the series is in the
 * workspace and in the as-published regime.
 */
export async function getAsPublishedResults(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<{ fleets: AsPublishedFleetView[] }> {
  const existing = await getSeriesRowById(seriesId);
  if (
    !existing ||
    existing.workspaceId !== workspace.workspaceId ||
    !existing.asPublished
  ) {
    throw new NotFoundError('as-published series');
  }
  const rows = await getDb()
    .select({
      fleetId: schema.asPublishedResults.fleetId,
      fleetName: schema.fleets.name,
      displayOrder: schema.fleets.displayOrder,
      results: schema.asPublishedResults.results,
    })
    .from(schema.asPublishedResults)
    .innerJoin(
      schema.fleets,
      eq(schema.asPublishedResults.fleetId, schema.fleets.id),
    )
    .where(eq(schema.asPublishedResults.seriesId, seriesId));
  rows.sort((a, b) => a.displayOrder - b.displayOrder);
  return {
    fleets: rows.map((r) => ({
      fleetId: r.fleetId,
      fleetName: r.fleetName,
      results: r.results,
    })),
  };
}

/** Remove an as-published series: publication (blobs + row) and series row.
 *  The archive repo is the authority — this is how a series leaves it. A
 *  full-fidelity series is never deletable here. */
export async function deleteArchiveSeries(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<void> {
  const existing = await getSeriesRowById(seriesId);
  if (!existing || existing.workspaceId !== workspace.workspaceId) {
    throw new NotFoundError('series');
  }
  if (!existing.asPublished) {
    throw new BadRequestError('not an as-published series');
  }
  const published = await getPublishedBySeries(seriesId);
  if (published) {
    for (const page of published.pages) {
      await deletePublishedHtml(page.blobUrl);
    }
    await getDb()
      .delete(schema.publishedSeries)
      .where(eq(schema.publishedSeries.id, published.id));
  }
  const [row] = await getDb()
    .select({ name: schema.series.name })
    .from(schema.series)
    .where(eq(schema.series.id, seriesId))
    .limit(1);
  await getDb().delete(schema.series).where(eq(schema.series.id, seriesId));
  await recordActivity(workspace, {
    action: 'series.archive-removed',
    seriesId,
    summary: `Removed as-published archive “${row?.name ?? seriesId}”`,
  });
}

export interface ArchiveIdentitiesResult {
  manifest: {
    identitiesWritten: number;
    competitorsLinked: number;
    unresolvedMembers: number;
    duplicateSlugs: string[];
  };
  autoPass: {
    identitiesCreated: number;
    competitorsLinked: number;
    conflictsSkipped: number;
  };
  slugsBackfilled: number;
  /** Identities left with no rows (replaced-out drafts) and removed. */
  orphansRemoved: number;
}

/**
 * Apply the archive repo's identity manifest (#218 format) and then run the
 * clustering auto-pass over the rows the manifest didn't cover — restricted
 * to as-published series, so live rows stay the lazy pass's (and the
 * reconcile UI's) jurisdiction. Identities written here are archive-managed.
 * Idempotent: deterministic identity ids, only-fill-NULL linking.
 */
export async function applyArchiveIdentities(
  workspace: WorkspaceContext,
  body: unknown,
): Promise<ArchiveIdentitiesResult> {
  let manifest;
  try {
    manifest = parseManifest(JSON.stringify(body));
  } catch (err) {
    throw new BadRequestError(
      err instanceof Error ? err.message : 'invalid manifest',
    );
  }

  const db = getDb();
  // The manifest's series map must resolve inside this workspace — a slug
  // pointing at another workspace's series is a configuration error, and
  // applying it would write cross-tenant links.
  const mappedIds = [...new Set(Object.values(manifest.series))];
  if (mappedIds.length > 0) {
    const rows = await db
      .select({ id: schema.series.id })
      .from(schema.series)
      .where(
        and(
          inArray(schema.series.id, mappedIds),
          eq(schema.series.workspaceId, workspace.workspaceId),
        ),
      );
    const inWorkspace = new Set(rows.map((r) => r.id));
    const foreign = mappedIds.filter((id) => !inWorkspace.has(id));
    // Unknown ids are tolerated (an event not yet ingested resolves later);
    // an id that exists in ANOTHER workspace is not.
    if (foreign.length > 0) {
      const [clash] = await db
        .select({ id: schema.series.id })
        .from(schema.series)
        .where(inArray(schema.series.id, foreign))
        .limit(1);
      if (clash) throw new ForbiddenError('manifest-series-out-of-workspace');
    }
  }

  const { index } = await collectCompetitorIndex(db, workspace.workspaceId);
  const plan = planManifestApply(manifest, workspace.workspaceId, (sid, sail) =>
    index.get(`${sid}|${sail}`),
  );
  const applied = await applyManifest(db, workspace.workspaceId, plan);

  // Auto-pass over what the manifest didn't cover, scoped to archive rows.
  const archiveRows = await db
    .select({ id: schema.competitors.id })
    .from(schema.competitors)
    .innerJoin(schema.series, eq(schema.competitors.seriesId, schema.series.id))
    .where(
      and(
        eq(schema.competitors.workspaceId, workspace.workspaceId),
        eq(schema.series.asPublished, true),
      ),
    );
  const inputs = await collectClusterInputs(db, workspace.workspaceId);
  const result = clusterCompetitors(inputs);
  const autoPass = await applyClusters(db, workspace.workspaceId, result, {
    managedBy: 'archive',
    onlyCompetitorIds: new Set(archiveRows.map((r) => r.id)),
  });
  const slugsBackfilled = await ensureSlugs(db, workspace.workspaceId);
  // Manifest overwrites + row re-minting can leave drafted identities with
  // no rows; sweep them so no empty cards or dead timelines linger.
  const orphansRemoved = await gcOrphanIdentities(db, workspace.workspaceId);

  await recordActivity(workspace, {
    action: 'identities.archive-applied',
    summary: `Applied archive identities: ${applied.identitiesWritten} from the manifest, ${autoPass.identitiesCreated} drafted`,
  });

  return {
    manifest: {
      identitiesWritten: applied.identitiesWritten,
      competitorsLinked: applied.competitorsLinked,
      unresolvedMembers: plan.unresolvedMembers.length,
      duplicateSlugs: plan.duplicateSlugs,
    },
    autoPass,
    slugsBackfilled,
    orphansRemoved,
  };
}
