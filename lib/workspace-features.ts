/**
 * Server-side reads of a workspace's own `organization.metadata`: its feature
 * flags — the gate the public `/p/...` pages use — and its home club.
 * Deliberately the workspace's own metadata, not `computeEffectiveFeatures`:
 * what a workspace publishes is governed by what it has adopted itself, never
 * by flags a viewer might inherit elsewhere. Not `server-only` so CLI scripts
 * can share it.
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

/**
 * The workspace's home club (#507), or null when unset. In a club's own
 * workspace most competitors carry no club — everyone is assumed to be a
 * member, and only visitors to open events get the field filled in — so the
 * identity pass reads a blank club as this one. Nothing else reads it: the
 * assumption must never be written onto a competitor row.
 */
export async function workspaceHomeClub(
  db: SailScoringDb,
  workspaceId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ metadata: organization.metadata, slug: organization.slug })
    .from(organization)
    .where(eq(organization.id, workspaceId))
    .limit(1);
  if (!row) return null;
  return parseOrgMetadata(row.metadata, row.slug).homeClub ?? null;
}
