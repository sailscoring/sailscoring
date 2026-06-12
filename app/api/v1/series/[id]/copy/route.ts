import { copySeries } from '@/lib/api-handlers/series';
import { workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

// Copying out of the active workspace is read-level on the source — even a
// read-only member may copy a series into a workspace where they can manage
// series. The handler enforces `manage-series` on the target workspace.
export const POST = workspaceRoute<Params, unknown>(async (req, { workspace, params }) => {
  const body = await req.json();
  return copySeries(workspace, params.id, body);
}, { requires: 'read' });
