import { listTcfHistory } from '@/lib/api-handlers/tcf-history';
import { workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

export const GET = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  return listTcfHistory(workspace, params.id);
});
