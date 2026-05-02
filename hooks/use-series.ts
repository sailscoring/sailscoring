'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';

import { useRepos } from '@/lib/repos';
import type { Series } from '@/lib/types';

import { queryKeys } from './query-keys';

export function useSeriesList(
  options?: Omit<UseQueryOptions<Series[]>, 'queryKey' | 'queryFn'>,
) {
  const { seriesRepo } = useRepos();
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
  const { seriesRepo } = useRepos();
  return useQuery<Series | null>({
    queryKey: queryKeys.series.detail(id),
    queryFn: async () => (await seriesRepo.get(id)) ?? null,
    ...options,
  });
}

export function useSaveSeries() {
  const { seriesRepo } = useRepos();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (series: Series) => {
      // Pull `version` from the cached row to drive optimistic concurrency
      // when running against the server backend. Local-mode (Dexie) ignores
      // the option since there's a single writer.
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
  const { seriesRepo } = useRepos();
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
  const repos = useRepos();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => repos.deleteSeriesCascade(id),
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
  const { seriesRepo } = useRepos();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => seriesRepo.touch(id),
    onSuccess: (_void, id) => {
      qc.invalidateQueries({ queryKey: queryKeys.series.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.series.list() });
    },
  });
}

export function useListSeriesNames() {
  const repos = useRepos();
  return (opts: { excludeId?: string } = {}) => repos.listSeriesNames(opts);
}
