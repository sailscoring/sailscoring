import {
  bulkDeleteCompetitors,
  bulkPutCompetitors,
  listCompetitors,
} from '@/lib/api-handlers/competitors';
import { workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

export const GET = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  return listCompetitors(workspace, params.id);
});

/** Bulk upsert. Use the per-competitor PUT route for single-row writes. */
export const POST = workspaceRoute<Params, unknown>(async (req, { workspace, params }) => {
  const body = await req.json();
  return bulkPutCompetitors(workspace, params.id, body);
});

/** Collection delete: drop every competitor in the series. */
export const DELETE = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  return bulkDeleteCompetitors(workspace, params.id);
});
