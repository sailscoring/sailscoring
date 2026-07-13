import {
  deleteArchiveSeries,
  putArchiveSeries,
} from '@/lib/api-handlers/archive';
import { workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

// The archive ingest surface (ADR-010, #283) — the archivist credential's
// jurisdiction. `?convert=1` allows replacing an existing full-fidelity
// series (the migration path); `?force=1` re-applies an unchanged document.
export const PUT = workspaceRoute<{ id: string }, unknown>(
  async (req, { workspace, params }) => {
    const url = new URL(req.url);
    return putArchiveSeries(workspace, params.id, await req.json(), {
      convert: url.searchParams.get('convert') === '1',
      force: url.searchParams.get('force') === '1',
    });
  },
  { requires: 'archive-ingest' },
);

export const DELETE = workspaceRoute<{ id: string }, unknown>(
  async (_req, { workspace, params }) => {
    await deleteArchiveSeries(workspace, params.id);
  },
  { requires: 'archive-ingest' },
);
