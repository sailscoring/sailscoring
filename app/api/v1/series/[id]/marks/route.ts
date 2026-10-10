import { bulkDeleteSeriesMarks, listSeriesMarks, putSeriesMarks } from '@/lib/api-handlers/course-library';
import { workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

export const GET = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  return listSeriesMarks(workspace, params.id);
});

// Building a course is race-day work, done from the race start as often as
// from the Courses tab, so writing the library takes `score` — the same as
// filling in a start's legs. Clearing it wholesale doesn't.

/** Bulk upsert; see lib/api-handlers/course-library.ts. */
export const POST = workspaceRoute<Params, unknown>(async (req, { workspace, params }) => {
  const body = await req.json();
  return putSeriesMarks(workspace, params.id, body);
}, { requires: 'score' });

/** Raw collection delete (file-import replace path). Stays `manage-series`. */
export const DELETE = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  await bulkDeleteSeriesMarks(workspace, params.id);
});
