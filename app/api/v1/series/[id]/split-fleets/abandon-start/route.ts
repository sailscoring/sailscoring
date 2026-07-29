import { abandonSplitStart } from '@/lib/api-handlers/split-fleets';
import { workspaceRoute } from '../../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

export const POST = workspaceRoute<Params, unknown>(async (req, { workspace, params }) => {
  const body = await req.json();
  await abandonSplitStart(workspace, params.id, body);
});
