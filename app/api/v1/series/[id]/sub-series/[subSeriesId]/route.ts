import { deleteSubSeries, putSubSeries } from '@/lib/api-handlers/sub-series';
import { parseIfMatch, workspaceRoute } from '../../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string; subSeriesId: string };

export const PUT = workspaceRoute<Params, unknown>(async (req, { workspace, params }) => {
  const body = await req.json();
  return putSubSeries(workspace, params.id, params.subSeriesId, body, {
    expectedVersion: parseIfMatch(req),
  });
});

/** Remove a block: its races merge into the neighbouring block. */
export const DELETE = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  await deleteSubSeries(workspace, params.id, params.subSeriesId);
});
