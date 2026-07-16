import {
  deleteArchiveRanking,
  putArchiveRanking,
} from '@/lib/api-handlers/archive';
import { workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

// As-published season rankings (#309) — the ranking half of the archive
// ingest surface, under the same archivist credential. `?force=1`
// re-applies an unchanged document.
export const PUT = workspaceRoute<{ id: string }, unknown>(
  async (req, { workspace, params }) => {
    const url = new URL(req.url);
    return putArchiveRanking(workspace, params.id, await req.json(), {
      force: url.searchParams.get('force') === '1',
    });
  },
  { requires: 'archive-ingest' },
);

export const DELETE = workspaceRoute<{ id: string }, unknown>(
  async (_req, { workspace, params }) => {
    await deleteArchiveRanking(workspace, params.id);
  },
  { requires: 'archive-ingest' },
);
