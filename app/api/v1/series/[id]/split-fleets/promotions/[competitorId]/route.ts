import { withdrawPromotion } from '@/lib/api-handlers/split-fleets';
import { workspaceRoute } from '../../../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string; competitorId: string };

export const DELETE = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  return withdrawPromotion(workspace, params.id, params.competitorId);
});
