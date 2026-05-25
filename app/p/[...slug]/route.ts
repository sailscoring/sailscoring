import type { NextRequest } from 'next/server';

import { readPublishedHtml } from '@/lib/blob-storage';
import { getPublishedBySlug } from '@/lib/published-repository';

export const dynamic = 'force-dynamic';

/**
 * Public, unauthenticated results pages (ADR-008 Phase 9, the bilge
 * replacement). `/p/{slug}` serves the primary fleet; `/p/{slug}/{subPath}`
 * serves an additional fleet, mirroring bilge's `/r/{prefix}/standings-{fleet}`
 * layout. The HTML is read back from Vercel Blob and served with `Cache-Control`
 * + an `ETag` (the publication's content hash) — no render-on-demand.
 *
 * Reached without auth because `proxy.ts` excludes `/p/` from the login gate.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> },
): Promise<Response> {
  const { slug: segments } = await params;
  const slug = segments[0];
  const subPath = segments.slice(1).join('/');

  const published = await getPublishedBySlug(slug);
  const page = published?.pages.find((p) => p.subPath === subPath);
  if (!published || !page) {
    return new Response('Not found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const etag = `"${published.contentHash}"`;
  const cacheControl =
    'public, max-age=60, s-maxage=300, stale-while-revalidate=86400';

  // Conditional request: unchanged since the client last fetched.
  if (req.headers.get('if-none-match') === etag) {
    return new Response(null, {
      status: 304,
      headers: { etag, 'cache-control': cacheControl },
    });
  }

  const html = await readPublishedHtml(page.blobUrl);
  if (html === null) {
    // The row points at storage that's gone — treat as not found.
    return new Response('Not found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': cacheControl,
      etag,
    },
  });
}
