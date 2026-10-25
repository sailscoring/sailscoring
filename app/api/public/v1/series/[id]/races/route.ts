import { createRacesPublic, listRacesPublic } from '@/lib/api-handlers/public-v1';
import { createRacesInput } from '@/lib/validation/public-api-v1-authenticated';
import { publicPreflight, publicRoute, readBody } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

export const GET = publicRoute<Params>(async (_req, { workspace, params }) => listRacesPublic(workspace, params.id), {
  scope: 'read',
  requires: 'read',
});

/** Add races, with their starts, after the series' last race. */
export const POST = publicRoute<Params>(
  async (req, { workspace, params }) =>
    createRacesPublic(workspace, params.id, await readBody(req, createRacesInput)),
  { scope: 'races', requires: 'score' },
);

export const OPTIONS = publicPreflight;
