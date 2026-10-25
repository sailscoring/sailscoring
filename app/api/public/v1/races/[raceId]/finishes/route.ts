import { listFinishesPublic } from '@/lib/api-handlers/public-v1';
import { publicPreflight, publicRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { raceId: string };

export const GET = publicRoute<Params>(
  async (_req, { workspace, params }) => listFinishesPublic(workspace, params.raceId),
  { scope: 'read', requires: 'read' },
);

export const OPTIONS = publicPreflight;
