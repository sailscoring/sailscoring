import {
  getSubmissionPublic,
  submitFinishesPublic,
  withdrawSubmissionPublic,
} from '@/lib/api-handlers/public-v1';
import { submitFinishesInput } from '@/lib/validation/public-api-v1-authenticated';
import { publicPreflight, publicRoute, readBody } from '../../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { raceId: string; submissionId: string };

const options = { scope: 'submissions', requires: 'submit-finishes' } as const;

export const GET = publicRoute<Params>(
  async (_req, { workspace, params }) => getSubmissionPublic(workspace, params.raceId, params.submissionId),
  options,
);

/** Submit the race's finishes, or revise a submission: the whole recording,
 *  at a higher revision. The app chooses the id. */
export const PUT = publicRoute<Params>(
  async (req, { workspace, params }) =>
    submitFinishesPublic(workspace, params.raceId, params.submissionId, await readBody(req, submitFinishesInput)),
  options,
);

/** Withdraw one's own submission. */
export const DELETE = publicRoute<Params>(
  async (_req, { workspace, params }) => withdrawSubmissionPublic(workspace, params.raceId, params.submissionId),
  options,
);

export const OPTIONS = publicPreflight;
