import { listSeriesRaceStarts } from '@/lib/api-handlers/race-starts';
import { workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

export const GET = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  return listSeriesRaceStarts(workspace, params.id);
});
