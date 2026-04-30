'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useRepos } from '@/lib/repos';
import type { Competitor } from '@/lib/types';

import { queryKeys } from './query-keys';

export function useCompetitorsBySeries(seriesId: string) {
  const { competitorRepo } = useRepos();
  return useQuery<Competitor[]>({
    queryKey: queryKeys.competitors.bySeries(seriesId),
    queryFn: () => competitorRepo.listBySeries(seriesId),
  });
}

export function useSaveCompetitor() {
  const { competitorRepo } = useRepos();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (competitor: Competitor) => competitorRepo.save(competitor),
    onSuccess: (saved) => {
      qc.invalidateQueries({
        queryKey: queryKeys.competitors.bySeries(saved.seriesId),
      });
    },
  });
}

export function useDeleteCompetitor() {
  const { competitorRepo } = useRepos();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; seriesId: string }) =>
      competitorRepo.delete(id),
    onSuccess: (_void, { seriesId }) => {
      qc.invalidateQueries({
        queryKey: queryKeys.competitors.bySeries(seriesId),
      });
      // Finishes reference competitorId; cached lists may need a refresh.
      qc.invalidateQueries({ queryKey: queryKeys.finishes.all });
    },
  });
}
