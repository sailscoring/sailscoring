import { recordSaveMilestone } from '@/lib/api-handlers/revisions';
import { workspaceRoute } from '../../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

/** Record a "Saved to file" milestone revision for the series. */
export const POST = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  return recordSaveMilestone(workspace, params.id);
}, { requires: 'score' });
