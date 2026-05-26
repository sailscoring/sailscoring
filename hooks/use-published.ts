'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { listPublished, unpublishById } from '@/lib/api-repository';
import type { PublishedListItem } from '@/lib/types';

import { queryKeys } from './query-keys';

/** The workspace's published results for the management page (#164). */
export function usePublishedList() {
  return useQuery<PublishedListItem[]>({
    queryKey: queryKeys.published.list(),
    queryFn: () => listPublished(),
  });
}

/** Unpublish by publication id, then refresh the listing. */
export function useUnpublish() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unpublishById(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.published.list() });
    },
  });
}
