import { recordFtpUpload } from '@/lib/api-handlers/publish';
import type { Series } from '@/lib/types';
import { ftpUploadInputSchema } from '@/lib/validation/publish';
import { readJson, workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

// POST /api/v1/series/:id/ftp-upload — the pages this upload put on a club's
// own web server. The upload itself runs in the browser against the
// scupper relay, so this call is the only account of it: it stores where each
// page went and records the upload as a publishing act, with the same
// activity entry, pinned revision and session seal an in-app publish gets.
export const POST = workspaceRoute<Params, Series>(
  async (req, { workspace, params }) => {
    const input = await readJson(req, ftpUploadInputSchema);
    return recordFtpUpload(workspace, params.id, input);
  },
  { requires: 'score' },
);
