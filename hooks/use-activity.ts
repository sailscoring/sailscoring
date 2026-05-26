'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { listActivity, listRecentActivity } from '@/lib/api-repository';
import type { ActivityEntry } from '@/lib/types';

import { queryKeys } from './query-keys';

/**
 * Paginated activity feed for one series — backs the Activity tab (#153).
 * Pages are stitched with `useInfiniteQuery`; `fetchNextPage` loads older
 * entries until `nextCursor` runs out.
 */
export function useSeriesActivity(seriesId: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.activity.bySeries(seriesId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => listActivity({ seriesId, cursor: pageParam }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/**
 * Latest activity per series, keyed by series id — backs the recency strip on
 * each series-list card. Returns a `Map` for O(1) lookup per card.
 */
export function useRecentActivity() {
  return useQuery<ActivityEntry[], Error, Map<string, ActivityEntry>>({
    queryKey: queryKeys.activity.recent(),
    queryFn: () => listRecentActivity(),
    select: (entries) => {
      const byId = new Map<string, ActivityEntry>();
      for (const e of entries) {
        if (e.seriesId) byId.set(e.seriesId, e);
      }
      return byId;
    },
  });
}
