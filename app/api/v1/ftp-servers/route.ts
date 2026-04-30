import { listFtpServers } from '@/lib/api-handlers/ftp-servers';
import { workspaceRoute } from '../_lib/handler';

export const dynamic = 'force-dynamic';

export const GET = workspaceRoute<Record<string, never>, unknown>(
  async (_req, { workspace }) => {
    return listFtpServers(workspace);
  },
);
