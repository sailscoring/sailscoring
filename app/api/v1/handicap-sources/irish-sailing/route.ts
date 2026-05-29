import { getIrishSailingRatings } from '@/lib/api-handlers/irish-sailing';
import { workspaceRoute } from '../../_lib/handler';

export const dynamic = 'force-dynamic';

export const GET = workspaceRoute(async (_req, { workspace }) =>
  getIrishSailingRatings(workspace),
);
