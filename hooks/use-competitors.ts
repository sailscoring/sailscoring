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
    mutationFn: (competitor: Competitor) => {
      const list = qc.getQueryData<Competitor[]>(
        queryKeys.competitors.bySeries(competitor.seriesId),
      );
      const cached = list?.find((c) => c.id === competitor.id);
      return competitorRepo.save(competitor, { expectedVersion: cached?.version });
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({
        queryKey: queryKeys.competitors.bySeries(saved.seriesId),
      });
    },
    // Serialize so a rapid second save sees the cache update from the first
    // and sends the fresh `expectedVersion`. See useSaveSeries for context.
    scope: { id: 'competitors' },
  });
}

export function useSaveCompetitors() {
  const { competitorRepo } = useRepos();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (competitors: Competitor[]) =>
      competitorRepo.saveMany(competitors),
    onSuccess: (_void, competitors) => {
      const seriesIds = new Set(competitors.map((c) => c.seriesId));
      for (const seriesId of seriesIds) {
        qc.invalidateQueries({
          queryKey: queryKeys.competitors.bySeries(seriesId),
        });
      }
    },
    scope: { id: 'competitors' },
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
