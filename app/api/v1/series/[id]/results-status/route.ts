import { setSeriesResultsStatus } from '@/lib/api-handlers/series';
import { workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

// POST /api/v1/series/:id/results-status — body `{ status: 'provisional' |
// 'final' }`. Finalise / reopen results. Like the archive toggle, this
// bypasses the read-only guard the general PUT uses: reopening must work on a
// final series. A `score` operation — finality is the results team's call.
export const POST = workspaceRoute<Params, unknown>(
  async (req, { workspace, params }) => {
    const body = await req.json();
    return setSeriesResultsStatus(workspace, params.id, body);
  },
  { requires: 'score' },
);
