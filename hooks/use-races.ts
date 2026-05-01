'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useRepos } from '@/lib/repos';
import type { Race } from '@/lib/types';

import { queryKeys } from './query-keys';

export function useRacesBySeries(seriesId: string) {
  const { raceRepo } = useRepos();
  return useQuery<Race[]>({
    queryKey: queryKeys.races.bySeries(seriesId),
    queryFn: () => raceRepo.listBySeries(seriesId),
  });
}

export function useRace(raceId: string) {
  const { raceRepo } = useRepos();
  return useQuery<Race | null>({
    queryKey: queryKeys.races.detail(raceId),
    queryFn: async () => (await raceRepo.get(raceId)) ?? null,
  });
}

export function useSaveRace() {
  const { raceRepo } = useRepos();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (race: Race) => {
      const cached =
        qc.getQueryData<Race | null>(queryKeys.races.detail(race.id)) ??
        qc
          .getQueryData<Race[]>(queryKeys.races.bySeries(race.seriesId))
          ?.find((r) => r.id === race.id);
      return raceRepo.save(race, { expectedVersion: cached?.version });
    },
    onSuccess: (saved) => {
      qc.setQueryData(queryKeys.races.detail(saved.id), saved);
      qc.invalidateQueries({ queryKey: queryKeys.races.bySeries(saved.seriesId) });
    },
  });
}

export function useDeleteRace() {
  const { raceRepo } = useRepos();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; seriesId: string }) => raceRepo.delete(id),
    onSuccess: (_void, { id, seriesId }) => {
      qc.removeQueries({ queryKey: queryKeys.races.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.races.bySeries(seriesId) });
      // Finishes/race-starts cascade in Postgres and are filtered by raceId
      // in Dexie; both back-ends invalidate symmetrically here.
      qc.invalidateQueries({ queryKey: queryKeys.finishes.byRace(id) });
      qc.invalidateQueries({ queryKey: queryKeys.raceStarts.byRace(id) });
    },
  });
}
