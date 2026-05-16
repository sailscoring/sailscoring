'use client';

import { useQuery } from '@tanstack/react-query';

import { listTcfHistoryBySeries } from '@/lib/api-repository';
import type { TcfRecord } from '@/lib/types';

import { queryKeys } from './query-keys';

/**
 * Progressive-handicap TCF snapshots for a series. Used by the Update
 * Handicaps dialog (#144) to read end-of-series TCFs from a source
 * series. Server computes live — no client cache to invalidate beyond
 * the React Query layer.
 */
export function useTcfHistoryBySeries(seriesId: string | null) {
  return useQuery<TcfRecord[]>({
    queryKey: queryKeys.tcfHistory.bySeries(seriesId ?? ''),
    queryFn: () => listTcfHistoryBySeries(seriesId as string),
    enabled: seriesId !== null && seriesId !== '',
  });
}
