import { listSeries } from '@/lib/api-handlers/series';
import { workspaceRoute } from '../_lib/handler';

export const dynamic = 'force-dynamic';

export const GET = workspaceRoute(async (_req, { workspace }) => listSeries(workspace));
