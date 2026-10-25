import { getSeriesPublic } from '@/lib/api-handlers/public-v1';
import { publicPreflight, publicRoute } from '../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

export const GET = publicRoute<Params>(async (_req, { workspace, params }) => getSeriesPublic(workspace, params.id), {
  scope: 'read',
  requires: 'read',
});

export const OPTIONS = publicPreflight;
