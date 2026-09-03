import { importSeries } from '@/lib/api-handlers/series';
import { workspaceRoute } from '../../_lib/handler';

export const dynamic = 'force-dynamic';

// POST /api/v1/series/import — body `{ content: string, format?:
// 'sailscoring' | 'public-export' }`: the raw text of a `.sailscoring` file
// (the default) or of a publication's `.sailscoring.json`. Imports it as a
// new series in the active workspace (fresh ids, disambiguated name), in one
// transaction. Send an Idempotency-Key per document to make a bulk run
// resumable. Static segment, so it takes precedence over /series/[id].
export const POST = workspaceRoute<Record<string, never>, { id: string }>(
  async (req, { workspace }) => {
    return importSeries(workspace, await req.json());
  },
);
