import 'server-only';

import { and, eq, isNotNull } from 'drizzle-orm';

import {
  relinkIdentitiesBestEffort,
  sweepOrphanIdentitiesBestEffort,
} from '@/lib/competitor-identity-reconcile';
import { workspaceHasCompetitors } from '@/lib/competitor-identity-repository';
import { getDb } from '@/lib/db/client';
import { competitorIdentities } from '@/lib/db/schema/series';
import { purgePublishedCache } from '@/lib/published-cache';

/**
 * The identity passes a handler runs after its own write commits: the lazy
 * relink after competitors are written, the orphan sweep after they're
 * deleted. Both are best effort and never fail the write they follow.
 *
 * They also keep the public workspace listing honest. It links to the
 * competitor index only while the workspace has a competitor to show, so the
 * link appears with the first identity and goes with the last. The listing
 * stays in the CDN until something purges it, so these purge on exactly
 * those two changes. They don't purge on every pass: the lazy relink runs
 * after every competitor write on race day, and the competitor pages it does
 * change are only cached briefly.
 */

/** Relink after competitors were written. */
export async function relinkIdentitiesAfterCompetitorWrite(workspaceId: string): Promise<void> {
  const result = await relinkIdentitiesBestEffort(workspaceId);
  if (!result || result.identitiesCreated === 0) return;
  // Only the first identities make the link appear. If there were already
  // others, nothing on the listing changed.
  if (await isFirstIdentities(workspaceId, result.identitiesCreated)) {
    await purgePublishedCache(workspaceId);
  }
}

/** Sweep the identities that a delete left with no competitors. */
export async function sweepIdentitiesAfterCompetitorDelete(workspaceId: string): Promise<void> {
  const removed = await sweepOrphanIdentitiesBestEffort(workspaceId);
  if (removed > 0 && !(await workspaceHasCompetitors(workspaceId))) {
    await purgePublishedCache(workspaceId);
  }
}

/** Whether the identities a pass just created are the workspace's only
 *  ones that have a slug. Reads at most one row more than were created. */
async function isFirstIdentities(workspaceId: string, created: number): Promise<boolean> {
  const rows = await getDb()
    .select({ id: competitorIdentities.id })
    .from(competitorIdentities)
    .where(
      and(
        eq(competitorIdentities.workspaceId, workspaceId),
        isNotNull(competitorIdentities.slug),
      ),
    )
    .limit(created + 1);
  return rows.length <= created;
}
