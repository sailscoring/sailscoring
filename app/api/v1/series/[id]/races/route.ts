import { bulkDeleteRaces, generateRaces, listRaces } from '@/lib/api-handlers/races';
import { workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

export const GET = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  return listRaces(workspace, params.id);
});

/** Bulk-create appended races (the "Add multiple races" generator). Use the
 *  per-race PUT route for single-row writes. */
export const POST = workspaceRoute<Params, unknown>(async (req, { workspace, params }) => {
  const body = await req.json();
  return generateRaces(workspace, params.id, body);
}, { requires: 'score' });

/** Collection delete: drop every race in the series (FK-cascades to starts/finishes). */
export const DELETE = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  return bulkDeleteRaces(workspace, params.id);
}, { requires: 'score' });
