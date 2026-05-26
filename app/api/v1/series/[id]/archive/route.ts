import { setSeriesArchived } from '@/lib/api-handlers/series';
import { workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

// POST /api/v1/series/:id/archive — body `{ archived: boolean }`. The
// archive/unarchive toggle (#154); the one write that must work on an
// archived series, so it bypasses the read-only guard the general PUT uses.
export const POST = workspaceRoute<Params, unknown>(async (req, { workspace, params }) => {
  const body = await req.json();
  return setSeriesArchived(workspace, params.id, body);
});
