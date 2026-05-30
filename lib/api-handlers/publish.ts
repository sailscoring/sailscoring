import 'server-only';

import { BadRequestError, NotFoundError } from '@/app/api/v1/_lib/handler';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { deletePublishedHtml, putPublishedHtml } from '@/lib/blob-storage';
import { createRepos } from '@/lib/postgres-repository';
import {
  contentHash,
  deriveSeriesSlug,
  publicationSubPath,
  publishedBlobKey,
} from '@/lib/publishing';
import {
  deletePublished,
  getPublishedById,
  getPublishedBySeries,
  getPublishedGroupByWorkspaceSlug,
  getSeriesName,
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

/** Display names of the other publications sharing a slug, for the
 *  `slug-shared` confirmation. An orphan (its series deleted) has no live name,
 *  so it reads as a leftover snapshot. */
async function contributorNames(others: PublishedSeries[]): Promise<string[]> {
  const names: string[] = [];
  for (const p of others) {
    const name = p.seriesId ? await getSeriesName(p.seriesId) : null;
    names.push(name ?? '(deleted series)');
  }
  return names;
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
 * A slug is a *shared namespace*: several series can publish into the same
 * `(workspace, slug)` and the public read path unions their fleet pages (e.g.
 * "Lambay Races Cruisers" + "Lambay Races One Designs" → `/p/{ws}/2026-lambay-races`).
 *
 * - **First publish:** the slug is `deriveSeriesSlug(name)` unless the caller
 *   supplied one. If other series (or an orphaned snapshot) already publish at
 *   that slug, the caller must confirm with `join: true`; otherwise it's
 *   rejected with `slug-shared` (carrying the existing contributor names).
 * - **Re-publish:** the slug is frozen — any supplied slug is ignored. Unchanged
 *   content (same hash) is a no-op.
 *
 * Either way, each contributor's fleet sub-paths must stay unique within the
 * slug (so every fleet URL resolves to one publication); a clash is rejected
 * with `subpath-collision` naming the offending fleet.
 */
export async function publishSeries(
  workspace: WorkspaceContext,
  seriesId: string,
  input: PublishInput,
): Promise<PublishResult> {
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const series = await repos.series.get(seriesId);
  if (!series) throw new NotFoundError('series');

  const existing = await getPublishedBySeries(seriesId);

  // Resolve the slug up front — it depends only on the series name, the existing
  // publication, and the requested slug, not on the rendered HTML. Doing it
  // before the build lets each fleet page carry a `← {series}` breadcrumb up to
  // its series index `/p/{ws}/{slug}` (the slug is frozen, so the link is stable
  // across re-publishes and doesn't perturb the content hash).
  let id: string;
  let slug: string;
  if (existing) {
    // Re-publish: slug is frozen.
    id = existing.id;
    slug = existing.slug;
  } else {
    // First publish: derive or accept a slug.
    const requested = input.slug?.trim();
    slug = requested ? requested : deriveSeriesSlug(series.name);
    if (!isValidSeriesSlug(slug)) {
      throw new BadRequestError('invalid slug', { code: 'invalid-slug' });
    }
    id = crypto.randomUUID();
  }

  const files = await buildFleetHtmlFiles(
    exportReposFor(workspace.workspaceId),
    seriesId,
    `${appBase()}/p/${workspace.workspaceSlug}/${slug}`,
  );
  if (!files) throw new NotFoundError('series has no publishable results');

  const hash = await contentHash(files.map((f) => f.html));

  // Blobs the previous publication held; deleted after the row points at the new
  // (content-addressed) objects. Empty on a clean first publish.
  let supersededPages: PublishedSeriesPage[] = [];
  if (existing) {
    if (existing.contentHash === hash) return toResult(workspace.workspaceSlug, existing);
    supersededPages = existing.pages;
  }

  // Other publications sharing this slug (the slug is a shared namespace), with
  // this series' own row excluded. Drives the join confirmation and the
  // sub-path collision guard — both apply to first publish and re-publish.
  const others = (
    await getPublishedGroupByWorkspaceSlug(workspace.workspaceId, slug)
  ).filter((p) => p.seriesId !== seriesId);

  // First publish into an occupied slug needs explicit confirmation, so two
  // unrelated events never merge by accident.
  if (!existing && others.length > 0 && !input.join) {
    throw new BadRequestError('slug already in use by other series', {
      code: 'slug-shared',
      sharedWith: await contributorNames(others),
    });
  }

  // Sub-paths are frozen per page: a fleet that was already published keeps its
  // existing path, so a publication's URLs never shift when another series later
  // joins (or leaves) the slug. Only genuinely new fleets get a fresh path.
  const frozen = new Map(
    (existing?.pages ?? []).map((p) => [p.fleetName, p.subPath]),
  );
  const shared = others.length > 0;
  const seriesSlug = deriveSeriesSlug(series.name);
  const subPathFor = (file: { fleetName: string; isDefault: boolean }): string =>
    frozen.get(file.fleetName) ??
    publicationSubPath(file.fleetName, file.isDefault, seriesSlug, shared);

  // Every fleet URL must resolve to exactly one publication, so this series'
  // sub-paths can't collide with another contributor's at the same slug.
  const taken = new Set(others.flatMap((p) => p.pages.map((pg) => pg.subPath)));
  for (const file of files) {
    if (taken.has(subPathFor(file))) {
      throw new BadRequestError('fleet URL collides with another series', {
        code: 'subpath-collision',
        fleetName: file.fleetName,
      });
    }
  }

  const pages: PublishedSeriesPage[] = [];
  for (const file of files) {
    const subPath = subPathFor(file);
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
