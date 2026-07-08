import { restoreMergedIdentity } from '@/lib/api-handlers/competitor-identity';
import { workspaceRoute } from '../../_lib/handler';

export const dynamic = 'force-dynamic';

export const POST = workspaceRoute<Record<string, never>, unknown>(
  async (req, { workspace }) => {
    return restoreMergedIdentity(workspace, await req.json());
  },
);
