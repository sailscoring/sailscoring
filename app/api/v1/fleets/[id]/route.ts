import { deleteFleetFlat } from '@/lib/api-handlers/fleets';
import { workspaceRoute } from '../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

export const DELETE = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  await deleteFleetFlat(workspace, params.id);
});
