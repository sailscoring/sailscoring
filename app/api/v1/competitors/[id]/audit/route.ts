import { getCompetitorAudit } from '@/lib/api-handlers/competitors';
import { workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

export const GET = workspaceRoute<{ id: string }, unknown>(
  async (_req, { workspace, params }) => {
    return getCompetitorAudit(workspace, params.id);
  },
);
