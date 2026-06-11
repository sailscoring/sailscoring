'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { raceStartRepo } from '@/lib/api-repository';
import type { RaceStart } from '@/lib/types';

import { queryKeys } from './query-keys';
import { useVersionedSave } from './use-versioned-save';

export function useRaceStartsByRace(raceId: string) {
  return useQuery<RaceStart[]>({
    queryKey: queryKeys.raceStarts.byRace(raceId),
    queryFn: () => raceStartRepo.listByRace(raceId),
  });
}

export function useRaceStartsBySeries(seriesId: string, opts?: { enabled?: boolean }) {
  return useQuery<RaceStart[]>({
    queryKey: queryKeys.raceStarts.bySeries(seriesId),
    queryFn: () => raceStartRepo.listBySeries(seriesId),
    enabled: opts?.enabled ?? true,
  });
}

export function useSaveRaceStart() {
  return useVersionedSave<RaceStart>({
    listKey: (start) => queryKeys.raceStarts.byRace(start.raceId),
    save: (start, opts) => raceStartRepo.save(start, opts),
    scopeId: 'race-starts',
    onSaved: async (qc, saved) => {
      qc.invalidateQueries({ queryKey: queryKeys.raceStarts.byRace(saved.raceId) });
      qc.invalidateQueries({ queryKey: queryKeys.raceStarts.all });
      // Every child write bumps the series row's lastModifiedAt + version
      // server-side. Await the series refetch so a caller that proceeds to a
      // series settings save reads a fresh expectedVersion, not a stale 409.
      await qc.invalidateQueries({ queryKey: queryKeys.series.all });
    },
  });
}

export function useSaveRaceStarts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (starts: RaceStart[]) => raceStartRepo.saveMany(starts),
    onSuccess: async (_void, starts) => {
      const raceIds = new Set(starts.map((s) => s.raceId));
      for (const raceId of raceIds) {
        qc.invalidateQueries({ queryKey: queryKeys.raceStarts.byRace(raceId) });
      }
      qc.invalidateQueries({ queryKey: queryKeys.raceStarts.all });
      // See useSaveRaceStart — keep the cached series row's version fresh.
      await qc.invalidateQueries({ queryKey: queryKeys.series.all });
    },
    // Share the scope with useSaveRaceStart so a bulk write and a rapid
    // single save can't interleave on the same rows.
    scope: { id: 'race-starts' },
  });
}

export function useDeleteRaceStart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; raceId: string }) =>
      raceStartRepo.delete(id),
    onSuccess: async (_void, { raceId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.raceStarts.byRace(raceId) });
      qc.invalidateQueries({ queryKey: queryKeys.raceStarts.all });
      // See useSaveRaceStart — keep the cached series row's version fresh.
      await qc.invalidateQueries({ queryKey: queryKeys.series.all });
    },
  });
}
