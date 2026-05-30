import type { NextRequest } from 'next/server';

import { readPublishedHtml } from '@/lib/blob-storage';
import { contentHash, humanizeSlug } from '@/lib/publishing';
import {
  renderSeriesIndexHtml,
  renderWorkspaceIndexHtml,
  type SeriesIndexGroup,
} from '@/lib/published-index';
import {
  getPublishedGroupByWorkspaceSlug,
  getSeriesName,
  getWorkspaceBySlug,
  listPublishedByWorkspace,
} from '@/lib/published-repository';

export const dynamic = 'force-dynamic';

const NOT_FOUND = new Response('Not found', {
  status: 404,
  headers: { 'content-type': 'text/plain; charset=utf-8' },
});

// Always-fresh: cache, but revalidate every request against the ETag. A
// re-publish changes the ETag (the publication's content hash), so a reload
// shows the new results immediately rather than a stale cached copy (#162).
const CACHE_CONTROL = 'public, no-cache';

/** 304 when the caller's `If-None-Match` already has this version, else null.
 *  Checked before rendering/reading so an unchanged page costs nothing. */
function notModified(req: NextRequest, etag: string): Response | null {
  if (req.headers.get('if-none-match') !== etag) return null;
  return new Response(null, {
    status: 304,
    headers: { etag, 'cache-control': CACHE_CONTROL },
  });
}

function htmlResponse(html: string, etag: string): Response {
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': CACHE_CONTROL,
      etag,
    },
  });
}

/**
 * Public, unauthenticated results pages and listings (ADR-008 Phase 9/10, the
 * bilge replacement — #153, #162). Path shapes:
 *
 *   /p/{ws}                     → workspace index: every published series (rendered live)
 *   /p/{ws}/{series}            → series index: that publication's fleet pages (rendered live)
 *   /p/{ws}/{series}/{subPath}  → a fleet's standings HTML (`standings` or `kebab(fleet)`)
 *
 * The read path is a thin always-fresh function rather than a static blob
 * rewrite: re-publish freshness matters more than shaving the function/DB hit
 * (see #162 / the project decision note). Fleet HTML is read from storage by
 * the locator in the publication's DB row; each re-publish writes a fresh
 * content-addressed blob (see `publishedBlobKey`), so the row always points at
 * the current object — no overwrite-propagation lag. The two listings are
 * rendered on the fly, so there is no index blob to regenerate on publish.
 * `proxy.ts` excludes `/p/` from the login gate.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> },
): Promise<Response> {
  const { slug: segments } = await params;
  if (segments.length < 1 || segments.length > 3) return NOT_FOUND;

  if (segments.length === 1) return workspaceIndex(req, segments[0]);
  if (segments.length === 2) return seriesIndex(req, segments[0], segments[1]);
  return fleetPage(req, segments[0], segments[1], segments[2]);
}

/** `/p/{ws}` — the public workspace listing. */
async function workspaceIndex(
  req: NextRequest,
  workspaceSlug: string,
): Promise<Response> {
  const workspace = await getWorkspaceBySlug(workspaceSlug);
  if (!workspace) return NOT_FOUND;

  const items = await listPublishedByWorkspace(workspace.id);
  // Don't reveal that a workspace exists if it has published nothing.
  if (items.length === 0) return NOT_FOUND;

  // ETag from listing metadata so repeat views revalidate without re-rendering.
  const etag = `"${await contentHash(
    items.map((i) => `${i.slug}:${i.publishedAt}:${i.fleetCount}:${i.title}`),
  )}"`;
  const cached = notModified(req, etag);
  if (cached) return cached;
  const html = renderWorkspaceIndexHtml(workspaceSlug, workspace.name, items);
  return htmlResponse(html, etag);
}

/** `/p/{ws}/{series}` — the fleet listing for a slug. A slug is a shared
 *  namespace, so this unions the fleet pages of every series publishing into it
 *  (sub-headed per series when there's more than one). */
async function seriesIndex(
  req: NextRequest,
  workspaceSlug: string,
  seriesSlug: string,
): Promise<Response> {
  const workspace = await getWorkspaceBySlug(workspaceSlug);
  if (!workspace) return NOT_FOUND;

  const group = await getPublishedGroupByWorkspaceSlug(workspace.id, seriesSlug);
  if (group.length === 0) return NOT_FOUND;

  // The listing changes only when a contributor re-publishes, so the members'
  // content hashes compose a sound ETag.
  const etag = `"${await contentHash(group.map((p) => p.contentHash))}"`;
  const cached = notModified(req, etag);
  if (cached) return cached;

  const groups: SeriesIndexGroup[] = await Promise.all(
    group.map(async (p) => ({
      seriesName:
        (p.seriesId ? await getSeriesName(p.seriesId) : null) ?? seriesSlug,
      pages: p.pages.map((pg) => ({
        fleetName: pg.fleetName,
        subPath: pg.subPath,
      })),
    })),
  );
  const title =
    groups.length === 1 ? groups[0].seriesName : humanizeSlug(seriesSlug);
  const html = renderSeriesIndexHtml(
    workspaceSlug,
    workspace.name,
    seriesSlug,
    title,
    groups,
  );
  return htmlResponse(html, etag);
}

/** `/p/{ws}/{series}/{subPath}` — a single fleet's results HTML. The fleet may
 *  belong to any series publishing into the slug; we read the owning
 *  publication's blob. */
async function fleetPage(
  req: NextRequest,
  workspaceSlug: string,
  seriesSlug: string,
  subPath: string,
): Promise<Response> {
  const workspace = await getWorkspaceBySlug(workspaceSlug);
  if (!workspace) return NOT_FOUND;

  const group = await getPublishedGroupByWorkspaceSlug(workspace.id, seriesSlug);
  const owner = group.find((p) => p.pages.some((pg) => pg.subPath === subPath));
  const page = owner?.pages.find((pg) => pg.subPath === subPath);
  if (!owner || !page) return NOT_FOUND;

  const etag = `"${owner.contentHash}"`;
  const cached = notModified(req, etag);
  if (cached) return cached;

  const html = await readPublishedHtml(page.blobUrl);
  if (html === null) return NOT_FOUND;
  return htmlResponse(html, etag);
}
