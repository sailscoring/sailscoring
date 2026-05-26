import { getMyOrgRequest, submitOrgRequest } from '@/lib/api-handlers/org-requests';
import { workspaceRoute } from '../_lib/handler';

export const dynamic = 'force-dynamic';

// Org requests are user-scoped, not workspace-scoped, but every signed-in user
// has a personal workspace, so workspaceRoute is a convenient "must be signed
// in" wrapper; we use only the resolved userId/email.
export const GET = workspaceRoute<Record<string, never>, unknown>(
  async (_req, { workspace }) => {
    return getMyOrgRequest(workspace.userId);
  },
);

export const POST = workspaceRoute<Record<string, never>, unknown>(
  async (req, { workspace }) => {
    return submitOrgRequest(
      { userId: workspace.userId, email: workspace.email },
      await req.json(),
    );
  },
);
