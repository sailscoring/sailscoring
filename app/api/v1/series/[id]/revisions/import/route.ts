import { importSeriesRevisions } from '@/lib/api-handlers/revisions';
import { workspaceRoute } from '../../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

export const POST = workspaceRoute<Params, unknown>(async (req, { workspace, params }) => {
  const body = await req.json();
  return importSeriesRevisions(workspace, params.id, body);
});
