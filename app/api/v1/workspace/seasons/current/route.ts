import { setCurrentSeason } from '@/lib/api-handlers/seasons';
import { workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

export const PUT = workspaceRoute<Record<string, never>, unknown>(
  async (req, { workspace }) => {
    return setCurrentSeason(workspace, await req.json());
  },
);
