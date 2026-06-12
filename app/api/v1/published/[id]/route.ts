import { unpublishById } from '@/lib/api-handlers/publish';
import { workspaceRoute } from '../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

// Unpublish by publication id — the management page's canonical delete, the
// only path that can reach an orphaned snapshot (#164). Deletes the stored HTML
// + the row, so the public page 404s and the slug frees.
export const DELETE = workspaceRoute<Params, void>(
  async (_req, { workspace, params }) => {
    await unpublishById(workspace, params.id);
  },
  { requires: 'score' },
);
