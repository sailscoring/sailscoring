'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';

import {
  seriesRepo,
  archiveSeries,
  createFollowOnSeries,
  deleteSeriesCascade,
  listSeriesNames,
  setSeriesCategory,
  setSeriesResultsStatus,
} from '@/lib/api-repository';
import { ConflictApiError } from '@/lib/api-client';
import type { Series } from '@/lib/types';

import { queryKeys } from './query-keys';
import { keepNewerVersionedRow, keepNewerVersionedRows } from './query-version-guard';
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
async function saveSeriesRetryingWith(
  repo: Pick<typeof seriesRepo, 'get' | 'save'>,
  id: string,
  payload: Series,
  expectedVersion: number | undefined,
  rebuild: (fresh: Series) => Series,
): Promise<Series> {
  try {
    return await repo.save(payload, { expectedVersion });
  } catch (err) {
    if (!(err instanceof ConflictApiError)) throw err;
    const fresh = await repo.get(id);
    if (!fresh) throw err;
    return repo.save(rebuild(fresh), { expectedVersion: fresh.version });
  }
}

export function useSeriesList(
  options?: Omit<UseQueryOptions<Series[]>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<Series[]>({
    queryKey: queryKeys.series.list(),
    queryFn: () => seriesRepo.list(),
    structuralSharing: keepNewerVersionedRows,
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
    // A stale refetch resolving after a save's onSuccess must not overwrite
    // the fresh row — settings cards mirror this row into local state and
    // would visibly revert.
    structuralSharing: keepNewerVersionedRow,
    ...options,
  });
}

/**
 * Mutation key shared by the series-row writers (`useSaveSeries`,
 * `useUpdateSeries`). UI that mirrors the row into local state can watch it
 * via `useIsMutating` and hold off re-syncing while saves are pending or
 * queued — an earlier save's onSuccess lands a row that predates a later
 * edit, and re-syncing from it would visibly revert the edit.
 */
export const seriesRowMutationKey = ['series-row'] as const;

export function useSaveSeries() {
  return useVersionedSave<Series>({
    mutationKey: seriesRowMutationKey,
    listKey: (series) => queryKeys.series.detail(series.id),
    // The detail cache holds a single row, not a list.
    readCachedVersion: (qc, series) =>
      qc.getQueryData<Series | null>(queryKeys.series.detail(series.id))?.version,
    save: (series, opts) =>
      saveSeriesRetryingWith(seriesRepo, series.id, series, opts.expectedVersion, () => series),
    scopeId: 'series',
    onSaved: (qc, saved) => {
      qc.setQueryData(queryKeys.series.detail(saved.id), saved);
      qc.invalidateQueries({ queryKey: queryKeys.series.list() });
    },
  });
}

/**
 * A patch for `useUpdateSeries`: either a plain partial row, or a function
 * deriving one from the row being patched. Use the functional form whenever
 * the new value is computed from the old one (list toggles, map merges) —
 * a plain object computed at click time can bake in a stale prop and revert
 * a save that was still in flight when the prop was read. The function runs
 * inside the serialized mutation, against the freshest row, and is re-run on
 * the 409 retry path against the re-read row.
 */
export type SeriesPatch = Partial<Series> | ((current: Series) => Partial<Series>);

/**
 * Mutation options for `useUpdateSeries`, extracted so tests can exercise
 * the real config (cache read, patch resolution, retry rebuild, scope)
 * against a fake repository instead of mirroring it.
 */
export function updateSeriesMutationOptions(
  qc: QueryClient,
  repo: Pick<typeof seriesRepo, 'get' | 'save'> = seriesRepo,
) {
  return {
    mutationKey: seriesRowMutationKey,
    mutationFn: async ({ id, patch }: { id: string; patch: SeriesPatch }) => {
      // A detail refetch already in flight predates this save; abort it so
      // its response can't land after onSuccess and overwrite the fresh row.
      // (The version guard on the detail query is the backstop for responses
      // past the point of cancellation.)
      await qc.cancelQueries({ queryKey: queryKeys.series.detail(id) });
      const cached = qc.getQueryData<Series | null>(queryKeys.series.detail(id));
      const current = cached ?? (await repo.get(id)) ?? null;
      if (!current) throw new Error(`series ${id} not found`);
      const resolve = (base: Series) => (typeof patch === 'function' ? patch(base) : patch);
      const rebuild = (fresh: Series) => ({ ...fresh, ...resolve(fresh) });
      return saveSeriesRetryingWith(repo, id, rebuild(current), current.version, rebuild);
    },
    onSuccess: (saved: Series) => {
      qc.setQueryData(queryKeys.series.detail(saved.id), saved);
      qc.invalidateQueries({ queryKey: queryKeys.series.list() });
    },
    // See useSaveSeries — same scope so update/save serialize together.
    scope: { id: 'series' },
  };
}

/**
 * Partial-update wrapper. Reads the current series from the query cache
 * if present (or fetches), merges the patch, and writes the whole row.
 * Replaces direct `db.series.update(id, patch)` calls.
 */
export function useUpdateSeries() {
  const qc = useQueryClient();
  return useMutation(updateSeriesMutationOptions(qc));
}

export function useDeleteSeriesCascade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteSeriesCascade(id),
    onSuccess: (_void, id) => {
      qc.removeQueries({ queryKey: queryKeys.series.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.series.list() });
      // Delete is now a soft delete — the series moves to the Trash, so its
      // list is stale too ("Recover a deleted series").
      qc.invalidateQueries({ queryKey: queryKeys.trash.list() });
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

/** Mark results final / reopen as provisional — the results lifecycle toggle. */
export function useSetResultsStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'provisional' | 'final' }) =>
      setSeriesResultsStatus(id, status),
    onSuccess: (saved) => {
      qc.setQueryData(queryKeys.series.detail(saved.id), saved);
      qc.invalidateQueries({ queryKey: queryKeys.series.list() });
    },
    scope: { id: 'series' },
  });
}

/** Roll a series into a follow-on: same structure and competitors, no
 *  races, progressive starting handicaps seeded from the source. */
export function useCreateFollowOnSeries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      sourceSeriesId,
      name,
      startDate,
    }: {
      sourceSeriesId: string;
      name?: string;
      startDate?: string;
    }) => createFollowOnSeries(sourceSeriesId, { name, startDate }),
    onSuccess: () => {
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
