import { bulkPutFinishes, listFinishes } from '@/lib/api-handlers/finishes';
import { workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { raceId: string };

export const GET = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  return listFinishes(workspace, params.raceId);
});

/** Bulk upsert. Use the per-finish PUT route for single-row writes. */
export const POST = workspaceRoute<Params, unknown>(async (req, { workspace, params }) => {
  const body = await req.json();
  return bulkPutFinishes(workspace, params.raceId, body);
});
