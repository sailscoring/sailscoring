import { listRecordings } from '@/lib/voice/server/handlers';
import { workspaceRoute } from '../../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { raceId: string };

/** The race's voice recordings the caller may hear, the latest first. */
export const GET = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) =>
  listRecordings(workspace, params.raceId),
);
