import { listFtpServers } from '@/lib/api-handlers/ftp-servers';
import { workspaceRoute } from '../_lib/handler';

export const dynamic = 'force-dynamic';

// FTP server rows carry credentials, so even the reads demand
// `manage-workspace` rather than the GET default.
export const GET = workspaceRoute<Record<string, never>, unknown>(
  async (_req, { workspace }) => {
    return listFtpServers(workspace);
  },
  { requires: 'manage-workspace' },
);
