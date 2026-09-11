import { retractPage } from '@/lib/api-handlers/publish';
import { workspaceRoute } from '../../../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string; subPath: string[] };

// Retract one page of this series' publication, leaving the rest of it live —
// what lets a published page's frozen URL be changed (#561).
//
// Its own route rather than a parameter on the publication's DELETE: a dropped
// or mistyped parameter there would mean "unpublish everything", and the two
// requests should not be one keystroke apart. The target is a path rather than
// a query string because a sub-series page's sub-path carries a slash
// (`{block}/{leaf}`).
export const DELETE = workspaceRoute<Params, void>(
  async (_req, { workspace, params }) => {
    await retractPage(workspace, params.id, params.subPath.join('/'));
  },
  { requires: 'score' },
);
