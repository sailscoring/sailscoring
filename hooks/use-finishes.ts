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

export function useFinishesBySeries(seriesId: string, opts?: { enabled?: boolean }) {
  return useQuery<Finish[]>({
    queryKey: queryKeys.finishes.bySeries(seriesId),
    // The series-scoped endpoint needs no competitor ids, so the key is just
    // the seriesId — no key churn when the competitor list changes (the
    // mutation invalidations cover refresh).
    queryFn: () => finishRepo.listBySeries(seriesId, []),
    enabled: opts?.enabled ?? true,
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
      // Every child write bumps the series row's lastModifiedAt + version
      // server-side. Fire-and-forget (unlike the other child hooks): finish
      // entry autosaves row by row, and awaiting a series refetch per row
      // would slow the serialized entry queue for no benefit — nothing in
      // the entry flow saves the series row.
      void qc.invalidateQueries({ queryKey: queryKeys.series.all });
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
    onSuccess: async (_void, finishes) => {
      const raceIds = new Set(finishes.map((f) => f.raceId));
      for (const raceId of raceIds) {
        qc.invalidateQueries({ queryKey: queryKeys.finishes.byRace(raceId) });
      }
      qc.invalidateQueries({ queryKey: queryKeys.finishes.all });
      // The write bumped the series row server-side; refresh the cached
      // series so a follow-on settings save reads a fresh expectedVersion.
      await qc.invalidateQueries({ queryKey: queryKeys.series.all });
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
    onSuccess: async (_void, { raceId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.finishes.byRace(raceId) });
      qc.invalidateQueries({ queryKey: queryKeys.finishes.all });
      // The write bumped the series row server-side; refresh the cached
      // series so a follow-on settings save reads a fresh expectedVersion.
      await qc.invalidateQueries({ queryKey: queryKeys.series.all });
    },
  });
}

