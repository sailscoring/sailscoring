'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { listTrash, purgeFromTrash, restoreFromTrash } from '@/lib/api-repository';
import type { DeletedSeriesEntry } from '@/lib/types';

import { queryKeys } from './query-keys';

/** The workspace Trash — soft-deleted series recoverable within the retention
 *  window ("Recover a deleted series"). */
export function useTrash() {
  return useQuery<DeletedSeriesEntry[]>({
    queryKey: queryKeys.trash.list(),
    queryFn: listTrash,
  });
}

/** Recover a trashed series. It returns to the (archived) active list, so both
 *  the series list and the Trash list are invalidated. */
export function useRestoreFromTrash() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tombstoneId: string) => restoreFromTrash(tombstoneId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.trash.list() });
      qc.invalidateQueries({ queryKey: queryKeys.series.list() });
    },
  });
}

/** Permanently delete a trashed series — the "delete forever" path. */
export function usePurgeFromTrash() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tombstoneId: string) => purgeFromTrash(tombstoneId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.trash.list() });
    },
  });
}
