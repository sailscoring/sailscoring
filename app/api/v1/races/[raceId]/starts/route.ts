import {
  bulkDeleteRaceStarts,
  bulkPutRaceStarts,
  listRaceStarts,
} from '@/lib/api-handlers/race-starts';
import { workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { raceId: string };

export const GET = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  return listRaceStarts(workspace, params.raceId);
});

/** Bulk upsert. Use the per-start PUT route for single-row writes. */
export const POST = workspaceRoute<Params, unknown>(async (req, { workspace, params }) => {
  const body = await req.json();
  return bulkPutRaceStarts(workspace, params.raceId, body);
});

/** Collection delete: drop every start in the race. */
export const DELETE = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  return bulkDeleteRaceStarts(workspace, params.raceId);
});
