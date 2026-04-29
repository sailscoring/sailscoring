import { deleteCompetitor, getCompetitor, putCompetitor } from '@/lib/api-handlers/competitors';
import { workspaceRoute } from '../../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string; competitorId: string };

export const GET = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  return getCompetitor(workspace, params.id, params.competitorId);
});

export const PUT = workspaceRoute<Params, unknown>(async (req, { workspace, params }) => {
  const body = await req.json();
  return putCompetitor(workspace, params.id, params.competitorId, body);
});

export const DELETE = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  await deleteCompetitor(workspace, params.id, params.competitorId);
});
