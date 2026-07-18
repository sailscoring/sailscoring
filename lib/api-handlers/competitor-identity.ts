import 'server-only';

import { BadRequestError, NotFoundError } from '@/app/api/v1/_lib/handler';
import {
  requireFeature,
  type WorkspaceContext,
} from '@/lib/auth/require-workspace';
import { clusterCompetitors } from '@/lib/competitor-identity-cluster';
import { collectClusterInputs, collectStaleLinks, type StaleLink } from '@/lib/competitor-identity-reconcile';
import {
  addIdentityDistinction,
  getIdentityArc,
  getIdentityJurisdictions,
  listIdentitiesWithArcs,
  listIdentityDistinctions,
  mergeIdentities,
  removeIdentityLink,
  renameIdentity,
  restoreIdentity,
  setIdentityReviewed,
  splitIdentity,
  type IdentityWithArc,
  type MergeResult,
} from '@/lib/competitor-identity-repository';
import { getDb } from '@/lib/db/client';
import {
  identityDistinctionSchema,
  identityMergeSchema,
  identityUnlinkSchema,
  identityRenameSchema,
  identityRestoreSchema,
  identityReviewedSchema,
  identitySplitSchema,
} from '@/lib/validation/competitor-identity';

/**
 * The cross-series competitor-identity reconcile surface (#212, #221). Every
 * endpoint is gated server-side on the `competitor-reconcile` feature — the
 * routes could be hit directly, so hiding the UI isn't enough. This is the
 * in-app gate, distinct from the public `competitor-identity` feature that
 * governs the public competitor pages.
 */

/** Jurisdiction guard (ADR-010): the named operation only applies to
 *  app-managed identities — archive-managed ones belong to the archive
 *  repo's manifest. 404s for ids not in the workspace. */
async function assertAppManaged(
  workspace: WorkspaceContext,
  ids: string[],
  operation: string,
): Promise<void> {
  const jurisdictions = await getIdentityJurisdictions(
    workspace.workspaceId,
    ids,
  );
  for (const id of ids) {
    const managedBy = jurisdictions.get(id);
    if (!managedBy) throw new NotFoundError('competitor-identity');
    if (managedBy === 'archive') {
      throw new BadRequestError(
        `${operation} is managed by the results archive — correct it in the archive repo`,
        { code: 'archive-managed' },
      );
    }
  }
}

export async function listIdentities(
  workspace: WorkspaceContext,
): Promise<{ items: IdentityWithArc[] }> {
  requireFeature(workspace, 'competitor-reconcile');
  return { items: await listIdentitiesWithArcs(workspace.workspaceId) };
}

export async function getIdentity(
  workspace: WorkspaceContext,
  id: string,
): Promise<IdentityWithArc> {
  requireFeature(workspace, 'competitor-reconcile');
  const identity = await getIdentityArc(workspace.workspaceId, id);
  if (!identity) throw new NotFoundError('competitor-identity');
  return identity;
}

export async function patchIdentity(
  workspace: WorkspaceContext,
  id: string,
  body: unknown,
): Promise<IdentityWithArc> {
  requireFeature(workspace, 'competitor-reconcile');
  const { label } = identityRenameSchema.parse(body);
  await assertAppManaged(workspace, [id], 'this competitor’s name');
  const ok = await renameIdentity(workspace.workspaceId, id, label);
  if (!ok) throw new NotFoundError('competitor-identity');
  return getIdentity(workspace, id);
}

/**
 * Peel competitor rows off an identity onto a fresh identity (#221) — the
 * one-row scissor and the cluster-level peel alike. The peeled rows land on a
 * new *confirmed* identity, so the automatic pass never re-fuses the split.
 */
export async function splitFromIdentity(
  workspace: WorkspaceContext,
  id: string,
  body: unknown,
): Promise<{ identity: IdentityWithArc; newIdentityId: string }> {
  requireFeature(workspace, 'competitor-reconcile');
  const { competitorIds } = identitySplitSchema.parse(body);
  const newIdentityId = await splitIdentity(
    workspace.workspaceId,
    id,
    competitorIds,
  );
  if (!newIdentityId) {
    throw new BadRequestError(
      'split must leave at least one entry behind, every selected entry must still belong to this competitor, and archive entries are corrected in the archive repo',
    );
  }
  return { identity: await getIdentity(workspace, id), newIdentityId };
}

/**
 * Merge `sourceId` into `id` (#221). Returns the merged identity plus the
 * undo payload — the client posts it back to `restoreMergedIdentity` verbatim
 * to unpick the merge.
 */
export async function mergeIntoIdentity(
  workspace: WorkspaceContext,
  id: string,
  body: unknown,
): Promise<{ identity: IdentityWithArc; undo: MergeResult }> {
  requireFeature(workspace, 'competitor-reconcile');
  const { sourceId } = identityMergeSchema.parse(body);
  // The archive identity always survives a merge (ADR-010): git would
  // recreate a dissolved one on the next ingest and fight the UI.
  await assertAppManaged(workspace, [sourceId], 'this competitor record');
  const result = await mergeIdentities(workspace.workspaceId, id, sourceId);
  if (!result) throw new NotFoundError('competitor-identity');
  return { identity: await getIdentity(workspace, id), undo: result };
}

/**
 * Remove one membership (#316) — the review queue's stale-link resolution.
 * Archive-managed identities are git's to correct (ADR-010).
 */
