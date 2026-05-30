import 'server-only';

import { BadRequestError, NotFoundError } from '@/app/api/v1/_lib/handler';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { deletePublishedHtml, putPublishedHtml } from '@/lib/blob-storage';
import { createRepos } from '@/lib/postgres-repository';
import {
  contentHash,
  deriveSeriesSlug,
  fleetSubPath,
  publishedBlobKey,
} from '@/lib/publishing';
import {
  deletePublished,
  getPublishedById,
  getPublishedBySeries,
  getPublishedByWorkspaceSlug,
  listPublishedForWorkspace,
  savePublished,
} from '@/lib/published-repository';
import { buildFleetHtmlFiles } from '@/lib/results-export';
import type { ExportRepos } from '@/lib/public-export';
import type {
  PublicationStatus,
  PublishResult,
  PublishedListItem,
  PublishedSeries,
  PublishedSeriesPage,
} from '@/lib/types';
import type { PublishInput } from '@/lib/validation/publish';

const MAX_SLUG_LENGTH = 60;

function isValidSeriesSlug(slug: string): boolean {
  return slug.length <= MAX_SLUG_LENGTH && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

function appBase(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');
}

function toResult(
  workspaceSlug: string,
  published: PublishedSeries,
): PublishResult {
  const base = `${appBase()}/p/${workspaceSlug}/${published.slug}`;
  return {
    slug: published.slug,
    publishedAt: published.publishedAt,
    publishedVersion: published.publishedVersion,
    pages: published.pages.map((p) => ({
      fleetName: p.fleetName,
      url: `${base}/${p.subPath}`,
    })),
  };
}

function exportReposFor(workspaceId: string): ExportRepos {
  const repos = createRepos({ workspaceId });
  return {
    seriesRepo: repos.series,
    competitorRepo: repos.competitors,
    raceRepo: repos.races,
    fleetRepo: repos.fleets,
    finishRepo: repos.finishes,
    raceStartRepo: repos.raceStarts,
  };
}

/**
 * Publish a series' current results (ADR-008 Phase 9/10). Renders each fleet to
 * static HTML, stores it under `/p/{workspaceSlug}/{slug}/{subPath}`, and
 * records it in `published_series`. Explicit, point-in-time: re-publishing
 * overwrites; editing the series afterwards does not.
 *
 * - **First publish:** the slug is `deriveSeriesSlug(name)` unless the caller
 *   supplied one. A slug already held by a *live* series is rejected; one held
 *   by an *orphaned* publication (its series was deleted) requires
 *   `overwrite: true`, then takes over that row.
 * - **Re-publish:** the slug is frozen — any supplied slug is ignored. Unchanged
 *   content (same hash) is a no-op.
 */
export async function publishSeries(
  workspace: WorkspaceContext,
  seriesId: string,
  input: PublishInput,
): Promise<PublishResult> {
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const series = await repos.series.get(seriesId);
  if (!series) throw new NotFoundError('series');

  const files = await buildFleetHtmlFiles(
    exportReposFor(workspace.workspaceId),
    seriesId,
  );
  if (!files) throw new NotFoundError('series has no publishable results');

  const hash = await contentHash(files.map((f) => f.html));
  const existing = await getPublishedBySeries(seriesId);

  let id: string;
  let slug: string;
  // Blobs the previous publication held; deleted after the row points at the new
  // (content-addressed) objects. Empty on a clean first publish.
  let supersededPages: PublishedSeriesPage[] = [];

  if (existing) {
    // Re-publish: slug is frozen.
    id = existing.id;
    slug = existing.slug;
    if (existing.contentHash === hash) return toResult(workspace.workspaceSlug, existing);
    supersededPages = existing.pages;
  } else {
    // First publish: derive or accept a slug, resolving collisions.
    const requested = input.slug?.trim();
    slug = requested ? requested : deriveSeriesSlug(series.name);
    if (!isValidSeriesSlug(slug)) {
      throw new BadRequestError('invalid slug', { code: 'invalid-slug' });
    }
    const holder = await getPublishedByWorkspaceSlug(workspace.workspaceId, slug);
    if (holder && holder.seriesId !== null) {
      throw new BadRequestError('slug already in use', { code: 'slug-in-use' });
    }
    if (holder && !input.overwrite) {
      // Orphaned publication holds this slug — require explicit overwrite.
      throw new BadRequestError('slug held by an orphaned publication', {
        code: 'slug-orphaned',
      });
    }
    if (holder) {
      // Taking over an orphan's row — its blobs are superseded too.
      id = holder.id;
      supersededPages = holder.pages;
    } else {
      id = crypto.randomUUID();
    }
  }

  const pages: PublishedSeriesPage[] = [];
  for (const file of files) {
    const subPath = fleetSubPath(file.fleetName, file.isDefault);
    const key = publishedBlobKey(workspace.workspaceSlug, slug, subPath, hash);
    const blobUrl = await putPublishedHtml(key, file.html);
    pages.push({ fleetName: file.fleetName, subPath, blobUrl });
  }

  const published: PublishedSeries = {
    id,
    workspaceId: workspace.workspaceId,
    seriesId,
    slug,
    pages,
    contentHash: hash,
    publishedAt: Date.now(),
    publishedVersion: series.version ?? 1,
  };
  await savePublished(published);

  // Now that the row resolves to the fresh blobs, drop the superseded ones.
  // Content-addressed keys differ by hash, so none of these are still in use.
  // Best-effort: a failed delete leaks a blob but never serves stale results.
  for (const page of supersededPages) {
    await deletePublishedHtml(page.blobUrl);
  }

  return toResult(workspace.workspaceSlug, published);
}

/**
 * The publish dialog's view of a series on open: the workspace slug (for the
 * URL preview), the default slug for first publish, and the current publication
 * if any. Workspace-scoped — a series the caller can't see is a 404.
 */
export async function getPublication(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<PublicationStatus> {
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const series = await repos.series.get(seriesId);
  if (!series) throw new NotFoundError('series');
  const existing = await getPublishedBySeries(seriesId);
  return {
    workspaceSlug: workspace.workspaceSlug,
    suggestedSlug: deriveSeriesSlug(series.name),
    published: existing ? toResult(workspace.workspaceSlug, existing) : null,
  };
}

/**
 * Every publication in the workspace for the management page (#164), newest
 * first, each with its public series-index URL. Includes orphans — snapshots
 * whose series was deleted — which this page is the only place to manage.
 */
export async function listPublished(
  workspace: WorkspaceContext,
): Promise<PublishedListItem[]> {
  const rows = await listPublishedForWorkspace(workspace.workspaceId);
  return rows.map((r) => ({
    ...r,
    url: `${appBase()}/p/${workspace.workspaceSlug}/${r.slug}`,
  }));
}

/**
 * Take a publication down: delete its stored HTML blobs, then drop the row. The
 * public page 404s and the `(workspace, slug)` frees for reuse. The two listing
 * pages (#162) are rendered live from `published_series`, so there is no index
 * blob to regenerate here.
 */
async function unpublish(published: PublishedSeries): Promise<void> {
  for (const page of published.pages) {
    await deletePublishedHtml(page.blobUrl);
  }
  await deletePublished(published.id);
}

/** Unpublish by publication id — the management page's canonical path, the only
 *  one that can reach an orphan. Scoped to the caller's workspace. */
export async function unpublishById(
  workspace: WorkspaceContext,
  id: string,
): Promise<void> {
  const published = await getPublishedById(id);
  if (!published || published.workspaceId !== workspace.workspaceId) {
    throw new NotFoundError('publication');
  }
  await unpublish(published);
}

/** Unpublish a live series' publication — the publish dialog's convenience
 *  path. A series with no publication is a no-op (already unpublished). */
export async function unpublishBySeries(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<void> {
  const published = await getPublishedBySeries(seriesId);
  if (!published) return;
  if (published.workspaceId !== workspace.workspaceId) {
    throw new NotFoundError('publication');
  }
  await unpublish(published);
}
