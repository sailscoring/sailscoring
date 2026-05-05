import 'server-only';
import { and, eq, gt, sql } from 'drizzle-orm';

import { getDb } from '@/lib/db/client';
import { feedback } from '@/lib/db/schema/series';

export interface FeedbackRow {
  id: string;
  workspaceId: string;
  userId: string;
  userEmail: string;
  message: string;
  pageUrl: string;
  userAgent: string | null;
}

export async function recordFeedback(row: FeedbackRow): Promise<void> {
  await getDb().insert(feedback).values({
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    userEmail: row.userEmail,
    message: row.message,
    pageUrl: row.pageUrl,
    userAgent: row.userAgent,
  });
}

export async function countRecentForUser(
  userId: string,
  withinMs: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - withinMs);
  const rows = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(feedback)
    .where(and(eq(feedback.userId, userId), gt(feedback.createdAt, cutoff)));
  return rows[0]?.count ?? 0;
}
