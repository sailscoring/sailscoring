'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useRepos } from '@/lib/repos';
import type { Fleet } from '@/lib/types';

import { queryKeys } from './query-keys';

export function useFleetsBySeries(seriesId: string) {
  const { fleetRepo } = useRepos();
  return useQuery<Fleet[]>({
    queryKey: queryKeys.fleets.bySeries(seriesId),
    queryFn: () => fleetRepo.listBySeries(seriesId),
  });
}

export function useSaveFleet() {
  const { fleetRepo } = useRepos();
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

export function useDeleteFleet() {
  const { fleetRepo } = useRepos();
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
  const repos = useRepos();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      seriesId,
      name,
      options,
    }: {
      seriesId: string;
      name: string;
      options?: Parameters<typeof repos.ensureFleet>[2];
    }) => repos.ensureFleet(seriesId, name, options),
    onSuccess: (_id, { seriesId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.fleets.bySeries(seriesId) });
    },
  });
}

export function usePruneFleet() {
  const repos = useRepos();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ seriesId, fleetId }: { seriesId: string; fleetId: string }) =>
      repos.pruneFleet(seriesId, fleetId),
    onSuccess: (_void, { seriesId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.fleets.bySeries(seriesId) });
    },
  });
}
