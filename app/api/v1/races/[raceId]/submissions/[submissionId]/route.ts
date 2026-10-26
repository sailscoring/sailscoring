import {
  getSubmissionForRace,
  submitFinishes,
  withdrawSubmission,
} from '@/lib/api-handlers/finish-submissions';
import { submitFinishesSchema } from '@/lib/validation/finish-submission';
import { readJson, workspaceRoute } from '../../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { raceId: string; submissionId: string };

export const GET = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) =>
  getSubmissionForRace(workspace, params.raceId, params.submissionId),
);

/** Submit a recording of the race's finishes, or revise one: the whole
 *  recording, at a higher revision. */
export const PUT = workspaceRoute<Params, unknown>(async (req, { workspace, params }) =>
  submitFinishes(workspace, params.raceId, params.submissionId, await readJson(req, submitFinishesSchema)),
{ requires: 'submit-finishes' });

/** Withdraw one's own submission. */
export const DELETE = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) =>
  withdrawSubmission(workspace, params.raceId, params.submissionId),
{ requires: 'submit-finishes' });
