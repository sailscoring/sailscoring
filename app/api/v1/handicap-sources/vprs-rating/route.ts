import { getVprsClubRatings } from '@/lib/api-handlers/vprs-rating';
import { workspaceRoute } from '../../_lib/handler';

export const dynamic = 'force-dynamic';

// `?club=<id>` selects which club listing to fetch; the id is validated against
// the cached club index in the handler.
export const GET = workspaceRoute(async (req, { workspace }) => {
  const clubId = new URL(req.url).searchParams.get('club') ?? '';
  return getVprsClubRatings(workspace, clubId);
});
