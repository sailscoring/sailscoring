import { setSeriesPublishPrefs } from '@/lib/api-handlers/series';
import type { Series } from '@/lib/types';
import { workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

// PATCH /api/v1/series/:id/publish-prefs — publish bookkeeping only (#575):
// which destination the publish dialog opens in, the FTP server it was
// pointed at, and where a completed upload put each page. Its own endpoint so
// none of it travels through the general PUT, which would replace the whole
// row, bump the version the publish indicators count, and file the write as a
// settings edit in the history.
export const PATCH = workspaceRoute<Params, Series>(
  async (req, { workspace, params }) => {
    const body = await req.json();
    return setSeriesPublishPrefs(workspace, params.id, body);
  },
  { requires: 'score' },
);
