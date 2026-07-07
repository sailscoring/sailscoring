'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { raceRepo } from '@/lib/api-repository';
import type { Race } from '@/lib/types';

import { queryKeys } from './query-keys';
import { keepNewerVersionedRow, keepNewerVersionedRows } from './query-version-guard';
import { useVersionedSave } from './use-versioned-save';

export function useRacesBySeries(seriesId: string) {
  return useQuery<Race[]>({
    queryKey: queryKeys.races.bySeries(seriesId),
    queryFn: () => raceRepo.listBySeries(seriesId),
    // A refetch dispatched before a save can resolve after the save's
    // onSuccess and overwrite the fresh row with a pre-save one — the race
    // list backs the Races page, so a cleared or renamed race would revert.
    structuralSharing: keepNewerVersionedRows,
  });
}

export function useRace(raceId: string) {
  return useQuery<Race | null>({
    queryKey: queryKeys.races.detail(raceId),
    queryFn: async () => (await raceRepo.get(raceId)) ?? null,
    // The name editor mirrors this row into local state; a stale refetch
    // landing after a save would visibly revert the name.
    structuralSharing: keepNewerVersionedRow,
  });
}

export function useSaveRace() {
  return useVersionedSave<Race>({
    listKey: (race) => queryKeys.races.bySeries(race.seriesId),
    // The per-race detail cache is fresher than the series list when both
    // exist (the result-entry page keeps it warm) — prefer it.
    readCachedVersion: (qc, race) =>
      (
        qc.getQueryData<Race | null>(queryKeys.races.detail(race.id)) ??
        qc
          .getQueryData<Race[]>(queryKeys.races.bySeries(race.seriesId))
          ?.find((r) => r.id === race.id)
      )?.version,
    save: (race, opts) => raceRepo.save(race, opts),
    scopeId: 'races',
    onSaved: async (qc, saved) => {
      qc.setQueryData(queryKeys.races.detail(saved.id), saved);
      // Patch the saved row into the series list too, not just the detail
      // cache. Otherwise a navigation back to the Races list renders the
      // pre-save row (e.g. an unnamed race) until the invalidation's
      // background refetch lands — a visible flash under load, and a stale
      // read for anything that samples the list before the refetch settles.
      qc.setQueryData<Race[]>(queryKeys.races.bySeries(saved.seriesId), (prev) =>
        prev?.map((r) => (r.id === saved.id ? saved : r)),
      );
      qc.invalidateQueries({ queryKey: queryKeys.races.bySeries(saved.seriesId) });
      // Every child write bumps the series row's lastModifiedAt + version
      // server-side. Await the series refetch so a caller that proceeds to a
      // series settings save reads a fresh expectedVersion, not a stale 409.
      await qc.invalidateQueries({ queryKey: queryKeys.series.all });
    },
  });
}

/**
 * Renumber a series' races to a new order. `orderedIds` is the full set of
 * race ids in their new sequence. Optimistic: the cached list is reordered and
 * renumbered 1..n immediately so rows settle into place, then the server
 * response is refetched on settle.
 */
export function useReorderRaces(seriesId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderedIds: string[]) => raceRepo.reorder(seriesId, orderedIds),
    onMutate: async (orderedIds: string[]) => {
      const listKey = queryKeys.races.bySeries(seriesId);
      await qc.cancelQueries({ queryKey: listKey });
      const prev = qc.getQueryData<Race[]>(listKey);
      if (prev) {
        const byId = new Map(prev.map((r) => [r.id, r]));
        const reordered = orderedIds
          .map((id) => byId.get(id))
          .filter((r): r is Race => r !== undefined)
          .map((r, i) => ({ ...r, raceNumber: i + 1 }));
        qc.setQueryData(listKey, reordered);
      }
      return { prev };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKeys.races.bySeries(seriesId), ctx.prev);
    },
    onSettled: async () => {
      qc.invalidateQueries({ queryKey: queryKeys.races.bySeries(seriesId) });
      await qc.invalidateQueries({ queryKey: queryKeys.series.all });
    },
  });
}

export function useDeleteRace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; seriesId: string }) => raceRepo.delete(id),
    onSuccess: async (_void, { id, seriesId }) => {
      qc.removeQueries({ queryKey: queryKeys.races.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.races.bySeries(seriesId) });
      // Finishes / race-starts cascaded in Postgres along with the race
      // row. Don't invalidate or remove the per-race cache entries —
      // either would trigger a refetch that 404s. Leave the orphan
      // entries to be reaped when the RaceRow components unmount.
      // See useSaveRace — keep the cached series row's version fresh.
      await qc.invalidateQueries({ queryKey: queryKeys.series.all });
    },
  });
}
