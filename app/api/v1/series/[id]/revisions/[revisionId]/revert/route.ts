import { revertToRevision } from '@/lib/api-handlers/revisions';
import { workspaceRoute } from '../../../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string; revisionId: string };

export const POST = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  return revertToRevision(workspace, params.id, params.revisionId);
});
