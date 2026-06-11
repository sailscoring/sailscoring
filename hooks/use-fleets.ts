'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fleetRepo, ensureFleet, pruneFleet } from '@/lib/api-repository';
import type { Fleet } from '@/lib/types';

import { queryKeys } from './query-keys';

export function useFleetsBySeries(seriesId: string) {
  return useQuery<Fleet[]>({
    queryKey: queryKeys.fleets.bySeries(seriesId),
    queryFn: () => fleetRepo.listBySeries(seriesId),
  });
}

export function useSaveFleet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fleet: Fleet) => {
      // The fleets list is the only cached source — there's no per-fleet
      // detail query — so we look up `version` from the list.
      const list = qc.getQueryData<Fleet[]>(queryKeys.fleets.bySeries(fleet.seriesId));
      const cached = list?.find((f) => f.id === fleet.id);
      return fleetRepo.save(fleet, { expectedVersion: cached?.version });
    },
    onSuccess: async (saved) => {
      qc.invalidateQueries({ queryKey: queryKeys.fleets.bySeries(saved.seriesId) });
      // Every child write bumps the series row's lastModifiedAt + version
      // server-side. Await the series refetch so a caller that proceeds to a
      // series settings save reads a fresh expectedVersion, not a stale 409.
      await qc.invalidateQueries({ queryKey: queryKeys.series.all });
    },
    // Serialize so a rapid second save sees the cache update from the first
    // and sends the fresh `expectedVersion`. See useSaveSeries for context.
    scope: { id: 'fleets' },
  });
}

export function useSaveFleets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fleets: Fleet[]) => fleetRepo.saveMany(fleets),
    // Apply the change to the cached list up front so a drag-reorder shows its
    // new order immediately on drop, rather than snapping back to the old order
    // until the save round-trip and refetch land. Merge by id, so this works
    // whether the payload is the whole list or just the rows that moved; new
    // fleets (e.g. a CSV import) aren't in the cache and surface on the refetch.
    onMutate: async (fleets) => {
      const seriesIds = [...new Set(fleets.map((f) => f.seriesId))];
      const snapshots: { seriesId: string; prev: Fleet[] | undefined }[] = [];
      for (const seriesId of seriesIds) {
        const key = queryKeys.fleets.bySeries(seriesId);
        await qc.cancelQueries({ queryKey: key });
        const prev = qc.getQueryData<Fleet[]>(key);
        snapshots.push({ seriesId, prev });
        if (prev) {
          const byId = new Map(
            fleets.filter((f) => f.seriesId === seriesId).map((f) => [f.id, f]),
          );
          qc.setQueryData<Fleet[]>(key, prev.map((f) => byId.get(f.id) ?? f));
        }
      }
      return { snapshots };
    },
    onError: (_err, _fleets, ctx) => {
      for (const { seriesId, prev } of ctx?.snapshots ?? []) {
        qc.setQueryData(queryKeys.fleets.bySeries(seriesId), prev);
      }
    },
    onSuccess: async () => {
      // See useSaveFleet — keep the cached series row's version fresh.
      await qc.invalidateQueries({ queryKey: queryKeys.series.all });
    },
    // Reconcile with the server on both success and rollback.
    onSettled: (_data, _err, fleets) => {
      const seriesIds = new Set(fleets.map((f) => f.seriesId));
      for (const seriesId of seriesIds) {
        qc.invalidateQueries({ queryKey: queryKeys.fleets.bySeries(seriesId) });
      }
    },
    scope: { id: 'fleets' },
  });
}

export function useDeleteFleet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; seriesId: string }) => fleetRepo.delete(id),
    onSuccess: async (_void, { seriesId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.fleets.bySeries(seriesId) });
      // Competitors carry fleetIds[] that may now reference a deleted id.
      qc.invalidateQueries({ queryKey: queryKeys.competitors.bySeries(seriesId) });
      // See useSaveFleet — keep the cached series row's version fresh.
      await qc.invalidateQueries({ queryKey: queryKeys.series.all });
    },
  });
}

export function useEnsureFleet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      seriesId,
      name,
      options,
    }: {
      seriesId: string;
      name: string;
      options?: Parameters<typeof ensureFleet>[2];
    }) => ensureFleet(seriesId, name, options),
    onSuccess: async (_id, { seriesId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.fleets.bySeries(seriesId) });
      // See useSaveFleet — keep the cached series row's version fresh.
      await qc.invalidateQueries({ queryKey: queryKeys.series.all });
    },
  });
}

export function usePruneFleet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ seriesId, fleetId }: { seriesId: string; fleetId: string }) =>
      pruneFleet(seriesId, fleetId),
    onSuccess: async (_void, { seriesId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.fleets.bySeries(seriesId) });
      // See useSaveFleet — keep the cached series row's version fresh.
      await qc.invalidateQueries({ queryKey: queryKeys.series.all });
    },
  });
}
