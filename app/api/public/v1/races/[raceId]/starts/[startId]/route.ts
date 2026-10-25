import { deleteStartPublic, patchStartPublic } from '@/lib/api-handlers/public-v1';
import { startPatchInput } from '@/lib/validation/public-api-v1-authenticated';
import { ifMatch, publicPreflight, publicRoute, readBody } from '../../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { raceId: string; startId: string };

/** Change the gun time or the fleets; a field left out keeps its value. */
export const PATCH = publicRoute<Params>(
  async (req, { workspace, params }) =>
    patchStartPublic(workspace, params.raceId, params.startId, await readBody(req, startPatchInput), ifMatch(req)),
  { scope: 'races', requires: 'score' },
);

export const DELETE = publicRoute<Params>(
  async (_req, { workspace, params }) => deleteStartPublic(workspace, params.raceId, params.startId),
  { scope: 'races', requires: 'score' },
);

export const OPTIONS = publicPreflight;
