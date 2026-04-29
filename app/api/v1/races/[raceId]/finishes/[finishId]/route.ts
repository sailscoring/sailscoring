import { deleteFinish, putFinish } from '@/lib/api-handlers/finishes';
import { workspaceRoute } from '../../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { raceId: string; finishId: string };

export const PUT = workspaceRoute<Params, unknown>(async (req, { workspace, params }) => {
  const body = await req.json();
  return putFinish(workspace, params.raceId, params.finishId, body);
});

export const DELETE = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  await deleteFinish(workspace, params.raceId, params.finishId);
});
