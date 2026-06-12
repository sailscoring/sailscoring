import { deleteLogoEntry, updateLogo } from '@/lib/api-handlers/logos';
import { workspaceRoute } from '../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

export const PUT = workspaceRoute<Params, unknown>(
  async (req, { workspace, params }) => {
    const body = await req.json();
    return updateLogo(workspace, params.id, body);
  },
  { requires: 'manage-workspace' },
);

export const DELETE = workspaceRoute<Params, unknown>(
  async (_req, { workspace, params }) => {
    await deleteLogoEntry(workspace, params.id);
  },
  { requires: 'manage-workspace' },
);
