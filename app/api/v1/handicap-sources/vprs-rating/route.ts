import { getVprsClubRatings } from '@/lib/api-handlers/vprs-rating';
import { wantsRefresh } from '@/lib/api-handlers/handicap-source-refresh';
import { workspaceRoute } from '../../_lib/handler';

export const dynamic = 'force-dynamic';

// `?club=<id>` selects which club listing to fetch; the id is validated against
// the cached club index in the handler.
// `?refresh=1` forces a refetch, bypassing the six-hour cache (#594). It takes
// `manage-workspace` and is throttled, because it reaches someone else's
// server.
export const GET = workspaceRoute(async (req, { workspace }) => {
  const params = new URL(req.url).searchParams;
  return getVprsClubRatings(workspace, params.get('club') ?? '', {
    refresh: wantsRefresh(params.get('refresh')),
  });
});
