import { bulkDeleteFleets, bulkPutFleets, listFleets } from '@/lib/api-handlers/fleets';
import { workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

export const GET = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  return listFleets(workspace, params.id);
});

/** Bulk upsert. Use the per-fleet PUT route for single-row writes. */
export const POST = workspaceRoute<Params, unknown>(async (req, { workspace, params }) => {
  const body = await req.json();
  return bulkPutFleets(workspace, params.id, body);
});

/** Collection delete: drop every fleet in the series. */
export const DELETE = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  return bulkDeleteFleets(workspace, params.id);
});
