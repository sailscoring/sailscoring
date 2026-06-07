import type { NextRequest } from 'next/server';

import { getPublicLogo, readLogo } from '@/lib/flag-locker-storage';

export const dynamic = 'force-dynamic';

const NOT_FOUND = new Response('Not found', {
  status: 404,
  headers: { 'content-type': 'text/plain; charset=utf-8' },
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Revalidate against the ETag every request, but allow a short shared-cache
// window. The ETag is the asset's content hash, so re-pointing a library entry
// (a future phase) propagates to published pages within the window rather than
// requiring a republish. `proxy.ts` excludes `/logos/` from the login gate.
const CACHE_CONTROL = 'public, max-age=300, stale-while-revalidate=86400';

/**
 * Public, unauthenticated logo bytes — the indirection URL the picker writes
 * into a series' venue/event logo field (`logoPublicUrl`). Keyed by the logo's
 * UUID alone; durable across a workspace-slug rename. Anonymous viewers of a
 * published results page resolve their header logos here.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NOT_FOUND;

  const meta = await getPublicLogo(id);
  if (!meta) return NOT_FOUND;

  const etag = `"${meta.sha256}"`;
  if (req.headers.get('if-none-match') === etag) {
    return new Response(null, {
      status: 304,
      headers: { etag, 'cache-control': CACHE_CONTROL },
    });
  }

  const bytes = await readLogo(meta.locator);
  if (!bytes) return NOT_FOUND;

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'content-type': meta.contentType,
      'cache-control': CACHE_CONTROL,
      etag,
    },
  });
}
