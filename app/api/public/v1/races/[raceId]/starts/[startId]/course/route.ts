import { applyCoursePublic } from '@/lib/api-handlers/public-v1';
import { ifMatch, publicPreflight, publicRoute } from '../../../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { raceId: string; startId: string };

/** Apply an ORC constructed course document, as written; legs the start
 *  already has are replaced only with `?replace=true`. */
export const PUT = publicRoute<Params>(
  async (req, { workspace, params }) =>
    applyCoursePublic(workspace, params.raceId, params.startId, await req.text(), {
      replace: req.nextUrl.searchParams.get('replace') === 'true',
      expectedVersion: ifMatch(req),
    }),
  { scope: 'races', requires: 'score' },
);

export const OPTIONS = publicPreflight;
