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
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: queryKeys.fleets.bySeries(saved.seriesId) });
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
    onSuccess: (_void, fleets) => {
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
    onSuccess: (_void, { seriesId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.fleets.bySeries(seriesId) });
      // Competitors carry fleetIds[] that may now reference a deleted id.
      qc.invalidateQueries({ queryKey: queryKeys.competitors.bySeries(seriesId) });
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
    onSuccess: (_id, { seriesId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.fleets.bySeries(seriesId) });
    },
  });
}

export function usePruneFleet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ seriesId, fleetId }: { seriesId: string; fleetId: string }) =>
      pruneFleet(seriesId, fleetId),
    onSuccess: (_void, { seriesId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.fleets.bySeries(seriesId) });
    },
  });
}
