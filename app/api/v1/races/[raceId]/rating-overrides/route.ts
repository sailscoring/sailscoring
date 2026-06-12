import {
  bulkDeleteRaceRatingOverrides,
  bulkPutRaceRatingOverrides,
  listRaceRatingOverrides,
} from '@/lib/api-handlers/race-rating-overrides';
import { workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { raceId: string };

export const GET = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  return listRaceRatingOverrides(workspace, params.raceId);
});

/** Bulk upsert. */
export const POST = workspaceRoute<Params, unknown>(async (req, { workspace, params }) => {
  const body = await req.json();
  return bulkPutRaceRatingOverrides(workspace, params.raceId, body);
}, { requires: 'score' });

/** Collection delete: drop every override in the race. */
export const DELETE = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  return bulkDeleteRaceRatingOverrides(workspace, params.raceId);
}, { requires: 'score' });
