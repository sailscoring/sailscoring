import { applyArchiveIdentities } from '@/lib/api-handlers/archive';
import { workspaceRoute } from '../../_lib/handler';

export const dynamic = 'force-dynamic';

// Apply the archive repo's identity manifest + the scoped auto-pass
// (ADR-010, #283). Idempotent; archivist credential's jurisdiction.
export const POST = workspaceRoute<Record<string, never>, unknown>(
  async (req, { workspace }) => {
    return applyArchiveIdentities(workspace, await req.json());
  },
  { requires: 'archive-ingest' },
);
