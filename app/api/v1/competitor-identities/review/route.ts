import { reviewQueue } from '@/lib/api-handlers/competitor-identity';
import { workspaceRoute } from '../../_lib/handler';

export const dynamic = 'force-dynamic';

export const GET = workspaceRoute<Record<string, never>, unknown>(
  async (_req, { workspace }) => {
    return reviewQueue(workspace);
  },
);
