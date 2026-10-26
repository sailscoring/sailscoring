import { reviewSubmission } from '@/lib/api-handlers/finish-submissions';
import { reviewSubmissionSchema } from '@/lib/validation/finish-submission';
import { readJson, workspaceRoute } from '../../../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { raceId: string; submissionId: string };

/** The scorer's decision on one revision: `applied` once its finishes are
 *  written to the sheet, or `dismissed`. */
export const POST = workspaceRoute<Params, unknown>(async (req, { workspace, params }) =>
  reviewSubmission(workspace, params.raceId, params.submissionId, await readJson(req, reviewSubmissionSchema)),
{ requires: 'score' });
