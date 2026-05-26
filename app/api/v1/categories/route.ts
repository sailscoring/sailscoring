import { createCategory, listCategories } from '@/lib/api-handlers/categories';
import { workspaceRoute } from '../_lib/handler';

export const dynamic = 'force-dynamic';

export const GET = workspaceRoute<Record<string, never>, unknown>(
  async (_req, { workspace }) => {
    return listCategories(workspace);
  },
);

export const POST = workspaceRoute<Record<string, never>, unknown>(
  async (req, { workspace }) => {
    return createCategory(workspace, await req.json());
  },
);
