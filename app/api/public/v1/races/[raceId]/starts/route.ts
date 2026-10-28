import { addStartPublic } from '@/lib/api-handlers/public-v1';
import { addStartInput } from '@/lib/validation/public-api-v1-authenticated';
import { publicPreflight, publicRoute, readBody } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { raceId: string };

/** Add a start to the race, for fleets no other start of it has. */
export const POST = publicRoute<Params>(
  async (req, { workspace, params }) => addStartPublic(workspace, params.raceId, await readBody(req, addStartInput)),
  { scope: 'races', requires: 'score' },
);

export const OPTIONS = publicPreflight;
