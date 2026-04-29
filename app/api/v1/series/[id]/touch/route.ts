import { touchSeries } from '@/lib/api-handlers/series';
import { workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

export const POST = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  await touchSeries(workspace, params.id);
});
