import { bulkDeleteSubSeries, createSubSeries, listSubSeries } from '@/lib/api-handlers/sub-series';
import { workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

export const GET = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  return listSubSeries(workspace, params.id);
});

/** The "start a new sub-series here" gesture; see lib/api-handlers/sub-series.ts. */
export const POST = workspaceRoute<Params, unknown>(async (req, { workspace, params }) => {
  const body = await req.json();
  return createSubSeries(workspace, params.id, body);
});

/** Raw collection delete: drop every block (file-import replace path). */
export const DELETE = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  await bulkDeleteSubSeries(workspace, params.id);
});
