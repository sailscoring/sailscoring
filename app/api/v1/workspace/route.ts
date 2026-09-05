import { setWorkspaceLogo } from '@/lib/api-handlers/logos';
import {
  setWorkspaceFeature,
  setWorkspaceHomeClub,
  workspaceIdentity,
} from '@/lib/api-handlers/workspace';
import { workspaceRoute } from '../_lib/handler';

export const dynamic = 'force-dynamic';

// The caller's resolved identity and active workspace (role, features) — the
// CLI's `whoami`, and the first call to debug auth/workspace selection.
export const GET = workspaceRoute<Record<string, never>, unknown>(
  async (_req, { workspace }) => workspaceIdentity(workspace),
);

// The active workspace's own settings, all `manage-workspace`: a `{ feature,
// enabled }` body is a self-service feature toggle (#278); a `{ homeClub }`
// body sets the club whose workspace this is (#507); anything else is the
// workspace logo (`organization.logo`) — the default-default new-series venue
// logo shown in the workspace switcher.
export const PATCH = workspaceRoute<Record<string, never>, unknown>(
  async (req, { workspace }) => {
    const body = await req.json();
    if (body && typeof body === 'object' && 'feature' in body) {
      return setWorkspaceFeature(workspace, body);
    }
    if (body && typeof body === 'object' && 'homeClub' in body) {
      return setWorkspaceHomeClub(workspace, body);
    }
    return setWorkspaceLogo(workspace, body);
  },
  { requires: 'manage-workspace' },
);
