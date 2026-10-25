import {
  disconnectApp,
  disconnectInputSchema,
  listConnectedApps,
} from '@/lib/api-handlers/connected-apps';
import { readJson, workspaceRoute } from '../_lib/handler';

export const dynamic = 'force-dynamic';

// The signed-in user's connected apps (ADR-016). User-scoped, like the org
// requests: workspaceRoute is the "must be signed in" wrapper, and only the
// user is used.
export const GET = workspaceRoute<Record<string, never>, unknown>(async (_req, { workspace }) =>
  listConnectedApps(workspace.userId),
);

/** Disconnect one: body `{ clientId, workspaceId }` (`null` for the CLI). */
export const DELETE = workspaceRoute<Record<string, never>, unknown>(
  async (req, { workspace }) => {
    await disconnectApp(workspace.userId, await readJson(req, disconnectInputSchema));
  },
  { requires: 'read' },
);
