'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { raceRepo } from '@/lib/api-repository';
import type { Race } from '@/lib/types';

import { queryKeys } from './query-keys';
import { useVersionedSave } from './use-versioned-save';

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
  return useVersionedSave<Race>({
    listKey: (race) => queryKeys.races.bySeries(race.seriesId),
    // The per-race detail cache is fresher than the series list when both
    // exist (the result-entry page keeps it warm) — prefer it.
    readCachedVersion: (qc, race) =>
      (
        qc.getQueryData<Race | null>(queryKeys.races.detail(race.id)) ??
        qc
          .getQueryData<Race[]>(queryKeys.races.bySeries(race.seriesId))
          ?.find((r) => r.id === race.id)
      )?.version,
    save: (race, opts) => raceRepo.save(race, opts),
    scopeId: 'races',
    onSaved: async (qc, saved) => {
      qc.setQueryData(queryKeys.races.detail(saved.id), saved);
      qc.invalidateQueries({ queryKey: queryKeys.races.bySeries(saved.seriesId) });
      // Every child write bumps the series row's lastModifiedAt + version
      // server-side. Await the series refetch so a caller that proceeds to a
      // series settings save reads a fresh expectedVersion, not a stale 409.
      await qc.invalidateQueries({ queryKey: queryKeys.series.all });
    },
  });
}

export function useDeleteRace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; seriesId: string }) => raceRepo.delete(id),
    onSuccess: async (_void, { id, seriesId }) => {
      qc.removeQueries({ queryKey: queryKeys.races.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.races.bySeries(seriesId) });
      // Finishes / race-starts cascaded in Postgres along with the race
      // row. Don't invalidate or remove the per-race cache entries —
      // either would trigger a refetch that 404s. Leave the orphan
      // entries to be reaped when the RaceRow components unmount.
      // See useSaveRace — keep the cached series row's version fresh.
      await qc.invalidateQueries({ queryKey: queryKeys.series.all });
    },
  });
}
