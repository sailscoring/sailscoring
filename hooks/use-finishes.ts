'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useRepos } from '@/lib/repos';
import type { FinishReorderItem } from '@/lib/repository';
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
  return useQuery<Finish[]>({
    queryKey: [...queryKeys.finishes.bySeries(seriesId), [...competitorIds].sort()],
    queryFn: () => finishRepo.listBySeries(seriesId, competitorIds),
    enabled: competitorIds.length > 0,
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
    // Shared with useSaveFinishes so single + bulk saves don't race.
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
    scope: { id: 'finishes' },
  });
}

/**
 * Per-row CAS reorder of `sortOrder` on a window of finishes within a
 * single race (ADR-008 Phase 6). On success, patches the cached race
 * list with the new `{sortOrder, version}` so the UI doesn't have to
 * round-trip through a refetch. On 409, throws `ConflictApiError` —
 * the page-level conflict handler picks it up. Shares the `finishes`
 * scope so reorders and per-row saves serialize against each other.
 */
export function useReorderFinishes() {
  const { finishRepo } = useRepos();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ raceId, items }: { raceId: string; items: FinishReorderItem[] }) =>
      finishRepo.reorderSortOrders(raceId, items),
    onSuccess: (results, { raceId }) => {
      const cached = qc.getQueryData<Finish[]>(queryKeys.finishes.byRace(raceId));
      if (cached) {
        const byId = new Map(results.map((r) => [r.id, r]));
        qc.setQueryData<Finish[]>(
          queryKeys.finishes.byRace(raceId),
          cached.map((f) => {
            const updated = byId.get(f.id);
            return updated
              ? { ...f, sortOrder: updated.sortOrder, version: updated.version }
              : f;
          }),
        );
      } else {
        qc.invalidateQueries({ queryKey: queryKeys.finishes.byRace(raceId) });
      }
      qc.invalidateQueries({ queryKey: queryKeys.finishes.all });
    },
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
