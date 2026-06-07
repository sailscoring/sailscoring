import { createLogo, listLogos } from '@/lib/api-handlers/logos';
import { workspaceRoute } from '../_lib/handler';

export const dynamic = 'force-dynamic';

export const GET = workspaceRoute<Record<string, never>, unknown>(
  async (_req, { workspace }) => {
    return listLogos(workspace);
  },
);

export const POST = workspaceRoute<Record<string, never>, unknown>(
  async (req, { workspace }) => {
    const body = await req.json();
    return createLogo(workspace, body);
  },
);
