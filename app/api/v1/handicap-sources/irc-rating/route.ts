import { getIrcRatings } from '@/lib/api-handlers/irc-rating';
import { workspaceRoute } from '../../_lib/handler';

export const dynamic = 'force-dynamic';

export const GET = workspaceRoute(async (_req, { workspace }) => getIrcRatings(workspace));
