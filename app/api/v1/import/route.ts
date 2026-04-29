import { workspaceRoute } from '../_lib/handler';

export const dynamic = 'force-dynamic';

/**
 * Stub for ADR-008 Phase 5 (migration UX). Returns 501 until the
 * "import from browser" wizard lands.
 */
export const POST = workspaceRoute(async () => {
  return new Response(
    JSON.stringify({ error: 'not-implemented', phase: 'ADR-008 Phase 5' }),
    { status: 501, headers: { 'content-type': 'application/json' } },
  ) as unknown as Response;
});
