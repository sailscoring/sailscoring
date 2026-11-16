import { removeRecording, sendRecording } from '@/lib/voice/server/handlers';
import { putRecordingSchema } from '@/lib/voice/validation';
import { readJson, workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { recordingId: string };

/** Send a voice recording's list of calls with its finish sheet, or bring
 *  it up to date. The answer says which pieces of sound have arrived. */
export const PUT = workspaceRoute<Params, unknown>(async (req, { workspace, params }) =>
  sendRecording(workspace, params.recordingId, await readJson(req, putRecordingSchema)),
{ requires: 'submit-finishes' });

/** Delete a recording: whoever made it, or a scorer. The handler decides
 *  which, so the route asks only for membership. */
export const DELETE = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) =>
  removeRecording(workspace, params.recordingId),
{ requires: 'read' });
