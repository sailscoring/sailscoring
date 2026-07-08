'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  distinguishCompetitorIdentities,
  listCompetitorIdentities,
  listCompetitorIdentityMergeSuggestions,
  mergeCompetitorIdentities,
  renameCompetitorIdentity,
  restoreCompetitorIdentity,
  setCompetitorIdentityReviewed,
  splitCompetitorIdentity,
} from '@/lib/api-repository';
import type { MergeSuggestion } from '@/lib/api-handlers/competitor-identity';
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

/** The review queue's merge candidates (#221). */
export function useIdentityMergeSuggestions() {
  return useQuery<MergeSuggestion[]>({
    queryKey: queryKeys.competitorIdentities.review(),
    queryFn: () => listCompetitorIdentityMergeSuggestions(),
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

/** Dismiss a merge suggestion for good — the pair are different sailors. */
export function useDistinguishIdentities() {
  const invalidate = useInvalidateIdentities();
  return useMutation({
    mutationFn: ({ aId, bId }: { aId: string; bId: string }) =>
      distinguishCompetitorIdentities(aId, bId),
    onSuccess: invalidate,
  });
}
