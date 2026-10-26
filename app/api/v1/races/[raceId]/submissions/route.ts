import { listSubmissionsForRace } from '@/lib/api-handlers/finish-submissions';
import { workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { raceId: string };

/** The race's finish sheet submissions, the latest upload first. */
export const GET = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) =>
  listSubmissionsForRace(workspace, params.raceId),
);
