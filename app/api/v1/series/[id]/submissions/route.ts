import { listPendingSubmissionsForSeries } from '@/lib/api-handlers/finish-submissions';
import { workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

/** The series' finish sheet submissions waiting for review. */
export const GET = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) =>
  listPendingSubmissionsForSeries(workspace, params.id),
);
