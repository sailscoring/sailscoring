import { unlinkFromIdentity } from '@/lib/api-handlers/competitor-identity';
import { workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

export const POST = workspaceRoute<{ id: string }, unknown>(
  async (req, { workspace, params }) => {
    return unlinkFromIdentity(workspace, params.id, await req.json());
  },
);
