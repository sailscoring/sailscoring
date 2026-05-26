import { getActivityFeed } from '@/lib/api-handlers/activity';
import { workspaceRoute } from '../_lib/handler';

export const dynamic = 'force-dynamic';

export const GET = workspaceRoute<Record<string, never>, unknown>(
  async (req, { workspace }) => {
    return getActivityFeed(workspace, new URL(req.url).searchParams);
  },
);
