import 'server-only';

import { NotFoundError } from '@/app/api/v1/_lib/handler';
import { putPublishedHtml } from '@/lib/blob-storage';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { createRepos } from '@/lib/postgres-repository';
import { buildFleetHtmlFiles } from '@/lib/results-export';
import type { ExportRepos } from '@/lib/public-export';
import { contentHash, fleetSubPath, makePublishSlug } from '@/lib/publishing';
import {
  getPublishedBySeries,
  upsertPublished,
} from '@/lib/published-repository';
import type {
  PublishResult,
  PublishedSeries,
  PublishedSeriesPage,
} from '@/lib/types';

function toResult(published: PublishedSeries): PublishResult {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');
  const base = `${appUrl}/p/${published.slug}`;
  return {
    slug: published.slug,
    url: base,
    publishedAt: published.publishedAt,
    publishedVersion: published.publishedVersion,
    pages: published.pages.map((p) => ({
      fleetName: p.fleetName,
      url: p.subPath ? `${base}/${p.subPath}` : base,
    })),
  };
}

/**
 * Publish a series' current results to Vercel Blob and record it in
 * `published_series` (ADR-008 Phase 9). Explicit, point-in-time: it renders
 * the state as it stands now and overwrites the previous publication.
 *
 * - The slug is minted once on first publish and reused forever after.
 * - One public blob per fleet; the first fleet is served at the bare slug.
 * - When the rendered content is byte-identical to what's already published
 *   (same `contentHash`), the blobs are left untouched and the existing
 *   publication is returned — re-publishing an unchanged series is a no-op.
 */
export async function publishSeries(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<PublishResult> {
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const series = await repos.series.get(seriesId);
  if (!series) throw new NotFoundError('series');

  // `buildFleetHtmlFiles` needs the six read repos under the file-repo names.
  const exportRepos: ExportRepos = {
    seriesRepo: repos.series,
    competitorRepo: repos.competitors,
    raceRepo: repos.races,
    fleetRepo: repos.fleets,
    finishRepo: repos.finishes,
    raceStartRepo: repos.raceStarts,
  };

  const files = await buildFleetHtmlFiles(exportRepos, seriesId);
  if (!files) {
    // No competitors or no races — nothing to publish.
    throw new NotFoundError('series has no publishable results');
  }

  const hash = await contentHash(files.map((f) => f.html));
  const existing = await getPublishedBySeries(seriesId);
  const slug = existing?.slug ?? makePublishSlug(series.name);

  // Unchanged content: skip the blob writes, return the current publication.
  if (existing && existing.contentHash === hash) {
    return toResult(existing);
  }

  const pages: PublishedSeriesPage[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const subPath = fleetSubPath(file.fleetName, i === 0);
    const pathname = `published/${slug}/${subPath || 'standings'}.html`;
    const blobUrl = await putPublishedHtml(pathname, file.html);
    pages.push({ fleetName: file.fleetName, subPath, blobUrl });
  }

  const published: PublishedSeries = {
    seriesId,
    slug,
    pages,
    contentHash: hash,
    publishedAt: Date.now(),
    publishedVersion: series.version ?? 1,
  };
  await upsertPublished(workspace.workspaceId, published);
  return toResult(published);
}

/**
 * The current publication for a series, or null if it has never been
 * published. Workspace-scoped: a series the caller can't see is a 404. Drives
 * the publish dialog's "last published / edits since" view on open.
 */
export async function getPublication(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<PublishResult | null> {
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const series = await repos.series.get(seriesId);
  if (!series) throw new NotFoundError('series');
  const existing = await getPublishedBySeries(seriesId);
  return existing ? toResult(existing) : null;
}
