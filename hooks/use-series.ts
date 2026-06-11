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
import { ConflictApiError } from '@/lib/api-client';
import type { Series } from '@/lib/types';

import { queryKeys } from './query-keys';
import { useVersionedSave } from './use-versioned-save';

/**
 * Save a series row, retrying once on a version conflict with a re-read row.
 *
 * Every child write (competitor, fleet, race, finish, …) bumps the series
 * row's version server-side, so the series version is a noisy token: a 409
 * here usually means "a child write landed since the cache was read", not
 * "a collaborator changed the settings". Re-read the live row for its fresh
 * version and resend; `rebuild` reapplies the caller's intent on top of the
 * fresh row (a patch merges onto it, a whole-row save just resends).
 */
async function saveSeriesRetrying(
  id: string,
  payload: Series,
  expectedVersion: number | undefined,
  rebuild: (fresh: Series) => Series,
): Promise<Series> {
  try {
    return await seriesRepo.save(payload, { expectedVersion });
  } catch (err) {
    if (!(err instanceof ConflictApiError)) throw err;
    const fresh = await seriesRepo.get(id);
    if (!fresh) throw err;
    return seriesRepo.save(rebuild(fresh), { expectedVersion: fresh.version });
  }
}

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
  return useVersionedSave<Series>({
    listKey: (series) => queryKeys.series.detail(series.id),
    // The detail cache holds a single row, not a list.
    readCachedVersion: (qc, series) =>
      qc.getQueryData<Series | null>(queryKeys.series.detail(series.id))?.version,
    save: (series, opts) =>
      saveSeriesRetrying(series.id, series, opts.expectedVersion, () => series),
    scopeId: 'series',
    onSaved: (qc, saved) => {
      qc.setQueryData(queryKeys.series.detail(saved.id), saved);
      qc.invalidateQueries({ queryKey: queryKeys.series.list() });
    },
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
      return saveSeriesRetrying(
        id,
        { ...current, ...patch },
        current.version,
        (fresh) => ({ ...fresh, ...patch }),
      );
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
