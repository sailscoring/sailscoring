'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useRepos } from '@/lib/repos';
import type { RaceStart } from '@/lib/types';

import { queryKeys } from './query-keys';

export function useRaceStartsByRace(raceId: string) {
  const { raceStartRepo } = useRepos();
  return useQuery<RaceStart[]>({
    queryKey: queryKeys.raceStarts.byRace(raceId),
    queryFn: () => raceStartRepo.listByRace(raceId),
  });
}

export function useRaceStartsByRaces(raceIds: string[]) {
  const { raceStartRepo } = useRepos();
  return useQuery<RaceStart[]>({
    queryKey: queryKeys.raceStarts.byRaces(raceIds),
    queryFn: () => raceStartRepo.listByRaces(raceIds),
    enabled: raceIds.length > 0,
  });
}

export function useSaveRaceStart() {
  const { raceStartRepo } = useRepos();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (start: RaceStart) => {
      const list = qc.getQueryData<RaceStart[]>(queryKeys.raceStarts.byRace(start.raceId));
      const cached = list?.find((s) => s.id === start.id);
      return raceStartRepo.save(start, { expectedVersion: cached?.version });
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: queryKeys.raceStarts.byRace(saved.raceId) });
      qc.invalidateQueries({ queryKey: queryKeys.raceStarts.all });
    },
  });
}

export function useDeleteRaceStart() {
  const { raceStartRepo } = useRepos();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; raceId: string }) =>
      raceStartRepo.delete(id),
    onSuccess: (_void, { raceId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.raceStarts.byRace(raceId) });
      qc.invalidateQueries({ queryKey: queryKeys.raceStarts.all });
    },
  });
}
