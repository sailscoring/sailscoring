import { reorderRaces } from '@/lib/api-handlers/races';
import { workspaceRoute } from '../../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

// POST /api/v1/series/:id/races/reorder — body `{ orderedIds: string[] }`.
// Renumbers the series' races 1..n to match. The static `reorder` segment
// takes precedence over the sibling `[raceId]` dynamic route.
export const POST = workspaceRoute<Params, unknown>(
  async (req, { workspace, params }) => {
    return reorderRaces(workspace, params.id, await req.json());
  },
  { requires: 'score' },
);
