import type { NextRequest } from 'next/server';

import { errorToResponse } from '@/app/api/v1/_lib/handler';
import { readLogoBytes } from '@/lib/api-handlers/logos';
import { requireWorkspace } from '@/lib/auth/require-workspace';

export const dynamic = 'force-dynamic';

/**
 * Authenticated, workspace-scoped logo bytes — the `<img src>` for the
 * management card's thumbnails. Bytes for a given id are immutable in this
 * phase (a changed image is a new logo), so the response caches privately.
 * The public, unauthenticated indirection URL the published renderer will link
 * to is a separate, later route.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const workspace = await requireWorkspace();
    const { id } = await params;
    const { bytes, contentType } = await readLogoBytes(workspace, id);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'content-type': contentType,
        'cache-control': 'private, max-age=300',
      },
    });
  } catch (err) {
    return errorToResponse(err);
  }
}
