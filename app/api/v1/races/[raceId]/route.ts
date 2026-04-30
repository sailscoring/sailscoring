import { getRaceFlat } from '@/lib/api-handlers/races';
import { NotFoundError, workspaceRoute } from '../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { raceId: string };

export const GET = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  const race = await getRaceFlat(workspace, params.raceId);
  if (!race) throw new NotFoundError('race');
  return race;
});
