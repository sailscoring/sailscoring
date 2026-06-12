import { deleteRaceStartFlat } from '@/lib/api-handlers/race-starts';
import { workspaceRoute } from '../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

export const DELETE = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  await deleteRaceStartFlat(workspace, params.id);
}, { requires: 'score' });
