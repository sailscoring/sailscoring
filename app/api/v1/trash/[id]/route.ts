import { purgeFromTrash } from '@/lib/api-handlers/trash';
import { workspaceRoute } from '../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

// Permanently delete a trashed series — the "delete forever" path, gated behind
// a type-the-name confirmation in the UI. `id` is the tombstone id.
export const DELETE = workspaceRoute<Params, void>(
  async (_req, { workspace, params }) => {
    await purgeFromTrash(workspace, params.id);
  },
);
