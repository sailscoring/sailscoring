'use client';

import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { finishRepo } from '@/lib/api-repository';
import type { Finish } from '@/lib/types';

import { queryKeys } from './query-keys';
import { useVersionedSave } from './use-versioned-save';

/**
 * Result entry writes the per-race cache directly (optimistic patches, the
 * post-save splice) and the serialized save queue depends on the cache
 * leading the server. React Query applies fetch results last-resolve-wins,
 * so a list fetch already in flight when one of those writes lands — e.g.
 * the initial load of a just-opened race — would overwrite the written rows
 * with its pre-write snapshot: a committed finisher silently vanishes from
 * the sheet. Every direct write bumps this per-race epoch; a fetch that
 * observes a bump while it was in flight discards its response in favour of
 * the cache.
 */
const patchEpochByRace = new Map<string, number>();
const patchEpoch = (raceId: string) => patchEpochByRace.get(raceId) ?? 0;
const bumpPatchEpoch = (raceId: string) =>
  patchEpochByRace.set(raceId, patchEpoch(raceId) + 1);

/**
 * Optimistic per-race cache patch: write the new shape immediately so the UI
 * updates before the server round-trip resolves. Mutation onError rolls back
 * by invalidating the query if the save fails. Every result-entry mutation
 * path patches before it mutates — keep that ordering (the serialized
 * `finishes` mutation scope depends on the cache leading the writes).
 */
export function useFinishCachePatch(raceId: string) {
  const qc = useQueryClient();
  return useCallback(
    (updater: (rows: Finish[]) => Finish[]) => {
      const key = queryKeys.finishes.byRace(raceId);
      const prev = qc.getQueryData<Finish[]>(key) ?? [];
      bumpPatchEpoch(raceId);
      qc.setQueryData<Finish[]>(key, updater(prev));
    },
    [qc, raceId],
  );
}

export function useFinishesByRace(raceId: string) {
  const qc = useQueryClient();
  return useQuery<Finish[]>({
    queryKey: queryKeys.finishes.byRace(raceId),
    queryFn: async () => {
      const epochAtDispatch = patchEpoch(raceId);
      const rows = await finishRepo.listByRace(raceId);
      if (patchEpoch(raceId) === epochAtDispatch) return rows;
      // The cache was written while this fetch was in flight, so the
      // response predates it — keep the cached rows instead.
      return qc.getQueryData<Finish[]>(queryKeys.finishes.byRace(raceId)) ?? rows;
    },
  });
}

export function useFinishesBySeries(seriesId: string, opts?: { enabled?: boolean }) {
  return useQuery<Finish[]>({
    queryKey: queryKeys.finishes.bySeries(seriesId),
    queryFn: () => finishRepo.listBySeries(seriesId),
    enabled: opts?.enabled ?? true,
  });
}

export function useSaveFinish() {
  return useVersionedSave<Finish>({
    listKey: (finish) => queryKeys.finishes.byRace(finish.raceId),
    save: (finish, opts) => finishRepo.save(finish, opts),
    scopeId: 'finishes',
    onSaved: (qc, saved) => {
      // Splice the saved row into the per-race cache so the next save
      // in the serialized queue reads the bumped version (no 409) and
      // the UI reflects server truth. New rows (no cache hit) are
      // appended. Don't invalidate: a refetch races the queued saves
      // and overwrites the optimistic order with a stale server
      // snapshot. The standings page reads from `finishes.bySeries`
      // which refreshes on tab-revisit via TanStack Query staleTime.
      bumpPatchEpoch(saved.raceId);
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

