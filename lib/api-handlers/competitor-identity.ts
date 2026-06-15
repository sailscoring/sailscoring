import 'server-only';

import { NotFoundError } from '@/app/api/v1/_lib/handler';
import {
  requireFeature,
  type WorkspaceContext,
} from '@/lib/auth/require-workspace';
import {
  getIdentityArc,
  listIdentitiesWithArcs,
  renameIdentity,
  unlinkCompetitor,
  type IdentityWithArc,
} from '@/lib/competitor-identity-repository';
import {
  identityRenameSchema,
  identityUnlinkSchema,
} from '@/lib/validation/competitor-identity';

/**
 * The cross-series competitor-identity reconcile surface (#212). Every endpoint
 * is gated server-side on the `competitor-identity` feature — the routes could
 * be hit directly, so hiding the UI isn't enough.
 */

export async function listIdentities(
  workspace: WorkspaceContext,
): Promise<{ items: IdentityWithArc[] }> {
  requireFeature(workspace, 'competitor-identity');
  return { items: await listIdentitiesWithArcs(workspace.workspaceId) };
}

export async function getIdentity(
  workspace: WorkspaceContext,
  id: string,
): Promise<IdentityWithArc> {
  requireFeature(workspace, 'competitor-identity');
  const identity = await getIdentityArc(workspace.workspaceId, id);
  if (!identity) throw new NotFoundError('competitor-identity');
  return identity;
}

export async function patchIdentity(
  workspace: WorkspaceContext,
  id: string,
  body: unknown,
): Promise<IdentityWithArc> {
  requireFeature(workspace, 'competitor-identity');
  const { label } = identityRenameSchema.parse(body);
  const ok = await renameIdentity(workspace.workspaceId, id, label);
  if (!ok) throw new NotFoundError('competitor-identity');
  return getIdentity(workspace, id);
}

export async function unlinkFromIdentity(
  workspace: WorkspaceContext,
  id: string,
  body: unknown,
): Promise<IdentityWithArc> {
  requireFeature(workspace, 'competitor-identity');
  const { competitorId } = identityUnlinkSchema.parse(body);
  const ok = await unlinkCompetitor(workspace.workspaceId, id, competitorId);
  if (!ok) throw new NotFoundError('competitor-identity-link');
  return getIdentity(workspace, id);
}
