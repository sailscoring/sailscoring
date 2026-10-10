import { deleteSeriesMark, putSeriesMark } from '@/lib/api-handlers/course-library';
import { parseIfMatch, workspaceRoute } from '../../../../_lib/handler';

export const dynamic = 'force-dynamic';

// `score`, like the start a course is often built from: see ../route.ts.

type Params = { id: string; markId: string };

export const PUT = workspaceRoute<Params, unknown>(async (req, { workspace, params }) => {
  const body = await req.json();
  return putSeriesMark(workspace, params.id, params.markId, body, {
    expectedVersion: parseIfMatch(req),
  });
}, { requires: 'score' });

export const DELETE = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  await deleteSeriesMark(workspace, params.id, params.markId);
}, { requires: 'score' });
