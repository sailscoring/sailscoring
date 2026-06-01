'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';

import {
  seriesRepo,
  archiveSeries,
  deleteSeriesCascade,
  listSeriesNames,
  setSeriesCategory,
} from '@/lib/api-repository';
import type { Series } from '@/lib/types';

import { queryKeys } from './query-keys';

export function useSeriesList(
  options?: Omit<UseQueryOptions<Series[]>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<Series[]>({
    queryKey: queryKeys.series.list(),
    queryFn: () => seriesRepo.list(),
    ...options,
  });
}

export function useSeries(
  id: string,
  options?: Omit<UseQueryOptions<Series | null>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<Series | null>({
    queryKey: queryKeys.series.detail(id),
    queryFn: async () => (await seriesRepo.get(id)) ?? null,
    ...options,
  });
}

export function useSaveSeries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (series: Series) => {
      // Pull `version` from the cached row to drive optimistic concurrency.
      const cached = qc.getQueryData<Series | null>(queryKeys.series.detail(series.id));
      return seriesRepo.save(series, { expectedVersion: cached?.version });
    },
    onSuccess: (saved) => {
      qc.setQueryData(queryKeys.series.detail(saved.id), saved);
      qc.invalidateQueries({ queryKey: queryKeys.series.list() });
    },
    // Serialize series writes so a rapid second mutate sees the cache update
    // from the first's onSuccess and sends the fresh `expectedVersion`. Without
    // this, two parallel mutates both read V0 and the second 409s.
    scope: { id: 'series' },
  });
}

/**
 * Partial-update wrapper. Reads the current series from the query cache
 * if present (or fetches), merges the patch, and writes the whole row.
 * Replaces direct `db.series.update(id, patch)` calls.
 */
export function useUpdateSeries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Series> }) => {
      const cached = qc.getQueryData<Series | null>(queryKeys.series.detail(id));
      const current = cached ?? (await seriesRepo.get(id)) ?? null;
      if (!current) throw new Error(`series ${id} not found`);
      return seriesRepo.save({ ...current, ...patch }, { expectedVersion: current.version });
    },
    onSuccess: (saved) => {
      qc.setQueryData(queryKeys.series.detail(saved.id), saved);
      qc.invalidateQueries({ queryKey: queryKeys.series.list() });
    },
    // See useSaveSeries — same scope so update/save serialize together.
    scope: { id: 'series' },
  });
}

export function useDeleteSeriesCascade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteSeriesCascade(id),
    onSuccess: (_void, id) => {
      qc.removeQueries({ queryKey: queryKeys.series.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.series.list() });
      // Children invalidations are conservative — the series is gone, so
      // every cached child collection under it is stale.
      qc.invalidateQueries({ queryKey: queryKeys.fleets.all });
      qc.invalidateQueries({ queryKey: queryKeys.competitors.all });
      qc.invalidateQueries({ queryKey: queryKeys.races.all });
      qc.invalidateQueries({ queryKey: queryKeys.finishes.all });
      qc.invalidateQueries({ queryKey: queryKeys.raceStarts.all });
    },
  });
}

export function useTouchSeries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => seriesRepo.touch(id),
    // `touch` bumps the row's `version` server-side but returns nothing, so —
    // unlike useUpdateSeries/useSaveSeries — we can't setQueryData the fresh
    // row. Await the detail refetch instead: react-query awaits this async
    // onSuccess before mutateAsync resolves, so a caller doing
    // `await touchSeries.mutateAsync(id)` is guaranteed a fresh cached version
    // before its next series write. Without this the cache lags the DB and the
    // next useUpdateSeries sends a stale `expectedVersion` → 409.
    onSuccess: async (_void, id) => {
      await qc.invalidateQueries({ queryKey: queryKeys.series.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.series.list() });
    },
    // See useSaveSeries — same scope so touch/update/save serialize together.
    scope: { id: 'series' },
  });
}

/** Archive / unarchive a series — the read-only toggle (#154). */
export function useArchiveSeries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      archiveSeries(id, archived),
    onSuccess: (saved) => {
      qc.setQueryData(queryKeys.series.detail(saved.id), saved);
      qc.invalidateQueries({ queryKey: queryKeys.series.list() });
    },
    scope: { id: 'series' },
  });
}

/** Move a series between categories (`null` = Uncategorized, #154). */
export function useSetSeriesCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, categoryId }: { id: string; categoryId: string | null }) =>
      setSeriesCategory(id, categoryId),
    onSuccess: (saved) => {
      qc.setQueryData(queryKeys.series.detail(saved.id), saved);
      qc.invalidateQueries({ queryKey: queryKeys.series.list() });
    },
    scope: { id: 'series' },
  });
}

/**
 * Drag-reorder the active series list. `orderedIds` is the full active
 * set in its new order. Optimistic: the cached list is reordered immediately so
 * the row settles into place without a flash back to the old order, then the
 * server response is refetched on settle.
 */
export function useReorderSeries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderedIds: string[]) => seriesRepo.reorder(orderedIds),
    onMutate: async (orderedIds: string[]) => {
      await qc.cancelQueries({ queryKey: queryKeys.series.list() });
      const prev = qc.getQueryData<Series[]>(queryKeys.series.list());
      if (prev) {
        const rank = new Map(orderedIds.map((id, i) => [id, i]));
        const reordered = orderedIds
          .map((id) => prev.find((s) => s.id === id))
          .filter((s): s is Series => s !== undefined)
          .map((s, i) => ({ ...s, displayOrder: i }));
        // Series not in the reordered set (archived) keep their relative order.
        const rest = prev.filter((s) => !rank.has(s.id));
        qc.setQueryData(queryKeys.series.list(), [...reordered, ...rest]);
      }
      return { prev };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKeys.series.list(), ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.series.list() });
    },
    scope: { id: 'series' },
  });
}

export function useListSeriesNames() {
  return (opts: { excludeId?: string } = {}) => listSeriesNames(opts);
}
