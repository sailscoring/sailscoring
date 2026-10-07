import {
  getDirectorySettings,
  setDirectorySettings,
} from '@/lib/api-handlers/workspace';
import { workspaceRoute } from '../../_lib/handler';

export const dynamic = 'force-dynamic';

// The active workspace's entry in the public directory at `/p/`: whether it
// is listed, and the one line under its name.
export const GET = workspaceRoute<Record<string, never>, unknown>(
  async (_req, { workspace }) => getDirectorySettings(workspace),
  { requires: 'manage-workspace' },
);

export const PUT = workspaceRoute<Record<string, never>, unknown>(
  async (req, { workspace }) => setDirectorySettings(workspace, await req.json()),
  { requires: 'manage-workspace' },
);
