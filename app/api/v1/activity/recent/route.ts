import { getRecentActivity } from '@/lib/api-handlers/activity';
import { workspaceRoute } from '../../_lib/handler';

export const dynamic = 'force-dynamic';

export const GET = workspaceRoute<Record<string, never>, unknown>(
  async (_req, { workspace }) => {
    return getRecentActivity(workspace);
  },
);
