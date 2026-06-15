import { setWorkspaceLogo } from '@/lib/api-handlers/logos';
import { workspaceIdentity } from '@/lib/api-handlers/workspace';
import { workspaceRoute } from '../_lib/handler';

export const dynamic = 'force-dynamic';

// The caller's resolved identity and active workspace (role, features) — the
// CLI's `whoami`, and the first call to debug auth/workspace selection.
export const GET = workspaceRoute<Record<string, never>, unknown>(
  async (_req, { workspace }) => workspaceIdentity(workspace),
);

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
