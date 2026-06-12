import { listTrash } from '@/lib/api-handlers/trash';
import type { DeletedSeriesEntry } from '@/lib/types';
import { workspaceRoute } from '../_lib/handler';

export const dynamic = 'force-dynamic';

// The workspace Trash — soft-deleted series recoverable within the retention
// window ("Recover a deleted series").
export const GET = workspaceRoute<Record<string, never>, { items: DeletedSeriesEntry[] }>(
  async (_req, { workspace }) => listTrash(workspace),
);
