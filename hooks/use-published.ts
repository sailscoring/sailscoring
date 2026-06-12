'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getPublication, listPublished, unpublishById } from '@/lib/api-repository';
import type { PublicationStatus, PublishedListItem } from '@/lib/types';

import { queryKeys } from './query-keys';

/** The workspace's published results for the management page (#164). */
export function usePublishedList() {
  return useQuery<PublishedListItem[]>({
    queryKey: queryKeys.published.list(),
    queryFn: () => listPublished(),
  });
}

/** A single series' publication status — `data.published` is non-null when it
 *  has a live public page. Disabled until `seriesId` is set so callers can drive
 *  it from a lazily-opened dialog. */
export function usePublicationStatus(seriesId: string | null) {
  return useQuery<PublicationStatus>({
    queryKey: queryKeys.published.status(seriesId ?? ''),
    queryFn: () => getPublication(seriesId!),
    enabled: seriesId !== null,
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
