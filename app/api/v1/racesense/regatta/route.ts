import { getRaceSenseRegatta } from '@/lib/api-handlers/racesense';
import { workspaceRoute } from '../../_lib/handler';

export const dynamic = 'force-dynamic';

// `?ref=<player URL or regatta id>` names the regatta to read.
export const GET = workspaceRoute(async (req, { workspace }) =>
  getRaceSenseRegatta(workspace, new URL(req.url).searchParams.get('ref') ?? ''),
);
