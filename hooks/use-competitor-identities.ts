'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  listCompetitorIdentities,
  renameCompetitorIdentity,
  unlinkCompetitorFromIdentity,
} from '@/lib/api-repository';
import type { IdentityWithArc } from '@/lib/competitor-identity-repository';

import { queryKeys } from './query-keys';

/** Cross-series competitor identities for the active workspace (#212). */
export function useCompetitorIdentities() {
  return useQuery<IdentityWithArc[]>({
    queryKey: queryKeys.competitorIdentities.list(),
    queryFn: () => listCompetitorIdentities(),
  });
}

export function useRenameCompetitorIdentity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, label }: { id: string; label: string }) =>
      renameCompetitorIdentity(id, label),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.competitorIdentities.all }),
  });
}

export function useUnlinkCompetitor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, competitorId }: { id: string; competitorId: string }) =>
      unlinkCompetitorFromIdentity(id, competitorId),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.competitorIdentities.all }),
  });
}
