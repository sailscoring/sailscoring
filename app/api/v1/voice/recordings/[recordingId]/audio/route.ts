import { listenToSegments, sendSegments } from '@/lib/voice/server/handlers';
import { putSegmentsSchema } from '@/lib/voice/validation';
import { readJson, workspaceRoute } from '../../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { recordingId: string };

/** Pieces of one take's sound: `?take=0&from=12&to=13`. */
export const GET = workspaceRoute<Params, unknown>(async (req, { workspace, params }) => {
  const query = req.nextUrl.searchParams;
  const number = (name: string) => Number(query.get(name) ?? Number.NaN);
  return listenToSegments(workspace, params.recordingId, {
    take: number('take'),
    from: number('from'),
    to: number('to'),
  });
});

/** Send pieces of a recording's sound. */
export const PUT = workspaceRoute<Params, unknown>(async (req, { workspace, params }) =>
  sendSegments(workspace, params.recordingId, await readJson(req, putSegmentsSchema)),
{ requires: 'submit-finishes' });
