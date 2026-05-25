import { getPublication, publishSeries } from '@/lib/api-handlers/publish';
import type { PublishResult } from '@/lib/types';
import { workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

// The current publication (or null/204 if never published) — drives the
// dialog's "last published / edits since" view.
export const GET = workspaceRoute<Params, PublishResult | null>(
  async (_req, { workspace, params }) => getPublication(workspace, params.id),
);

// Publish takes no body — it renders the series' current state. Idempotency-Key
// replay is handled by the wrapper; an unchanged re-publish is also a no-op at
// the handler level (same content hash ⇒ blobs untouched).
export const POST = workspaceRoute<Params, PublishResult>(
  async (_req, { workspace, params }) => publishSeries(workspace, params.id),
);
