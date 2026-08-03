import {
  checkWorldSailingIds,
  type WorldSailingCheckResult,
} from '@/lib/api-handlers/world-sailing';
import { workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

// GET /api/v1/series/:id/world-sailing-check — check the series' Sailor IDs
// against World Sailing's datafeed (gated by world-sailing-id, enforced in
// the handler). Reads only; the scorer applies any fix themselves.
export const GET = workspaceRoute<Params, WorldSailingCheckResult>(
  async (_req, { workspace, params }) => checkWorldSailingIds(workspace, params.id),
);
