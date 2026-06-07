import { getLogoDefaults, setLogoDefaults } from '@/lib/api-handlers/logos';
import { workspaceRoute } from '../../_lib/handler';

export const dynamic = 'force-dynamic';

// `defaults` is a static segment, so it takes precedence over the sibling
// `[id]` route — no collision with a logo UUID.

export const GET = workspaceRoute<Record<string, never>, unknown>(
  async (_req, { workspace }) => {
    return getLogoDefaults(workspace);
  },
);

export const PUT = workspaceRoute<Record<string, never>, unknown>(
  async (req, { workspace }) => {
    const body = await req.json();
    return setLogoDefaults(workspace, body);
  },
);
