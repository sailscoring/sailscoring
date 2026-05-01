import { deleteRaceStart, putRaceStart } from '@/lib/api-handlers/race-starts';
import { parseIfMatch, workspaceRoute } from '../../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { raceId: string; startId: string };

export const PUT = workspaceRoute<Params, unknown>(async (req, { workspace, params }) => {
  const body = await req.json();
  return putRaceStart(workspace, params.raceId, params.startId, body, {
    expectedVersion: parseIfMatch(req),
  });
});

export const DELETE = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  await deleteRaceStart(workspace, params.raceId, params.startId);
});
