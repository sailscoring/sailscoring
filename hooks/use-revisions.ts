'use client';

import { useQuery } from '@tanstack/react-query';

import { listRevisions } from '@/lib/api-repository';

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
