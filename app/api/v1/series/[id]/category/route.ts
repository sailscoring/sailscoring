import { setSeriesCategory } from '@/lib/api-handlers/series';
import { workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

// POST /api/v1/series/:id/category — body `{ categoryId: string | null }`.
// Moves the series between categories (#154); null = Uncategorized. Blocked on
// archived series (moving is an edit).
export const POST = workspaceRoute<Params, unknown>(
  async (req, { workspace, params }) => {
    return setSeriesCategory(workspace, params.id, await req.json());
  },
);
