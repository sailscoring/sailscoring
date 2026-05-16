'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { finishRepo } from '@/lib/api-repository';
import type { Finish } from '@/lib/types';

import { queryKeys } from './query-keys';

export function useFinishesByRace(raceId: string) {
  return useQuery<Finish[]>({
    queryKey: queryKeys.finishes.byRace(raceId),
    queryFn: () => finishRepo.listByRace(raceId),
  });
}

export function useFinishesBySeries(seriesId: string, competitorIds: string[]) {
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
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (finish: Finish) => {
      const list = qc.getQueryData<Finish[]>(queryKeys.finishes.byRace(finish.raceId));
      const cached = list?.find((f) => f.id === finish.id);
      return finishRepo.save(finish, { expectedVersion: cached?.version });
    },
    onSuccess: (saved) => {
      // Splice the saved row into the per-race cache so the next save
      // in the serialized queue reads the bumped version (no 409) and
      // the UI reflects server truth. New rows (no cache hit) are
      // appended. Don't invalidate: a refetch races the queued saves
      // and overwrites the optimistic order with a stale server
      // snapshot. The standings page reads from `finishes.bySeries`
      // which refreshes on tab-revisit via TanStack Query staleTime.
      qc.setQueryData<Finish[] | undefined>(
        queryKeys.finishes.byRace(saved.raceId),
        (rows) => {
          if (!rows) return rows;
          if (rows.some((r) => r.id === saved.id)) {
            return rows.map((r) => (r.id === saved.id ? saved : r));
          }
          return [...rows, saved];
        },
      );
    },
    // Serialize so a rapid second save sees the cache update from the first
    // and sends the fresh `expectedVersion`. See useSaveSeries for context.
    scope: { id: 'finishes' },
  });
}

export function useSaveFinishes() {
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
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; raceId: string }) => finishRepo.delete(id),
    onSuccess: (_void, { raceId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.finishes.byRace(raceId) });
      qc.invalidateQueries({ queryKey: queryKeys.finishes.all });
    },
  });
}

