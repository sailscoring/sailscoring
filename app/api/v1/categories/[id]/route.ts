import { deleteCategory, renameCategory } from '@/lib/api-handlers/categories';
import { workspaceRoute } from '../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

export const PATCH = workspaceRoute<Params, unknown>(
  async (req, { workspace, params }) => {
    return renameCategory(workspace, params.id, await req.json());
  },
);

export const DELETE = workspaceRoute<Params, unknown>(
  async (_req, { workspace, params }) => {
    await deleteCategory(workspace, params.id);
  },
);
