import { pushCompetitorsToRrsOrg, type RrsOrgPushResult } from '@/lib/api-handlers/rrs-org';
import { workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

// POST /api/v1/series/:id/rrs-org-push — push the competitor list to an
// rrs.org event (gated by the rrs-import feature, enforced in the handler).
// A publishing-shaped race-day operation, so scorers may do it.
export const POST = workspaceRoute<Params, RrsOrgPushResult>(
  async (req, { workspace, params }) => {
    const body = await req.json();
    return pushCompetitorsToRrsOrg(workspace, params.id, body);
  },
  { requires: 'score' },
);
