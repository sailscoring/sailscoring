import { submitFeedback } from '@/lib/api-handlers/feedback';
import { feedbackInputSchema } from '@/lib/validation/feedback';
import { readJson, workspaceRoute } from '../_lib/handler';

export const dynamic = 'force-dynamic';

export const POST = workspaceRoute<Record<string, never>, unknown>(
  async (req, { workspace }) => {
    const input = await readJson(req, feedbackInputSchema);
    const userAgent = req.headers.get('user-agent');
    await submitFeedback(workspace, input, userAgent);
  },
);
