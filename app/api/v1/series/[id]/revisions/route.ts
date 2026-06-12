import {
  createNamedCheckpoint,
  getSeriesRevisions,
} from '@/lib/api-handlers/revisions';
import { workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

export const GET = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  return getSeriesRevisions(workspace, params.id);
});

/** Create a named checkpoint of the series' current state. */
export const POST = workspaceRoute<Params, unknown>(async (req, { workspace, params }) => {
  const body = await req.json();
  return createNamedCheckpoint(workspace, params.id, body);
}, { requires: 'score' });
