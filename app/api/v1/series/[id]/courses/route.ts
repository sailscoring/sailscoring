import { bulkDeleteSeriesCourses, listSeriesCourses, putSeriesCourses } from '@/lib/api-handlers/course-library';
import { workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

export const GET = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  return listSeriesCourses(workspace, params.id);
});

/** Bulk upsert; see lib/api-handlers/course-library.ts. */
export const POST = workspaceRoute<Params, unknown>(async (req, { workspace, params }) => {
  const body = await req.json();
  return putSeriesCourses(workspace, params.id, body);
});

/** Raw collection delete (file-import replace path). */
export const DELETE = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  await bulkDeleteSeriesCourses(workspace, params.id);
});
