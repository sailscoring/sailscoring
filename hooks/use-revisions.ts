'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createCheckpoint, listRevisions, revertToRevision } from '@/lib/api-repository';

import { queryKeys } from './query-keys';

/**
 * Revision history for one series — backs the History tab (#166). Returns the
 * coarse, newest-first list of revisions (metadata only; snapshot blobs are
 * fetched on demand when viewing or reverting).
 */
export function useSeriesRevisions(seriesId: string) {
  return useQuery({
    queryKey: queryKeys.revisions.bySeries(seriesId),
    queryFn: () => listRevisions(seriesId),
  });
}

/** Create a named checkpoint of the series' current state (#166). */
export function useCreateCheckpoint(seriesId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (label: string) => createCheckpoint(seriesId, label),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.revisions.bySeries(seriesId) }),
  });
}

/**
 * Restore a series to an earlier revision (#166). The replay rewrites every
 * child entity with fresh ids server-side, so all of the series' caches are
 * dropped and refetched — mirroring the Update-from-File invalidation.
 */
export function useRevertToRevision(seriesId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (revisionId: string) => revertToRevision(seriesId, revisionId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.series.detail(seriesId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.series.list() });
      queryClient.removeQueries({ queryKey: queryKeys.fleets.all });
      queryClient.removeQueries({ queryKey: queryKeys.competitors.all });
      queryClient.removeQueries({ queryKey: queryKeys.races.all });
      queryClient.removeQueries({ queryKey: queryKeys.finishes.all });
      queryClient.removeQueries({ queryKey: queryKeys.raceStarts.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.activity.bySeries(seriesId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.revisions.bySeries(seriesId) });
    },
  });
}
