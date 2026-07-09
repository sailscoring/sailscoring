/**
 * Server-side check of a workspace's *own* feature flags — the gate the
 * public `/p/...` pages use. Deliberately the workspace's own metadata, not
 * `computeEffectiveFeatures`: what a workspace publishes is governed by what
 * it has adopted itself, never by flags a viewer might inherit elsewhere.
 * Not `server-only` so CLI scripts can share it.
 */

import { eq } from 'drizzle-orm';

import type { SailScoringDb } from '@/lib/db/client';
import { organization } from '@/lib/db/schema/auth';
import { parseOrgMetadata, type FeatureKey } from '@/lib/features';

export async function workspaceOwnFeatureOn(
  db: SailScoringDb,
  workspaceId: string,
  key: FeatureKey,
): Promise<boolean> {
  const [row] = await db
    .select({ metadata: organization.metadata, slug: organization.slug })
    .from(organization)
    .where(eq(organization.id, workspaceId))
    .limit(1);
  if (!row) return false;
  return parseOrgMetadata(row.metadata, row.slug).enabledFeatures.includes(key);
}
