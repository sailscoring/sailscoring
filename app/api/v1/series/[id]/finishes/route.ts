import { listSeriesFinishes } from '@/lib/api-handlers/finishes';
import { workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

export const GET = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  return listSeriesFinishes(workspace, params.id);
});
