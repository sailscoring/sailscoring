import { ensureFleet } from '@/lib/api-handlers/fleets';
import { workspaceRoute } from '../../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

export const POST = workspaceRoute<Params, unknown>(async (req, { workspace, params }) => {
  const body = await req.json();
  return ensureFleet(workspace, params.id, body);
});
