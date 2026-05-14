'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useRepos } from '@/lib/repos';
import type { Finish } from '@/lib/types';

import { queryKeys } from './query-keys';

export function useFinishesByRace(raceId: string) {
  const { finishRepo } = useRepos();
  return useQuery<Finish[]>({
    queryKey: queryKeys.finishes.byRace(raceId),
    queryFn: () => finishRepo.listByRace(raceId),
  });
}

export function useFinishesBySeries(seriesId: string, competitorIds: string[]) {
  const { finishRepo } = useRepos();
  const enabled = competitorIds.length > 0;
  return useQuery<Finish[]>({
    queryKey: [...queryKeys.finishes.bySeries(seriesId), [...competitorIds].sort()],
    queryFn: () => finishRepo.listBySeries(seriesId, competitorIds),
    enabled,
    // When the input list is empty the query is disabled; without an initial
    // value `data` stays undefined forever, which trips loading guards in
    // callers like the Standings tab (see #116).
    initialData: enabled ? undefined : ([] as Finish[]),
  });
}

export function useSaveFinish() {
  const { finishRepo } = useRepos();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (finish: Finish) => {
      const list = qc.getQueryData<Finish[]>(queryKeys.finishes.byRace(finish.raceId));
      const cached = list?.find((f) => f.id === finish.id);
      return finishRepo.save(finish, { expectedVersion: cached?.version });
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: queryKeys.finishes.byRace(saved.raceId) });
      qc.invalidateQueries({ queryKey: queryKeys.finishes.all });
    },
    // Serialize so a rapid second save sees the cache update from the first
    // and sends the fresh `expectedVersion`. See useSaveSeries for context.
    scope: { id: 'finishes' },
  });
}

export function useSaveFinishes() {
  const { finishRepo } = useRepos();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (finishes: Finish[]) => finishRepo.saveMany(finishes),
    onSuccess: (_void, finishes) => {
      const raceIds = new Set(finishes.map((f) => f.raceId));
      for (const raceId of raceIds) {
        qc.invalidateQueries({ queryKey: queryKeys.finishes.byRace(raceId) });
      }
      qc.invalidateQueries({ queryKey: queryKeys.finishes.all });
    },
    // Share the 'finishes' scope with useSaveFinish so a bulk import queues
    // behind any in-flight single-row autosave instead of racing it.
    scope: { id: 'finishes' },
  });
}

export function useDeleteFinish() {
  const { finishRepo } = useRepos();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; raceId: string }) => finishRepo.delete(id),
    onSuccess: (_void, { raceId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.finishes.byRace(raceId) });
      qc.invalidateQueries({ queryKey: queryKeys.finishes.all });
    },
  });
}

export function useDeleteFinishesByRace() {
  const { finishRepo } = useRepos();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (raceId: string) => finishRepo.deleteByRace(raceId),
    onSuccess: (_void, raceId) => {
      qc.invalidateQueries({ queryKey: queryKeys.finishes.byRace(raceId) });
      qc.invalidateQueries({ queryKey: queryKeys.finishes.all });
    },
  });
}
