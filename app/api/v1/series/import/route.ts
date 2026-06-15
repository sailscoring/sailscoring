import { importSeries } from '@/lib/api-handlers/series';
import { workspaceRoute } from '../../_lib/handler';

export const dynamic = 'force-dynamic';

// POST /api/v1/series/import — body `{ content: string }` (the raw
// .sailscoring file text). Imports it as a new series in the active
// workspace (fresh ids, disambiguated name). Send an Idempotency-Key per
// file to make a bulk run resumable. Static segment, so it takes precedence
// over /series/[id].
export const POST = workspaceRoute<Record<string, never>, { id: string }>(
  async (req, { workspace }) => {
    return importSeries(workspace, await req.json());
  },
);
