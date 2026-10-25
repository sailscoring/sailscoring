import { applyStartCourse } from '@/lib/api-handlers/race-starts';
import { parseIfMatch, workspaceRoute } from '../../../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { raceId: string; startId: string };

/** Apply an ORC constructed course document, sent as it was written. Legs the
 *  start already has are replaced only with `?replace=true`. */
export const PUT = workspaceRoute<Params, unknown>(async (req, { workspace, params }) => {
  return applyStartCourse(workspace, params.raceId, params.startId, await req.text(), {
    replace: req.nextUrl.searchParams.get('replace') === 'true',
    expectedVersion: parseIfMatch(req),
  });
}, { requires: 'score' });
