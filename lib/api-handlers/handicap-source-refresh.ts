import 'server-only';

import { revalidateTag } from 'next/cache';

import { RateLimitedError } from '@/app/api/v1/_lib/handler';
import { requirePermission, type WorkspaceContext } from '@/lib/auth/require-workspace';
import { recordActivity } from '@/lib/activity-log';

/**
 * Forcing a cached handicap source to refetch (#594).
 *
 * The four external feeds — ORC certificates, the IRC listing, Irish Sailing
 * ECHO, VPRS — are served through a six-hour cache. That is right for the
 * ordinary case, where a scorer seeds a series a handful of times, and wrong
 * for the one that matters: ORC amends certificates through the season and
 * IRC re-rates after protests, so a scorer who *knows* a certificate was
 * reissued this morning had no way to say so. Waiting out the window, a
 * redeploy, or a CLI invalidation only the operator can run were the options.
 *
 * Two things make this safe to expose.
 *
 * **Who.** Refetching hits someone else's server, so it takes
 * `manage-workspace` — the same bar as the FTP credentials the same dialog
 * holds — rather than being available to anyone who can score.
 *
 * **How often.** One forced refetch per source per minute. The counter is
 * per process rather than shared: a serverless instance is reused across
 * requests, so this holds in practice, and the point is to stop a held-down
 * button hammering data.orc.org rather than to enforce a quota. A refresh
 * that slips through on a second instance costs one extra upstream fetch.
 */
const REFRESH_INTERVAL_MS = 60_000;

const lastRefreshAt = new Map<string, number>();

/** Seconds the caller must wait, or 0 when the refresh may go ahead. */
function throttleFor(key: string): number {
  const previous = lastRefreshAt.get(key);
  if (previous === undefined) return 0;
  const elapsed = Date.now() - previous;
  if (elapsed >= REFRESH_INTERVAL_MS) return 0;
  return Math.ceil((REFRESH_INTERVAL_MS - elapsed) / 1000);
}

/**
 * Clear a source's cache entry so the read that follows goes upstream, and
 * leave a trail in the activity log.
 *
 * `key` identifies what is being refreshed for throttling and for the log —
 * the ORC feed is cached per country and family, so refreshing Irish
 * certificates should not make a scorer wait to refresh British ones.
 *
 * `{ expire: 0 }` is the load-bearing part. `revalidateTag` ordinarily marks
 * an entry stale and keeps serving it while a revalidation runs behind — so a
 * scorer who pressed Refresh would be handed the old listing once and
 * reasonably conclude the button does nothing. With a zero window no stale
 * content is served, and the read that follows is a blocking miss that goes
 * upstream. That is the whole point of the button, so it is worth the wait.
 */
export async function forceSourceRefresh(
  workspace: WorkspaceContext,
  input: { tag: string; key: string; label: string },
): Promise<void> {
  requirePermission(workspace, 'manage-workspace');
  const wait = throttleFor(input.key);
  if (wait > 0) throw new RateLimitedError(wait);
  lastRefreshAt.set(input.key, Date.now());

  revalidateTag(input.tag, { expire: 0 });

  // A rating that changes under a scorer is exactly the surprise the log
  // exists to explain, so the refresh that caused it is in the feed beside
  // the handicap update that follows it.
  await recordActivity(workspace, {
    action: 'handicaps.source-refreshed',
    summary: `Refreshed ${input.label} from source`,
  });
}

/** Whether a request asked for a forced refetch. */
export function wantsRefresh(value: string | null): boolean {
  return value === '1' || value === 'true';
}
