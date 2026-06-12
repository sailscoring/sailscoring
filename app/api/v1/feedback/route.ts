import { submitFeedback } from '@/lib/api-handlers/feedback';
import { feedbackInputSchema } from '@/lib/validation/feedback';
import { readJson, workspaceRoute } from '../_lib/handler';

export const dynamic = 'force-dynamic';

// Feedback is user-scoped, not a workspace write — any signed-in role,
// including read-only members, may send it.
export const POST = workspaceRoute<Record<string, never>, unknown>(
  async (req, { workspace }) => {
    const input = await readJson(req, feedbackInputSchema);
    const userAgent = req.headers.get('user-agent');
    await submitFeedback(workspace, input, userAgent);
  },
  { requires: 'read' },
);
