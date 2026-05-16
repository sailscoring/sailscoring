import { bulkUpdateHandicaps } from '@/lib/api-handlers/competitors';
import { workspaceRoute } from '../../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

export const PATCH = workspaceRoute<Params, unknown>(async (req, { workspace, params }) => {
  const body = await req.json();
  return bulkUpdateHandicaps(workspace, params.id, body);
});
