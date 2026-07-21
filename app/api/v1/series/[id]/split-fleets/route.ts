import { getSplitFleetState, putSplitFleetConfig } from '@/lib/api-handlers/split-fleets';
import { workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

export const GET = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  return getSplitFleetState(workspace, params.id);
});

export const PUT = workspaceRoute<Params, unknown>(async (req, { workspace, params }) => {
  const body = await req.json();
  return putSplitFleetConfig(workspace, params.id, body);
});
