import { listSeriesRaceRatingOverrides } from '@/lib/api-handlers/race-rating-overrides';
import { workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

export const GET = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  return listSeriesRaceRatingOverrides(workspace, params.id);
});
