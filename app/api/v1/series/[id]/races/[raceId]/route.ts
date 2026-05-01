import { deleteRace, getRace, putRace } from '@/lib/api-handlers/races';
import { parseIfMatch, workspaceRoute } from '../../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string; raceId: string };

export const GET = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  return getRace(workspace, params.id, params.raceId);
});

export const PUT = workspaceRoute<Params, unknown>(async (req, { workspace, params }) => {
  const body = await req.json();
  return putRace(workspace, params.id, params.raceId, body, {
    expectedVersion: parseIfMatch(req),
  });
});

export const DELETE = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  await deleteRace(workspace, params.id, params.raceId);
});
