import { reorderCategories } from '@/lib/api-handlers/categories';
import { workspaceRoute } from '../../_lib/handler';

export const dynamic = 'force-dynamic';

// POST /api/v1/categories/reorder — body `{ orderedIds: string[] }`. Rewrites
// display_order to match the given sequence (#154); menu-driven reorder, DnD
// is post-MVP.
export const POST = workspaceRoute<Record<string, never>, unknown>(
  async (req, { workspace }) => {
    return reorderCategories(workspace, await req.json());
  },
);
