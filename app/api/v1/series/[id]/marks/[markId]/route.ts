import { deleteSeriesMark, putSeriesMark } from '@/lib/api-handlers/course-library';
import { parseIfMatch, workspaceRoute } from '../../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string; markId: string };

export const PUT = workspaceRoute<Params, unknown>(async (req, { workspace, params }) => {
  const body = await req.json();
  return putSeriesMark(workspace, params.id, params.markId, body, {
    expectedVersion: parseIfMatch(req),
  });
});

export const DELETE = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  await deleteSeriesMark(workspace, params.id, params.markId);
});
