'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { raceStartRepo } from '@/lib/api-repository';
import type { RaceStart } from '@/lib/types';

import { queryKeys } from './query-keys';

export function useRaceStartsByRace(raceId: string) {
  return useQuery<RaceStart[]>({
    queryKey: queryKeys.raceStarts.byRace(raceId),
    queryFn: () => raceStartRepo.listByRace(raceId),
  });
}

export function useRaceStartsByRaces(raceIds: string[]) {
  const enabled = raceIds.length > 0;
  return useQuery<RaceStart[]>({
    queryKey: queryKeys.raceStarts.byRaces(raceIds),
    queryFn: () => raceStartRepo.listByRaces(raceIds),
    enabled,
    // See useFinishesBySeries — same reason (#116).
    initialData: enabled ? undefined : ([] as RaceStart[]),
  });
}

export function useSaveRaceStart() {
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
    // Serialize so a rapid second save sees the cache update from the first
    // and sends the fresh `expectedVersion`. See useSaveSeries for context.
    scope: { id: 'race-starts' },
  });
}

export function useSaveRaceStarts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (starts: RaceStart[]) => raceStartRepo.saveMany(starts),
    onSuccess: (_void, starts) => {
      const raceIds = new Set(starts.map((s) => s.raceId));
      for (const raceId of raceIds) {
        qc.invalidateQueries({ queryKey: queryKeys.raceStarts.byRace(raceId) });
      }
      qc.invalidateQueries({ queryKey: queryKeys.raceStarts.all });
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
    onSuccess: (_void, { raceId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.raceStarts.byRace(raceId) });
      qc.invalidateQueries({ queryKey: queryKeys.raceStarts.all });
    },
  });
}
