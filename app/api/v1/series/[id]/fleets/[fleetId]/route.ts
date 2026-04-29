import { deleteFleet, getFleet, putFleet } from '@/lib/api-handlers/fleets';
import { workspaceRoute } from '../../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string; fleetId: string };

export const GET = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  return getFleet(workspace, params.id, params.fleetId);
});

export const PUT = workspaceRoute<Params, unknown>(async (req, { workspace, params }) => {
  const body = await req.json();
  return putFleet(workspace, params.id, params.fleetId, body);
});

export const DELETE = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  await deleteFleet(workspace, params.id, params.fleetId);
});
