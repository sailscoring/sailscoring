import { deleteSplitRound } from '@/lib/api-handlers/split-fleets';
import { workspaceRoute } from '../../../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string; roundId: string };

export const DELETE = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  await deleteSplitRound(workspace, params.id, params.roundId);
});
