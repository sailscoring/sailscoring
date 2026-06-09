import { exportSeriesRevisions } from '@/lib/api-handlers/revisions';
import { workspaceRoute } from '../../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

export const GET = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  return exportSeriesRevisions(workspace, params.id);
});
