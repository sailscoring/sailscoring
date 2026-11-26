import { listLeftoverPages } from '@/lib/api-handlers/publish';
import type { PublishResult } from '@/lib/types';
import { workspaceRoute } from '../../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

// The live pages of this series' publication that a publish no longer
// rebuilds — what the publish dialog offers to take down. Its own request
// rather than part of the publication status, because answering it means
// building the series' pages, and the dialog shouldn't wait on that to open.
export const GET = workspaceRoute<Params, PublishResult['pages']>(
  async (_req, { workspace, params }) => listLeftoverPages(workspace, params.id),
);
