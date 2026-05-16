'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { raceRepo } from '@/lib/api-repository';
import type { Race } from '@/lib/types';

import { queryKeys } from './query-keys';

export function useRacesBySeries(seriesId: string) {
  return useQuery<Race[]>({
    queryKey: queryKeys.races.bySeries(seriesId),
    queryFn: () => raceRepo.listBySeries(seriesId),
  });
}

export function useRace(raceId: string) {
  return useQuery<Race | null>({
    queryKey: queryKeys.races.detail(raceId),
    queryFn: async () => (await raceRepo.get(raceId)) ?? null,
  });
}

export function useSaveRace() {
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
    // Serialize so a rapid second save sees the cache update from the first
    // and sends the fresh `expectedVersion`. See useSaveSeries for context.
    scope: { id: 'races' },
  });
}

export function useDeleteRace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; seriesId: string }) => raceRepo.delete(id),
    onSuccess: (_void, { id, seriesId }) => {
      qc.removeQueries({ queryKey: queryKeys.races.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.races.bySeries(seriesId) });
      // Finishes / race-starts cascaded in Postgres along with the race
      // row. Don't invalidate or remove the per-race cache entries —
      // either would trigger a refetch that 404s. Leave the orphan
      // entries to be reaped when the RaceRow components unmount.
    },
  });
}
