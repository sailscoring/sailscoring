import { getIrcRatings } from '@/lib/api-handlers/irc-rating';
import { wantsRefresh } from '@/lib/api-handlers/handicap-source-refresh';
import { workspaceRoute } from '../../_lib/handler';

export const dynamic = 'force-dynamic';

// `?refresh=1` forces a refetch, bypassing the six-hour cache (#594). It takes
// `manage-workspace` and is throttled, because it reaches someone else's
// server.
export const GET = workspaceRoute(async (req, { workspace }) =>
  getIrcRatings(workspace, {
    refresh: wantsRefresh(new URL(req.url).searchParams.get('refresh')),
  }),
);
