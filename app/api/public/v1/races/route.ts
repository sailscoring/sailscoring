import { listRacesOnDatePublic } from '@/lib/api-handlers/public-v1';
import { publicPreflight, publicRoute } from '../_lib/handler';

export const dynamic = 'force-dynamic';

export const GET = publicRoute(
  async (req, { workspace }) => listRacesOnDatePublic(workspace, req.nextUrl.searchParams.get('date')),
  { scope: 'read', requires: 'read' },
);

export const OPTIONS = publicPreflight;
