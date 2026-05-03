import { reorderFinishes } from '@/lib/api-handlers/finishes';
import { workspaceRoute } from '../../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { raceId: string };

/**
 * Per-row CAS reorder of finishes within a race (ADR-008 Phase 6).
 * Body shape: `{ items: { id, sortOrder, expectedVersion }[] }`.
 * Returns `{ results: { id, sortOrder, version }[] }`. On any stale
 * version: 409 with `rowConflicts` in the detail and no writes applied.
 */
export const PATCH = workspaceRoute<Params, unknown>(async (req, { workspace, params }) => {
  const body = await req.json();
  return reorderFinishes(workspace, params.raceId, body);
});
