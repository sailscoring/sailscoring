import { getSeriesStandings } from '@/lib/api-handlers/standings';
import { workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

// GET /api/v1/series/:id/standings — the computed standings as the
// public-export JSON (series, fleets, competitors, races, per-fleet
// standings). Read-only; the scored output without re-implementing the engine.
export const GET = workspaceRoute<Params, unknown>(
  async (_req, { workspace, params }) => getSeriesStandings(workspace, params.id),
);
