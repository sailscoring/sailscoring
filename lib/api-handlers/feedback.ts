import 'server-only';
import { eq } from 'drizzle-orm';

import { BadRequestError, NotFoundError } from '@/app/api/v1/_lib/handler';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { getDb } from '@/lib/db/client';
import { organization } from '@/lib/db/schema/auth';
import { sendFeedbackEmail } from '@/lib/feedback/email';
import { countRecentForUser, recordFeedback } from '@/lib/feedback/store';
import type { FeedbackInput } from '@/lib/validation/feedback';

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 5;

export function feedbackEnabled(): boolean {
  return Boolean(process.env.FEEDBACK_TO);
}

export async function submitFeedback(
  workspace: WorkspaceContext,
  input: FeedbackInput,
  userAgent: string | null,
): Promise<void> {
  const to = process.env.FEEDBACK_TO;
  if (!to) {
    // FEEDBACK_TO is the on/off switch for the feature; the UI hides the
    // entry point when unset, but defend the API too.
    throw new NotFoundError('feedback');
  }

  const recent = await countRecentForUser(workspace.userId, RATE_LIMIT_WINDOW_MS);
  if (recent >= RATE_LIMIT_MAX) {
    throw new BadRequestError(
      `Rate limit exceeded: ${RATE_LIMIT_MAX} feedback submissions per hour. Please try again later.`,
    );
  }

  const orgRow = await getDb()
    .select({ name: organization.name, slug: organization.slug })
    .from(organization)
    .where(eq(organization.id, workspace.workspaceId))
    .limit(1);
  const workspaceName = orgRow[0]?.name ?? '(unknown)';
  const workspaceSlug = orgRow[0]?.slug ?? '(unknown)';

  await recordFeedback({
    id: crypto.randomUUID(),
    workspaceId: workspace.workspaceId,
    userId: workspace.userId,
    userEmail: workspace.email,
    message: input.message,
    pageUrl: input.pageUrl,
    userAgent,
  });

  await sendFeedbackEmail({
    to,
    userEmail: workspace.email,
    workspaceName,
    workspaceSlug,
    pageUrl: input.pageUrl,
    userAgent,
    message: input.message,
  });
}
