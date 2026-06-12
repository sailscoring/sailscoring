import { restoreFromTrash } from '@/lib/api-handlers/trash';
import { workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

// Recover a trashed series: re-create it (archived) under its original id and
// drop the tombstone. `id` is the tombstone id; returns the restored series id.
export const POST = workspaceRoute<Params, { seriesId: string }>(
  async (_req, { workspace, params }) => restoreFromTrash(workspace, params.id),
);
