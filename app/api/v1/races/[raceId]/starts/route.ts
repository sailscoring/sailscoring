import { listRaceStarts } from '@/lib/api-handlers/race-starts';
import { workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { raceId: string };

export const GET = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  return listRaceStarts(workspace, params.raceId);
});
