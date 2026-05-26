import 'server-only';

import { readPageRequest } from '@/app/api/v1/_lib/pagination';
import {
  latestActivityPerSeries,
  listActivity,
  type ActivityEntry,
} from '@/lib/activity-log';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';

/**
 * Activity log read endpoints (#153). The write side lives in the mutation
 * handlers via `recordActivity`; these only read.
 */

/**
 * Reverse-chronological feed for the active workspace, optionally narrowed to
 * one series via `?seriesId=`. Cursor-paginated (`?cursor=&limit=`).
 */
export async function getActivityFeed(
  workspace: WorkspaceContext,
  searchParams: URLSearchParams,
): Promise<{ items: ActivityEntry[]; nextCursor: string | null }> {
  const seriesId = searchParams.get('seriesId') ?? undefined;
  const page = readPageRequest(searchParams);
  return listActivity({ workspaceId: workspace.workspaceId, seriesId, page });
}

/** Latest entry per series — feeds the series-list recency strips. */
export async function getRecentActivity(
  workspace: WorkspaceContext,
): Promise<{ items: ActivityEntry[] }> {
  return { items: await latestActivityPerSeries(workspace.workspaceId) };
}
