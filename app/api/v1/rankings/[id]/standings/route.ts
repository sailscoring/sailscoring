import { rankingStandings } from '@/lib/api-handlers/rankings';
import { workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

export const GET = workspaceRoute<{ id: string }, unknown>(
  async (_req, { workspace, params }) => {
    return rankingStandings(workspace, params.id);
  },
);
