'use client';

import { useQuery } from '@tanstack/react-query';

import { tcfHistoryRepo } from '@/lib/api-repository';
import type { TcfRecord } from '@/lib/types';

import { queryKeys } from './query-keys';

/**
 * Persisted progressive-handicap TCF snapshots for a series. Used by the
 * Update Handicaps dialog (#144) to read end-of-series TCFs from a source
 * series. Read-only — the scoring recompute path owns writes.
 */
export function useTcfHistoryBySeries(seriesId: string | null) {
  return useQuery<TcfRecord[]>({
    queryKey: queryKeys.tcfHistory.bySeries(seriesId ?? ''),
    queryFn: () => tcfHistoryRepo.listBySeries(seriesId as string),
    enabled: seriesId !== null && seriesId !== '',
  });
}