export async function unlinkIdentity(
  workspace: WorkspaceContext,
  id: string,
  body: unknown,
): Promise<{ removed: boolean }> {
  requireFeature(workspace, 'competitor-reconcile');
  const { competitorId } = identityUnlinkSchema.parse(body);
  await assertAppManaged(workspace, [id], 'this competitor record');
  const removed = await removeIdentityLink(workspace.workspaceId, competitorId, id);
  if (!removed) throw new NotFoundError('competitor-identity-link');
  return { removed };
}

/** Undo a merge: the body is exactly what the merge endpoint returned. */
export async function restoreMergedIdentity(
  workspace: WorkspaceContext,
  body: unknown,
): Promise<{ identity: IdentityWithArc }> {
  requireFeature(workspace, 'competitor-reconcile');
  const { source, movedCompetitorIds } = identityRestoreSchema.parse(body);
  await restoreIdentity(workspace.workspaceId, source, movedCompetitorIds);
  return { identity: await getIdentity(workspace, source.id) };
}

/** Stamp or clear the review queue's "looks right" mark (#221). */
export async function reviewIdentity(
  workspace: WorkspaceContext,
  id: string,
  body: unknown,
): Promise<IdentityWithArc> {
  requireFeature(workspace, 'competitor-reconcile');
  const { reviewed } = identityReviewedSchema.parse(body);
  await assertAppManaged(workspace, [id], 'this competitor’s review state');
  const ok = await setIdentityReviewed(workspace.workspaceId, id, reviewed);
  if (!ok) throw new NotFoundError('competitor-identity');
  return getIdentity(workspace, id);
}

/** Record two identities as confirmed different sailors (#221) — dismisses
 *  their merge suggestion for good. */
export async function distinguishIdentities(
  workspace: WorkspaceContext,
  body: unknown,
): Promise<{ ok: true }> {
  requireFeature(workspace, 'competitor-reconcile');
  const { aId, bId } = identityDistinctionSchema.parse(body);
  // At least one side must be app-managed — an archive-archive judgement
  // belongs in the manifest (its pairs never surface here anyway).
  const jurisdictions = await getIdentityJurisdictions(workspace.workspaceId, [
    aId,
    bId,
  ]);
  if (
    jurisdictions.get(aId) === 'archive' &&
    jurisdictions.get(bId) === 'archive'
  ) {
    throw new BadRequestError(
      'both records are managed by the results archive — record the distinction in the archive repo',
      { code: 'archive-managed' },
    );
  }
  const ok = await addIdentityDistinction(workspace.workspaceId, aId, bId);
  if (!ok) throw new NotFoundError('competitor-identity');
  return { ok: true };
}

/** A matcher edge between two existing identities, for the review queue. */
export interface MergeSuggestion {
  aId: string;
  bId: string;
  reason: string;
}

/**
 * The review queue's merge-candidate half (#221): run the same clustering the
 * reconcile pass uses and lift its weak (name-only) suggestion edges to pairs
 * of existing identities, minus the pairs a human has already dismissed as
 * different sailors. (The split-candidate half — long arcs — is computed
 * client-side from the identity list, which carries `reviewedAt`.)
 */
export async function reviewQueue(
  workspace: WorkspaceContext,
): Promise<{ mergeSuggestions: MergeSuggestion[]; staleLinks: StaleLink[] }> {
  requireFeature(workspace, 'competitor-reconcile');
  const inputs = await collectClusterInputs(getDb(), workspace.workspaceId);
  const { clusters, suggestions } = clusterCompetitors(inputs);
  const dismissed = await listIdentityDistinctions(workspace.workspaceId);

  const candidates: MergeSuggestion[] = [];
  const seen = new Set<string>();
  for (const edge of suggestions) {
    const a = clusters[edge.a].existingIdentityIds;
    const b = clusters[edge.b].existingIdentityIds;
    // Only edges between two settled identities are actionable as a merge —
    // conflict clusters and still-unlinked rows are out of scope here.
    if (a.length !== 1 || b.length !== 1 || a[0] === b[0]) continue;
    const [aId, bId] = a[0] < b[0] ? [a[0], b[0]] : [b[0], a[0]];
    const key = `${aId}:${bId}`;
    if (dismissed.has(key) || seen.has(key)) continue;
    seen.add(key);
    candidates.push({ aId, bId, reason: edge.reason });
  }
  // A pair of archive-managed identities is the archive manifest's to judge
  // (ADR-010) — surfacing it here would re-litigate git's record.
  const jurisdictions = await getIdentityJurisdictions(
    workspace.workspaceId,
    [...new Set(candidates.flatMap((c) => [c.aId, c.bId]))],
  );
  const mergeSuggestions = candidates.filter(
    (c) =>
      jurisdictions.get(c.aId) !== 'archive' ||
      jurisdictions.get(c.bId) !== 'archive',
  );

  // Stale memberships (#316): a link whose identity label matches no person
  // on its (multi-person) row — a rename walked away from the link, or a
  // pre-list joined-name identity still attached. Never auto-unlinked; a
  // human resolves each. Archive-managed identities are git's to judge.
  const allStale = await collectStaleLinks(getDb(), workspace.workspaceId);
  const staleJurisdictions = await getIdentityJurisdictions(
    workspace.workspaceId,
    [...new Set(allStale.map((l) => l.identityId))],
  );
  const staleLinks = allStale.filter(
    (l) => staleJurisdictions.get(l.identityId) !== 'archive',
  );
  return { mergeSuggestions, staleLinks };
}
