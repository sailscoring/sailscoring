import { setWorkspaceLogo } from '@/lib/api-handlers/logos';
import { workspaceRoute } from '../_lib/handler';

export const dynamic = 'force-dynamic';

// The active workspace's own settings. Currently just its logo
// (`organization.logo`) — the default-default new-series venue logo, shown in
// the workspace switcher.
export const PATCH = workspaceRoute<Record<string, never>, unknown>(
  async (req, { workspace }) => {
    const body = await req.json();
    return setWorkspaceLogo(workspace, body);
  },
  { requires: 'manage-workspace' },
);
