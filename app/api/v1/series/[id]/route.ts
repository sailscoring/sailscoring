import { deleteSeries, getSeries, putSeries } from '@/lib/api-handlers/series';
import { parseIfMatch, workspaceRoute } from '../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

export const GET = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  return getSeries(workspace, params.id);
});

export const PUT = workspaceRoute<Params, unknown>(async (req, { workspace, params }) => {
  const body = await req.json();
  return putSeries(workspace, params.id, body, { expectedVersion: parseIfMatch(req) });
});

export const DELETE = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  await deleteSeries(workspace, params.id);
});
