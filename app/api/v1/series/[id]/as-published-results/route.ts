import { getAsPublishedResults } from '@/lib/api-handlers/archive';
import { workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

// The stored as-published tables (ADR-010) — the in-app Standings tab's read.
export const GET = workspaceRoute<{ id: string }, unknown>(
  async (_req, { workspace, params }) => {
    return getAsPublishedResults(workspace, params.id);
  },
);
