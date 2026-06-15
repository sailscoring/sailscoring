import {
  getIdentity,
  patchIdentity,
} from '@/lib/api-handlers/competitor-identity';
import { workspaceRoute } from '../../_lib/handler';

export const dynamic = 'force-dynamic';

export const GET = workspaceRoute<{ id: string }, unknown>(
  async (_req, { workspace, params }) => {
    return getIdentity(workspace, params.id);
  },
);

export const PATCH = workspaceRoute<{ id: string }, unknown>(
  async (req, { workspace, params }) => {
    return patchIdentity(workspace, params.id, await req.json());
  },
);
