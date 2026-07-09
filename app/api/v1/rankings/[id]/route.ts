import {
  deleteRanking,
  getRanking,
  putRanking,
} from '@/lib/api-handlers/rankings';
import { workspaceRoute } from '../../_lib/handler';

export const dynamic = 'force-dynamic';

export const GET = workspaceRoute<{ id: string }, unknown>(
  async (_req, { workspace, params }) => {
    return getRanking(workspace, params.id);
  },
);

export const PUT = workspaceRoute<{ id: string }, unknown>(
  async (req, { workspace, params }) => {
    return putRanking(workspace, params.id, await req.json());
  },
);

export const DELETE = workspaceRoute<{ id: string }, unknown>(
  async (_req, { workspace, params }) => {
    await deleteRanking(workspace, params.id);
  },
);
