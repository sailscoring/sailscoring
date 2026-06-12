import { deleteFinishFlat } from '@/lib/api-handlers/finishes';
import { workspaceRoute } from '../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

export const DELETE = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  await deleteFinishFlat(workspace, params.id);
}, { requires: 'score' });
