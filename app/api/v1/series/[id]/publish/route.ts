import {
  getPublication,
  publishSeries,
  unpublishBySeries,
} from '@/lib/api-handlers/publish';
import type { PublicationStatus, PublishResult } from '@/lib/types';
import { publishInputSchema } from '@/lib/validation/publish';
import { readJson, workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

// The current publication state (workspace slug, suggested slug, publication if
// any) — drives the dialog's URL preview and "last published / edits since".
export const GET = workspaceRoute<Params, PublicationStatus>(
  async (_req, { workspace, params }) => getPublication(workspace, params.id),
);

// Publish the series' current state. Body: `{ slug?, overwrite? }` (slug only
// honoured on first publish). Idempotency-Key replay handled by the wrapper;
// an unchanged re-publish is also a no-op at the handler level.
export const POST = workspaceRoute<Params, PublishResult>(
  async (req, { workspace, params }) => {
    const input = await readJson(req, publishInputSchema);
    return publishSeries(workspace, params.id, input);
  },
);

// Unpublish this series' live publication — the publish dialog's convenience
// path (#164). Takes the public page down and frees the slug; the workspace
// "Published" page is canonical and the only route to orphans. No-op if the
// series was never published.
export const DELETE = workspaceRoute<Params, void>(
  async (_req, { workspace, params }) => {
    await unpublishBySeries(workspace, params.id);
  },
);
