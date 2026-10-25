import { deleteRacePublic, getRacePublic } from '@/lib/api-handlers/public-v1';
import { publicPreflight, publicRoute } from '../../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string; raceId: string };

export const GET = publicRoute<Params>(
  async (_req, { workspace, params }) => getRacePublic(workspace, params.id, params.raceId),
  { scope: 'read', requires: 'read' },
);

export const DELETE = publicRoute<Params>(
  async (_req, { workspace, params }) => deleteRacePublic(workspace, params.id, params.raceId),
  { scope: 'races', requires: 'score' },
);

export const OPTIONS = publicPreflight;
