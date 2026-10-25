import { listSeriesPublic } from '@/lib/api-handlers/public-v1';
import { publicPreflight, publicRoute } from '../_lib/handler';

export const dynamic = 'force-dynamic';

export const GET = publicRoute(async (_req, { workspace }) => listSeriesPublic(workspace), {
  scope: 'read',
  requires: 'read',
});

export const OPTIONS = publicPreflight;
