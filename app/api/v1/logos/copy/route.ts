import { copyLogoFromWorkspace } from '@/lib/api-handlers/logos';
import { workspaceRoute } from '../../_lib/handler';

export const dynamic = 'force-dynamic';

// `copy` is a static segment, so it takes precedence over the sibling `[id]`
// route — no collision with a logo UUID.

export const POST = workspaceRoute<Record<string, never>, unknown>(
  async (req, { workspace }) => {
    const body = await req.json();
    return copyLogoFromWorkspace(workspace, body);
  },
);
