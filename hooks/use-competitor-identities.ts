'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  distinguishCompetitorIdentities,
  listCompetitorIdentities,
  listCompetitorIdentityReview,
  mergeCompetitorIdentities,
  renameCompetitorIdentity,
  restoreCompetitorIdentity,
  setCompetitorIdentityReviewed,
  splitCompetitorIdentity,
  unlinkCompetitorIdentity,
} from '@/lib/api-repository';
import type { MergeSuggestion } from '@/lib/api-handlers/competitor-identity';
import type { StaleLink } from '@/lib/competitor-identity-reconcile';
import type {
  IdentityWithArc,
  MergeResult as IdentityMergeUndo,
} from '@/lib/competitor-identity-repository';

import { queryKeys } from './query-keys';

/** Cross-series competitor identities for the active workspace (#212). */
export function useCompetitorIdentities() {
  return useQuery<IdentityWithArc[]>({
    queryKey: queryKeys.competitorIdentities.list(),
    queryFn: () => listCompetitorIdentities(),
  });
}

/** The review queue (#221/#316): merge candidates plus stale memberships. */
export function useIdentityReviewQueue() {
  return useQuery<{ mergeSuggestions: MergeSuggestion[]; staleLinks: StaleLink[] }>({
    queryKey: queryKeys.competitorIdentities.review(),
    queryFn: () => listCompetitorIdentityReview(),
  });
}

function useInvalidateIdentities() {
  const qc = useQueryClient();
  return () =>
    qc.invalidateQueries({ queryKey: queryKeys.competitorIdentities.all });
}

export function useRenameCompetitorIdentity() {
  const invalidate = useInvalidateIdentities();
  return useMutation({
    mutationFn: ({ id, label }: { id: string; label: string }) =>
      renameCompetitorIdentity(id, label),
    onSuccess: invalidate,
  });
}

/** Peel rows onto a fresh identity (#221) — single scissor or multi-select. */
export function useSplitCompetitorIdentity() {
  const invalidate = useInvalidateIdentities();
  return useMutation({
    mutationFn: ({ id, competitorIds }: { id: string; competitorIds: string[] }) =>
      splitCompetitorIdentity(id, competitorIds),
    onSuccess: invalidate,
  });
}

/** Merge a source identity into a target (#221); resolves to the undo payload. */
export function useMergeCompetitorIdentities() {
  const invalidate = useInvalidateIdentities();
  return useMutation({
    mutationFn: ({ id, sourceId }: { id: string; sourceId: string }) =>
      mergeCompetitorIdentities(id, sourceId),
    onSuccess: invalidate,
  });
}

/** Undo a merge with the payload the merge returned. */
export function useRestoreCompetitorIdentity() {
  const invalidate = useInvalidateIdentities();
  return useMutation({
    mutationFn: (undo: IdentityMergeUndo) => restoreCompetitorIdentity(undo),
    onSuccess: invalidate,
  });
}

/** Stamp / clear a long-arc "looks right" review mark (#221). */
export function useSetIdentityReviewed() {
  const invalidate = useInvalidateIdentities();
  return useMutation({
    mutationFn: ({ id, reviewed }: { id: string; reviewed: boolean }) =>
      setCompetitorIdentityReviewed(id, reviewed),
    onSuccess: invalidate,
  });
}

/** Remove one membership (#316) — the stale-link resolution. */
export function useUnlinkIdentity() {
  const invalidate = useInvalidateIdentities();
  return useMutation({
    mutationFn: ({ identityId, competitorId }: { identityId: string; competitorId: string }) =>
      unlinkCompetitorIdentity(identityId, competitorId),
    onSuccess: invalidate,
  });
}

/** Dismiss a merge suggestion for good — the pair are different sailors. */
export function useDistinguishIdentities() {
  const invalidate = useInvalidateIdentities();
  return useMutation({
    mutationFn: ({ aId, bId }: { aId: string; bId: string }) =>
      distinguishCompetitorIdentities(aId, bId),
    onSuccess: invalidate,
  });
}
