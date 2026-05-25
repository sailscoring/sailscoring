import type { NextRequest } from 'next/server';

import { readPublishedHtml } from '@/lib/blob-storage';
import {
  getPublishedByWorkspaceSlug,
  getWorkspaceIdBySlug,
} from '@/lib/published-repository';

export const dynamic = 'force-dynamic';

const NOT_FOUND = new Response('Not found', {
  status: 404,
  headers: { 'content-type': 'text/plain; charset=utf-8' },
});

/**
 * Public, unauthenticated results pages (ADR-008 Phase 9/10, the bilge
 * replacement — #153). Path shape:
 *
 *   /p/{ws}                     → workspace index — reserved for the listing (#162); 404 for now
 *   /p/{ws}/{series}            → series index    — reserved for the listing (#162); 404 for now
 *   /p/{ws}/{series}/{subPath}  → a fleet's standings (`standings` or `kebab(fleet)`)
 *
 * The HTML is read back from storage and served with `Cache-Control` + an
 * `ETag` (the publication's content hash). In production the static read path
 * (#162) will rewrite `/p/*` straight to blob and shadow this handler; until
 * then (and in local dev) this function serves it. `proxy.ts` excludes `/p/`
 * from the login gate.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> },
): Promise<Response> {
  const { slug: segments } = await params;
  // Only the three-segment fleet-page form is served today. One/two segments
  // are the (not-yet-built) workspace/series listings; longer paths are noise.
  if (segments.length !== 3) return NOT_FOUND;
  const [workspaceSlug, seriesSlug, subPath] = segments;

  const workspaceId = await getWorkspaceIdBySlug(workspaceSlug);
  if (!workspaceId) return NOT_FOUND;

  const published = await getPublishedByWorkspaceSlug(workspaceId, seriesSlug);
  const page = published?.pages.find((p) => p.subPath === subPath);
  if (!published || !page) return NOT_FOUND;

  const etag = `"${published.contentHash}"`;
  const cacheControl =
    'public, max-age=60, s-maxage=300, stale-while-revalidate=86400';
  if (req.headers.get('if-none-match') === etag) {
    return new Response(null, {
      status: 304,
      headers: { etag, 'cache-control': cacheControl },
    });
  }

  const html = await readPublishedHtml(page.blobUrl);
  if (html === null) return NOT_FOUND;

  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': cacheControl,
      etag,
    },
  });
}
