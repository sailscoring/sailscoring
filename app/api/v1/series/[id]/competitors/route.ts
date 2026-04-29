import { listCompetitors } from '@/lib/api-handlers/competitors';
import { workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

export const GET = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  return listCompetitors(workspace, params.id);
});
