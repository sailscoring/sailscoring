import { reorderSeries } from '@/lib/api-handlers/series';
import { workspaceRoute } from '../../_lib/handler';

export const dynamic = 'force-dynamic';

// POST /api/v1/series/reorder — body `{ orderedIds: string[] }`. Rewrites
// display_order to match the given sequence (#171), drag-reorder of the active
// series list. Static segment, so it takes precedence over /series/[id].
export const POST = workspaceRoute<Record<string, never>, unknown>(
  async (req, { workspace }) => {
    return reorderSeries(workspace, await req.json());
  },
);
