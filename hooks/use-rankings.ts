'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createRanking,
  deleteRanking,
  getRanking,
  getRankingStandings,
  listRankings,
  putRanking,
} from '@/lib/api-repository';
import type { RankingDto } from '@/lib/api-handlers/rankings';
import type { RankingConfig } from '@/lib/ranking';
import type { RankingStandingsData } from '@/lib/ranking-standings';

import { queryKeys } from './query-keys';

import type { AsPublishedRankingListItem } from '@/lib/api-repository';

/** The active workspace's cross-series rankings (#209) plus the read-only
 *  as-published historical rankings (#309). */
export function useRankings() {
  return useQuery<{
    items: RankingDto[];
    asPublished: AsPublishedRankingListItem[];
  }>({
    queryKey: queryKeys.rankings.list(),
    queryFn: () => listRankings(),
  });
}

export function useRanking(id: string) {
  return useQuery<RankingDto>({
    queryKey: queryKeys.rankings.detail(id),
    queryFn: () => getRanking(id),
  });
}

/** The computed ladder for one ranking (in-app view). */
export function useRankingStandings(id: string) {
  return useQuery<RankingStandingsData>({
    queryKey: queryKeys.rankings.standings(id),
    queryFn: () => getRankingStandings(id),
  });
}

function useInvalidateRankings() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.rankings.all });
}

export function useCreateRanking() {
  const invalidate = useInvalidateRankings();
  return useMutation({
    mutationFn: (name: string) => createRanking(name),
    onSuccess: invalidate,
  });
}

export function usePutRanking() {
  const invalidate = useInvalidateRankings();
  return useMutation({
    mutationFn: ({
      id,
      ...input
    }: {
      id: string;
      name: string;
      config: RankingConfig;
      published: boolean;
      slug?: string;
    }) => putRanking(id, input),
    onSuccess: invalidate,
  });
}

export function useDeleteRanking() {
  const invalidate = useInvalidateRankings();
  return useMutation({
    mutationFn: (id: string) => deleteRanking(id),
    onSuccess: invalidate,
  });
}
