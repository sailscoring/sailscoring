import { bulkDeleteRaces, listRaces } from '@/lib/api-handlers/races';
import { workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

export const GET = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  return listRaces(workspace, params.id);
});

/** Collection delete: drop every race in the series (FK-cascades to starts/finishes). */
export const DELETE = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  return bulkDeleteRaces(workspace, params.id);
}, { requires: 'score' });
